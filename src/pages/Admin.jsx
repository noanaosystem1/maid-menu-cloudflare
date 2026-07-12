import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, RefreshCw, LogOut } from "lucide-react";
import { api } from "@/api/client";
import { STORAGE_KEYS } from "@/lib/constants";
import AdminLogin from "@/components/admin/AdminLogin";
import AdminRoomDetail from "./AdminRoomDetail";
import RoomCard from "@/components/admin/RoomCard";
import CreateRoomModal from "@/components/admin/CreateRoomModal";
import MenuItemManager from "@/components/admin/MenuItemManager";

export default function Admin() {
  const [authed, setAuthed] = useState(false);
  const [rooms, setRooms] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [activeTab, setActiveTab] = useState("rooms"); // "rooms" | "menu"
  const [apiError, setApiError] = useState(null);

  const socketRef = useRef(null);

  // Check session auth
  useEffect(() => {
    const auth = sessionStorage.getItem(STORAGE_KEYS.ADMIN_AUTH);
    if (auth === "1") setAuthed(true);
  }, []);

  const handleLogout = () => {
    sessionStorage.removeItem(STORAGE_KEYS.ADMIN_AUTH);
    sessionStorage.removeItem(STORAGE_KEYS.ADMIN_AUTH_PASSWORD);
    setAuthed(false);
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
  };

  // REST load initially (rooms, members) as a starting point
  const loadInitialData = useCallback(async () => {
    if (!authed) return;
    try {
      const [roomList, memberList] = await Promise.all([
        api.rooms.list(),
        api.guests.list(),
      ]);
      setRooms(roomList);
      setMembers(memberList);
      setApiError(null);
    } catch (err) {
      console.error("Failed to load initial admin data:", err);
      setApiError("バックエンドに接続できません。サーバーが起動しているか確認してください。");
    } finally {
      setLoading(false);
    }
  }, [authed]);

  // Establish persistent always-on WebSocket connection for the admin console to receive reactive pushes
  useEffect(() => {
    if (!authed) return;

    loadInitialData();

    const adminPassword = sessionStorage.getItem(STORAGE_KEYS.ADMIN_AUTH_PASSWORD) || "maid2024";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // Connect to global_store DO using a special admin query parameter
    const wsUrl = `${protocol}//${window.location.host}/api/ws?roomId=global_admin_room&role=admin`;

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      console.log("[Admin WebSocket] Connected to global_store DO.");
      // Register this socket as an admin inside DO using password authentication
      ws.send(JSON.stringify({ type: "REGISTER_ADMIN", password: adminPassword }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("[Admin WebSocket] Received payload:", data);

        if (data.type === "ADMIN_INIT") {
          if (data.rooms) setRooms(data.rooms);
          if (data.guests) setMembers(data.guests);
        } else if (data.type === "ROOM_CREATED") {
          setRooms(prev => [data.room, ...prev]);
        } else if (data.type === "ROOM_UPDATED") {
          setRooms(prev => prev.map(r => r.id === data.room.id ? data.room : r));
        } else if (data.type === "ROOM_DELETED") {
          setRooms(prev => prev.filter(r => r.id !== data.roomId));
        } else if (data.type === "GUEST_CREATED") {
          setMembers(prev => [data.guest, ...prev]);
        } else if (data.type === "GUEST_UPDATED") {
          setMembers(prev => prev.map(m => m.id === data.guest.id ? data.guest : m));
        } else if (data.type === "GUEST_DELETED") {
          setMembers(prev => prev.filter(m => m.id !== data.guestId));
        } else if (data.type === "GUEST_UPDATE") {
          // Fallback guest online update broadcasted room-wide
          setMembers(prev => prev.map(m => m.id === data.guestId ? { ...m, isOnline: data.isOnline, lastSeen: new Date().toISOString() } : m));
        }
      } catch (err) {
        console.error("[Admin WebSocket] Failed to parse message:", err);
      }
    };

    ws.onclose = () => {
      console.log("[Admin WebSocket] Connection closed.");
      socketRef.current = null;
    };

    ws.onerror = (err) => {
      console.error("[Admin WebSocket] Connection error:", err);
      socketRef.current = null;
    };

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [authed, loadInitialData]);

  const handleDeleteRoom = async (roomId) => {
    try {
      await api.rooms.delete(roomId);
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
    } catch (err) {
      console.error("Failed to delete room:", err);
      alert("Roomの削除に失敗しました。");
    }
  };

  if (!authed) {
    return <AdminLogin onAuthenticated={() => setAuthed(true)} />;
  }

  if (selectedRoomId) {
    return (
      <AdminRoomDetail
        roomId={selectedRoomId}
        rooms={rooms}
        members={members}
        socket={socketRef.current}
        onBack={() => setSelectedRoomId(null)}
      />
    );
  }

  const getMembersForRoom = (roomId) => members.filter((m) => m.roomId === roomId);
  const getOnlineCountForRoom = (roomId) => {
    return members.filter((m) => m.roomId === roomId && m.isOnline).length;
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-950/90 backdrop-blur-md border-b border-gray-900 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-white font-bold text-lg">制御パネル</h1>
            <p className="text-gray-600 text-xs mt-0.5">狂気メイド喫茶 Admin Console (WebSocket Live)</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadInitialData}
              className="p-2 text-gray-500 hover:text-gray-300 transition-colors rounded-lg hover:bg-gray-900"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={handleLogout}
              className="p-2 text-gray-500 hover:text-red-400 transition-colors rounded-lg hover:bg-gray-900"
              title="ログアウト"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-2xl mx-auto flex gap-1 mt-4">
          <button
            onClick={() => setActiveTab("rooms")}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${
              activeTab === "rooms" ? "bg-gray-800 text-white" : "text-gray-600 hover:text-gray-400"
            }`}
          >
            Rooms
          </button>
          <button
            onClick={() => setActiveTab("menu")}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${
              activeTab === "menu" ? "bg-gray-800 text-white" : "text-gray-600 hover:text-gray-400"
            }`}
          >
            メニュー管理
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        {apiError && (
          <div className="mb-4 p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-300 text-sm">
            {apiError}
          </div>
        )}
        {activeTab === "rooms" && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {[
                { label: "総Room数", value: rooms.length, color: "text-white" },
                { label: "総ゲスト数", value: members.length, color: "text-pink-400" },
                { label: "オンライン", value: members.filter((m) => m.isOnline).length, color: "text-green-400" },
              ].map((stat) => (
                <div key={stat.label} className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
                  <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                  <p className="text-gray-600 text-xs mt-1">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Create room button */}
            <button
              onClick={() => setShowCreateRoom(true)}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-dashed border-gray-800 hover:border-pink-800 text-gray-600 hover:text-pink-400 transition-all mb-4 text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              新しいRoom作成
            </button>

            {/* Room list */}
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-4 border-gray-800 border-t-pink-500 rounded-full animate-spin" />
              </div>
            ) : rooms.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-600 text-4xl mb-4">🏠</p>
                <p className="text-gray-500 text-sm">まだRoomがありません</p>
                <p className="text-gray-700 text-xs mt-1">上のボタンから作成してください</p>
              </div>
            ) : (
              <div className="space-y-3">
                {rooms.map((room) => (
                  <RoomCard
                    key={room.id}
                    room={room}
                    memberCount={getMembersForRoom(room.id).length}
                    onlineCount={getOnlineCountForRoom(room.id)}
                    onClick={() => setSelectedRoomId(room.id)}
                    onDelete={handleDeleteRoom}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === "menu" && <MenuItemManager />}
      </div>

      {/* Create room modal */}
      {showCreateRoom && (
        <CreateRoomModal
          onClose={() => setShowCreateRoom(false)}
          onCreated={(room) => {
            setRooms((prev) => [room, ...prev]);
            setShowCreateRoom(false);
          }}
        />
      )}
    </div>
  );
}