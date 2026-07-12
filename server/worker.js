// Cloudflare Worker for Maid Cafe Menu System with SQLite Durable Objects & WebSockets.
// 100% D1-Free Architecture with write-through in-memory Map caching.
// Minimizes SQL reads to exactly ONCE on DO activation, and writes only when data changes.
// Leverages Cloudflare's WebSocket Hibernation (冬眠) API. No in-memory arrays like `this.sessions`.

// Helper to format JSON response
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password, Authorization",
      "Access-Control-Max-Age": "86400",
      "Content-Type": "application/json",
    },
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password, Authorization",
  "Access-Control-Max-Age": "86400",
};

function handleOptions(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// ==========================================
// 1. DURABLE OBJECT: MaidCafeDO
// ==========================================
export class MaidCafeDO {
  constructor(state, env) {
    this.ctx = state;
    this.env = env;

    // Cache states
    this.isCacheLoaded = false;
    this.roomsCache = new Map();
    this.guestsCache = new Map();
    this.menuItemsCache = new Map();

    // Initialize SQLite tables inside Durable Object
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phase TEXT NOT NULL DEFAULT 'WAITING',
        created_date TEXT NOT NULL
      );
    `);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS guest_users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        room_id TEXT NOT NULL,
        session_token TEXT NOT NULL UNIQUE,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_online INTEGER NOT NULL DEFAULT 0,
        last_seen TEXT,
        created_date TEXT NOT NULL
      );
    `);

    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS menu_items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT 'food',
        description TEXT,
        image_url TEXT,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_date TEXT NOT NULL
      );
    `);
  }

  // SQLite helper
  query(sql, ...params) {
    const results = [];
    const cursor = this.ctx.storage.sql.exec(sql, ...params);
    for (const row of cursor) {
      results.push(row);
    }
    return results;
  }

  querySingle(sql, ...params) {
    const arr = this.query(sql, ...params);
    return arr.length > 0 ? arr[0] : null;
  }

  // Lazy-loader to read SQLite exactly ONCE on activation
  ensureCacheLoaded() {
    if (this.isCacheLoaded) return;

    // Read Rooms
    const roomsList = this.query("SELECT * FROM rooms");
    for (const r of roomsList) {
      this.roomsCache.set(r.id, r);
    }

    // Read Guests
    const guestsList = this.query("SELECT * FROM guest_users");
    for (const g of guestsList) {
      this.guestsCache.set(g.id, g);
    }

    // Read Menu Items
    const menuItemsList = this.query("SELECT * FROM menu_items");
    for (const m of menuItemsList) {
      this.menuItemsCache.set(m.id, m);
    }

    this.isCacheLoaded = true;
    console.log(`[Cache Hydrated] Loaded ${this.roomsCache.size} rooms, ${this.guestsCache.size} guests, ${this.menuItemsCache.size} menu items from SQLite.`);
  }

  async fetch(request) {
    this.ensureCacheLoaded();

    const url = new URL(request.url);
    const path = url.pathname;

    // --- WEBSOCKET UPGRADE (DO-SIDE) ---
    if (path === "/connect-ws") {
      const roomId = url.searchParams.get("roomId");
      const guestId = url.searchParams.get("guestId");
      const role = url.searchParams.get("role") || "guest";

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Register connection with WebSocket Hibernation API
      this.ctx.acceptWebSocket(server);

      // Attach metadata context to the accepted socket
      server.serializeAttachment({ roomId, guestId, role });

      // If guest user joins, mark online in SQLite and Cache
      if (guestId && role === "guest") {
        const timestamp = new Date().toISOString();
        this.query("UPDATE guest_users SET is_online = 1, last_seen = ? WHERE id = ?", timestamp, guestId);

        const cachedGuest = this.guestsCache.get(guestId);
        if (cachedGuest) {
          cachedGuest.is_online = 1;
          cachedGuest.last_seen = timestamp;
          this.guestsCache.set(guestId, cachedGuest);
        }

        this.broadcastToRoom(roomId, { type: "GUEST_UPDATE", guestId, isOnline: true });
      }

      // Initial state push (room state) from CACHE - 0% SQL read load!
      const room = this.roomsCache.get(roomId);
      if (room) {
        server.send(JSON.stringify({ type: "PHASE_UPDATE", phase: room.phase }));
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    // --- REST API ENDPOINTS POWERED BY CACHE ---

    // GET /api/health
    if (path === "/api/health") {
      return jsonResponse({ ok: true, database: "durable_objects_sqlite_cached" });
    }

    // GET /api/rooms
    if (path === "/api/rooms" && request.method === "GET") {
      const list = Array.from(this.roomsCache.values())
        .sort((a, b) => b.created_date.localeCompare(a.created_date));
      return jsonResponse(list);
    }

    // GET /api/rooms/:id
    const roomDetailMatch = path.match(/^\/api\/rooms\/([a-zA-Z0-9-]+)$/);
    if (roomDetailMatch && request.method === "GET") {
      const roomId = roomDetailMatch[1];
      const room = this.roomsCache.get(roomId);
      if (!room) return jsonResponse({ error: "Room not found" }, 404);
      return jsonResponse(room);
    }

    // POST /api/rooms
    if (path === "/api/rooms" && request.method === "POST") {
      const body = await request.json();
      const { id, name, phase } = body;

      if (!name) {
        return jsonResponse({ error: "name is required" }, 400);
      }

      const roomId = id || crypto.randomUUID();
      const roomPhase = phase || "WAITING";
      const createdDate = new Date().toISOString();

      // Write-Through: Update SQLite
      this.query("INSERT INTO rooms (id, name, phase, created_date) VALUES (?, ?, ?, ?)", roomId, name, roomPhase, createdDate);

      // Write-Through: Update Cache
      const roomObj = { id: roomId, name, phase: roomPhase, created_date: createdDate };
      this.roomsCache.set(roomId, roomObj);

      // Notify all active admin sockets about new room
      this.broadcastToAdmins({
        type: "ROOM_CREATED",
        room: roomObj
      });

      return jsonResponse(roomObj, 201);
    }

    // NEW ATOMIC COMPOSITE ENDPOINT: POST /api/rooms-with-guests
    if (path === "/api/rooms-with-guests" && request.method === "POST") {
      const body = await request.json();
      const { roomName, guests } = body;

      if (!roomName) {
        return jsonResponse({ error: "roomName is required" }, 400);
      }

      const roomId = crypto.randomUUID();
      const createdDate = new Date().toISOString();

      // SQLite Write
      this.query("INSERT INTO rooms (id, name, phase, created_date) VALUES (?, ?, 'WAITING', ?)", roomId, roomName, createdDate);

      // Cache Write
      const roomObj = { id: roomId, name: roomName, phase: "WAITING", created_date: createdDate };
      this.roomsCache.set(roomId, roomObj);

      const registeredGuests = [];
      if (Array.isArray(guests)) {
        for (const guestName of guests) {
          if (!guestName || typeof guestName !== "string") continue;

          const guestId = crypto.randomUUID();
          const sessionToken = crypto.randomUUID();

          // SQLite Write
          this.query(
            "INSERT INTO guest_users (id, name, room_id, session_token, is_active, is_online, created_date) VALUES (?, ?, ?, ?, 1, 0, ?)",
            guestId, guestName, roomId, sessionToken, createdDate
          );

          // Cache Write
          const guestRow = {
            id: guestId,
            name: guestName,
            room_id: roomId,
            session_token: sessionToken,
            is_active: 1,
            is_online: 0,
            last_seen: null,
            created_date: createdDate
          };
          this.guestsCache.set(guestId, guestRow);

          const guestUrl = `${url.origin}/guest?token=${sessionToken}`;

          registeredGuests.push({
            id: guestId,
            name: guestName,
            roomId,
            sessionToken,
            isActive: true,
            isOnline: false,
            lastSeen: null,
            created_date: createdDate,
            guestUrl
          });
        }
      }

      // Broadcast creation events to active admin sockets
      this.broadcastToAdmins({
        type: "ROOM_CREATED",
        room: roomObj
      });

      for (const g of registeredGuests) {
        this.broadcastToAdmins({
          type: "GUEST_CREATED",
          guest: g
        });
      }

      return jsonResponse({
        ok: true,
        room: roomObj,
        guests: registeredGuests
      }, 201);
    }

    // PATCH /api/rooms/:id
    if (roomDetailMatch && request.method === "PATCH") {
      const roomId = roomDetailMatch[1];
      const body = await request.json();
      const current = this.roomsCache.get(roomId);
      if (!current) return jsonResponse({ error: "Room not found" }, 404);

      const newName = body.name !== undefined ? body.name : current.name;
      const newPhase = body.phase !== undefined ? body.phase : current.phase;

      // SQLite Write
      this.query("UPDATE rooms SET name = ?, phase = ? WHERE id = ?", newName, newPhase, roomId);

      // Cache Write
      const updatedRoom = {
        id: roomId,
        name: newName,
        phase: newPhase,
        created_date: current.created_date,
      };
      this.roomsCache.set(roomId, updatedRoom);

      // Broadcast updates via WebSockets
      if (body.phase !== undefined) {
        this.broadcastToRoom(roomId, { type: "PHASE_UPDATE", phase: newPhase });
      }

      this.broadcastToAdmins({
        type: "ROOM_UPDATED",
        room: updatedRoom
      });

      return jsonResponse(updatedRoom);
    }

    // DELETE /api/rooms/:id
    if (roomDetailMatch && request.method === "DELETE") {
      const roomId = roomDetailMatch[1];

      // SQLite Writes
      this.query("DELETE FROM guest_users WHERE room_id = ?", roomId);
      this.query("DELETE FROM rooms WHERE id = ?", roomId);

      // Cache Writes
      this.roomsCache.delete(roomId);
      for (const [gid, g] of this.guestsCache.entries()) {
        if (g.room_id === roomId) {
          this.guestsCache.delete(gid);
        }
      }

      // Notify all active admin sockets about deleted room
      this.broadcastToAdmins({
        type: "ROOM_DELETED",
        roomId
      });

      return new Response(null, { status: 204 });
    }

    // GET /api/guests
    if (path === "/api/guests" && request.method === "GET") {
      const sessionToken = url.searchParams.get("sessionToken");
      const roomId = url.searchParams.get("roomId");

      let filtered = Array.from(this.guestsCache.values());

      if (sessionToken) {
        filtered = filtered.filter(g => g.session_token === sessionToken);
      } else if (roomId) {
        filtered = filtered.filter(g => g.room_id === roomId);
      }

      filtered.sort((a, b) => b.created_date.localeCompare(a.created_date));

      const enriched = filtered.map(row => {
        return {
          id: row.id,
          name: row.name,
          roomId: row.room_id,
          sessionToken: row.session_token,
          isActive: row.is_active === 1,
          isOnline: row.is_online === 1,
          lastSeen: row.last_seen,
          created_date: row.created_date,
        };
      });

      return jsonResponse(enriched);
    }

    // POST /api/guests
    if (path === "/api/guests" && request.method === "POST") {
      const body = await request.json();
      let { id, name, roomId, sessionToken, isActive, isOnline } = body;

      if (!name || !roomId) {
        return jsonResponse({ error: "name and roomId are required" }, 400);
      }

      if (!id) id = crypto.randomUUID();
      if (!sessionToken) sessionToken = crypto.randomUUID();

      const createdDate = new Date().toISOString();
      const activeVal = isActive !== false ? 1 : 0;
      const onlineVal = isOnline ? 1 : 0;

      // SQLite Write
      this.query("INSERT INTO guest_users (id, name, room_id, session_token, is_active, is_online, created_date) VALUES (?, ?, ?, ?, ?, ?, ?)",
        id, name, roomId, sessionToken, activeVal, onlineVal, createdDate);

      // Cache Write
      const guestRow = {
        id,
        name,
        room_id: roomId,
        session_token: sessionToken,
        is_active: activeVal,
        is_online: onlineVal,
        last_seen: null,
        created_date: createdDate
      };
      this.guestsCache.set(id, guestRow);

      const guestUrl = `${url.origin}/guest?token=${sessionToken}`;

      const guestObj = {
        id,
        name,
        roomId,
        sessionToken,
        isActive: activeVal === 1,
        isOnline: onlineVal === 1,
        lastSeen: null,
        created_date: createdDate,
        guestUrl
      };

      // Notify all admins about newly created guest
      this.broadcastToAdmins({
        type: "GUEST_CREATED",
        guest: guestObj
      });

      return jsonResponse(guestObj, 201);
    }

    // PATCH /api/guests/:id
    const guestDetailMatch = path.match(/^\/api\/guests\/([a-zA-Z0-9-]+)$/);
    if (guestDetailMatch && request.method === "PATCH") {
      const guestId = guestDetailMatch[1];
      const body = await request.json();
      const current = this.guestsCache.get(guestId);
      if (!current) return jsonResponse({ error: "Guest not found" }, 404);

      const newName = body.name !== undefined ? body.name : current.name;
      const newRoomId = body.roomId !== undefined ? body.roomId : current.room_id;
      const newSessionToken = body.sessionToken !== undefined ? body.sessionToken : current.session_token;
      const newIsActive = body.isActive !== undefined ? (body.isActive ? 1 : 0) : current.is_active;
      const newIsOnline = body.isOnline !== undefined ? (body.isOnline ? 1 : 0) : current.is_online;
      const newLastSeen = body.lastSeen !== undefined ? body.lastSeen : current.last_seen;

      // SQLite Write
      this.query("UPDATE guest_users SET name = ?, room_id = ?, session_token = ?, is_active = ?, is_online = ?, last_seen = ? WHERE id = ?",
        newName, newRoomId, newSessionToken, newIsActive, newIsOnline, newLastSeen, guestId);

      // Cache Write
      const updatedGuestRow = {
        id: guestId,
        name: newName,
        room_id: newRoomId,
        session_token: newSessionToken,
        is_active: newIsActive,
        is_online: newIsOnline,
        last_seen: newLastSeen,
        created_date: current.created_date,
      };
      this.guestsCache.set(guestId, updatedGuestRow);

      const updatedGuest = {
        id: guestId,
        name: newName,
        roomId: newRoomId,
        sessionToken: newSessionToken,
        isActive: newIsActive === 1,
        isOnline: newIsOnline === 1,
        lastSeen: newLastSeen,
        created_date: current.created_date,
      };

      // Inform active WebSockets of changes in this room if needed
      this.broadcastToRoom(newRoomId, { type: "GUEST_UPDATE", guestId, isOnline: newIsOnline === 1 });

      // Sync updated guest data to admins
      this.broadcastToAdmins({
        type: "GUEST_UPDATED",
        guest: updatedGuest
      });

      return jsonResponse(updatedGuest);
    }

    // DELETE /api/guests/:id
    if (guestDetailMatch && request.method === "DELETE") {
      const guestId = guestDetailMatch[1];

      // SQLite Write
      this.query("DELETE FROM guest_users WHERE id = ?", guestId);

      // Cache Write
      this.guestsCache.delete(guestId);

      // Notify admins
      this.broadcastToAdmins({
        type: "GUEST_DELETED",
        guestId
      });

      return new Response(null, { status: 204 });
    }

    // GET /api/menu-items
    if (path === "/api/menu-items" && request.method === "GET") {
      const limit = Number(url.searchParams.get("limit")) || 100;
      const sorted = Array.from(this.menuItemsCache.values())
        .sort((a, b) => {
          if (a.order_index !== b.order_index) {
            return a.order_index - b.order_index;
          }
          return a.created_date.localeCompare(b.created_date);
        })
        .slice(0, limit);

      const mapped = sorted.map(row => ({
        id: row.id,
        name: row.name,
        price: Number(row.price),
        category: row.category,
        description: row.description,
        imageUrl: row.image_url,
        order: row.order_index,
        created_date: row.created_date,
      }));
      return jsonResponse(mapped);
    }

    // POST /api/menu-items
    if (path === "/api/menu-items" && request.method === "POST") {
      const body = await request.json();
      const { id, name, price, category, description, imageUrl, order } = body;
      const createdDate = new Date().toISOString();

      // SQLite Write
      this.query("INSERT INTO menu_items (id, name, price, category, description, image_url, order_index, created_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        id, name, price, category, description, imageUrl, order, createdDate);

      // Cache Write
      const menuItemObj = {
        id,
        name,
        price,
        category,
        description,
        image_url: imageUrl,
        order_index: order,
        created_date: createdDate
      };
      this.menuItemsCache.set(id, menuItemObj);

      return jsonResponse({ id, name, price, category, description, imageUrl, order, created_date: createdDate }, 201);
    }

    // PATCH /api/menu-items/:id
    const menuDetailMatch = path.match(/^\/api\/menu-items\/([a-zA-Z0-9-]+)$/);
    if (menuDetailMatch && request.method === "PATCH") {
      const itemId = menuDetailMatch[1];
      const body = await request.json();
      const current = this.menuItemsCache.get(itemId);
      if (!current) return jsonResponse({ error: "Menu item not found" }, 404);

      const newName = body.name !== undefined ? body.name : current.name;
      const newPrice = body.price !== undefined ? body.price : current.price;
      const newCategory = body.category !== undefined ? body.category : current.category;
      const newDesc = body.description !== undefined ? body.description : current.description;
      const newImg = body.imageUrl !== undefined ? body.imageUrl : current.image_url;
      const newOrder = body.order !== undefined ? body.order : current.order_index;

      // SQLite Write
      this.query("UPDATE menu_items SET name = ?, price = ?, category = ?, description = ?, image_url = ?, order_index = ? WHERE id = ?",
        newName, newPrice, newCategory, newDesc, newImg, newOrder, itemId);

      // Cache Write
      const updatedMenuItem = {
        id: itemId,
        name: newName,
        price: newPrice,
        category: newCategory,
        description: newDesc,
        image_url: newImg,
        order_index: newOrder,
        created_date: current.created_date
      };
      this.menuItemsCache.set(itemId, updatedMenuItem);

      return jsonResponse({
        id: itemId,
        name: newName,
        price: Number(newPrice),
        category: newCategory,
        description: newDesc,
        imageUrl: newImg,
        order: newOrder,
        created_date: current.created_date,
      });
    }

    // DELETE /api/menu-items/:id
    if (menuDetailMatch && request.method === "DELETE") {
      const itemId = menuDetailMatch[1];

      // SQLite Write
      this.query("DELETE FROM menu_items WHERE id = ?", itemId);

      // Cache Write
      this.menuItemsCache.delete(itemId);

      return new Response(null, { status: 204 });
    }

    return new Response("Not Found", { status: 404 });
  }

  // Cloudflare WebSocket Hibernation API message receiver
  async webSocketMessage(ws, message) {
    this.ensureCacheLoaded();

    const attachment = ws.deserializeAttachment();
    if (!attachment) return;

    try {
      const data = JSON.parse(message);

      // --- COMMAND HANDLER: SET_PHASE (WebSocket Management Trigger) ---
      if (data.type === "SET_PHASE") {
        const { roomId, phase, password } = data;
        const expectedPassword = this.env.ADMIN_PASSWORD || "maid2024";

        if (password !== expectedPassword) {
          ws.send(JSON.stringify({ type: "ERROR", message: "Unauthorized admin command" }));
          return;
        }

        const current = this.roomsCache.get(roomId);
        if (!current) {
          ws.send(JSON.stringify({ type: "ERROR", message: "Room not found" }));
          return;
        }

        // SQLite Write
        this.query("UPDATE rooms SET phase = ? WHERE id = ?", phase, roomId);

        // Cache Write
        current.phase = phase;
        this.roomsCache.set(roomId, current);

        // Broadcast phase update via WebSocket
        this.broadcastToRoom(roomId, { type: "PHASE_UPDATE", phase });

        this.broadcastToAdmins({
          type: "ROOM_UPDATED",
          room: current
        });
      }

      // --- COMMAND HANDLER: REGISTER_ADMIN ---
      if (data.type === "REGISTER_ADMIN") {
        const { password } = data;
        const expectedPassword = this.env.ADMIN_PASSWORD || "maid2024";

        if (password === expectedPassword) {
          // Upgrade connection status of this socket to admin
          attachment.role = "admin";
          ws.serializeAttachment(attachment);

          ws.send(JSON.stringify({ type: "AUTH_SUCCESS" }));

          // Now safely send the initial administrative database state from CACHE (0% SQLite read overhead!)
          const roomsList = Array.from(this.roomsCache.values())
            .sort((a, b) => b.created_date.localeCompare(a.created_date));
          const guestsList = Array.from(this.guestsCache.values())
            .sort((a, b) => b.created_date.localeCompare(a.created_date));

          ws.send(JSON.stringify({
            type: "ADMIN_INIT",
            rooms: roomsList,
            guests: guestsList.map(row => ({
              id: row.id,
              name: row.name,
              roomId: row.room_id,
              sessionToken: row.session_token,
              isActive: row.is_active === 1,
              isOnline: row.is_online === 1,
              lastSeen: row.last_seen,
              created_date: row.created_date,
            }))
          }));
        } else {
          ws.send(JSON.stringify({ type: "AUTH_FAILED" }));
        }
      }

    } catch (err) {
      console.error("[WebSocket Message Error]", err);
    }
  }

  // Cloudflare WebSocket Hibernation API connection close hook
  async webSocketClose(ws, code, reason, wasClean) {
    this.ensureCacheLoaded();

    const attachment = ws.deserializeAttachment();
    if (attachment && attachment.guestId && attachment.role === "guest") {
      const timestamp = new Date().toISOString();
      // SQLite Write
      this.query("UPDATE guest_users SET is_online = 0, last_seen = ? WHERE id = ?", timestamp, attachment.guestId);

      // Cache Write
      const cachedGuest = this.guestsCache.get(attachment.guestId);
      if (cachedGuest) {
        cachedGuest.is_online = 0;
        cachedGuest.last_seen = timestamp;
        this.guestsCache.set(attachment.guestId, cachedGuest);
      }

      this.broadcastToRoom(attachment.roomId, { type: "GUEST_UPDATE", guestId: attachment.guestId, isOnline: false });
    }
  }

  // Cloudflare WebSocket Hibernation API connection error hook
  async webSocketError(ws, error) {
    this.ensureCacheLoaded();

    const attachment = ws.deserializeAttachment();
    if (attachment && attachment.guestId && attachment.role === "guest") {
      const timestamp = new Date().toISOString();
      // SQLite Write
      this.query("UPDATE guest_users SET is_online = 0, last_seen = ? WHERE id = ?", timestamp, attachment.guestId);

      // Cache Write
      const cachedGuest = this.guestsCache.get(attachment.guestId);
      if (cachedGuest) {
        cachedGuest.is_online = 0;
        cachedGuest.last_seen = timestamp;
        this.guestsCache.set(attachment.guestId, cachedGuest);
      }

      this.broadcastToRoom(attachment.roomId, { type: "GUEST_UPDATE", guestId: attachment.guestId, isOnline: false });
    }
  }

  // Broadcast using Cloudflare's Hibernation getter
  broadcastToRoom(roomId, message) {
    const payload = JSON.stringify(message);
    const sockets = this.ctx.getWebSockets();

    for (const ws of sockets) {
      const meta = ws.deserializeAttachment();
      if (meta && meta.roomId === roomId) {
        try {
          ws.send(payload);
        } catch {
          // Closed or dead connection
        }
      }
    }
  }

  // Broadcast state changes exclusively to admin connections
  broadcastToAdmins(message) {
    const payload = JSON.stringify(message);
    const sockets = this.ctx.getWebSockets();

    for (const ws of sockets) {
      const meta = ws.deserializeAttachment();
      if (meta && meta.role === "admin") {
        try {
          ws.send(payload);
        } catch {
          // Closed or dead connection
        }
      }
    }
  }
}

// ==========================================
// 2. MAIN WORKER PROXY ENTRYPOINT
// ==========================================
export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Helper to check if authorized
    const isAdmin = () => {
      const passwordHeader = request.headers.get("X-Admin-Password") || request.headers.get("Authorization");
      const expectedPassword = env.ADMIN_PASSWORD || "maid2024";
      return passwordHeader === expectedPassword;
    };

    const requireAdmin = () => {
      if (!isAdmin()) {
        throw new Error("UNAUTHORIZED");
      }
    };

    try {
      // --- PUBLIC / STATIC ASSETS ROUTING ---
      if (!path.startsWith("/api")) {
        if (env.ASSETS) {
          let response = await env.ASSETS.fetch(request);
          if (response.status === 404) {
            response = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url)));
          }
          return response;
        }
        return new Response("Not Found", { status: 404 });
      }

      // --- AUTHENTICATION & WEBSOCKET ROUTING PROXIED TO SINGLETON DO ---
      if (!env.MAID_CAFE_DO) {
        return jsonResponse({ error: "ROOM_SESSION Durable Object binding missing in wrangler.json" }, 500);
      }

      // We use a singleton namespace ID to manage our single-Durable-Object persistent SQLite store
      const doId = env.MAID_CAFE_DO.idFromName("global_store");
      const storeDo = env.MAID_CAFE_DO.get(doId);

      // A: WebSocket Connection endpoint
      if (path === "/api/ws" && request.method === "GET") {
        const roomId = url.searchParams.get("roomId");
        const guestId = url.searchParams.get("guestId");
        const role = url.searchParams.get("role") || "guest";

        if (!roomId) {
          return jsonResponse({ error: "roomId is required" }, 400);
        }

        const upgradeHeader = request.headers.get("Upgrade");
        if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
          return new Response("Expected Upgrade: websocket", { status: 426 });
        }

        // Proxy WebSocket request directly to DO's /connect-ws endpoint safely copying headers
        const wsUrl = new URL(`/connect-ws?roomId=${roomId}&guestId=${guestId || ""}&role=${role}`, url.origin);
        const wsHeaders = new Headers(request.headers);
        const proxiedRequest = new Request(wsUrl, {
          headers: wsHeaders,
        });
        return await storeDo.fetch(proxiedRequest);
      }

      // B: Check which REST API endpoints require Admin Auth
      const isMutation = ["POST", "PATCH", "DELETE"].includes(request.method);
      const isFullGuests = path === "/api/guests" && !url.searchParams.get("sessionToken") && !url.searchParams.get("roomId");

      if (isMutation || isFullGuests) {
        // Exempt public polling update
        const isGuestPollingUpdate = path.match(/^\/api\/guests\/([a-zA-Z0-9-]+)$/) && request.method === "PATCH" && !request.headers.get("X-Admin-Password");

        if (!isGuestPollingUpdate) {
          requireAdmin();
        }
      }

      // C: Inject UUID for POST requests to simplify backend D1->DO DB compliance
      let proxiedRequest = request;
      if (request.method === "POST" && ["/api/rooms", "/api/guests", "/api/menu-items"].includes(path)) {
        const body = await request.json();
        if (!body.id) {
          body.id = crypto.randomUUID();
        }
        proxiedRequest = new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify(body)
        });
      }

      // D: Forward all other API requests directly to the MaidCafeDO database
      const targetUrl = new URL(path + url.search, url.origin);
      return await storeDo.fetch(new Request(targetUrl, proxiedRequest));

    } catch (err) {
      if (err.message === "UNAUTHORIZED") {
        return jsonResponse({ error: "Unauthorized access" }, 401);
      }
      console.error(err);
      return jsonResponse({ error: err.message || "Internal server error" }, 500);
    }
  }
};
