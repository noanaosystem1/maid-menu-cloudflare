# 技術アーキテクチャ・システム設計仕様書

本仕様書は、**「狂気メイド喫茶 — デジタルメニュー制御システム」**のバックエンドからフロントエンドに至るまでの詳細な技術、アーキテクチャ、リアルタイム同期システム、データベース設計、およびセキュリティ設計について記述したものです。

---

## 1. 全体アーキテクチャ概要

本システムは、Cloudflare Workers のサーバリソースおよびコスト削減を追求した**「100% D1-Free（外部RDB非依存）エッジネイティブ・アーキテクチャ」**を採用しています。Durable Objects 内蔵の SQLite データベースに加え、接続管理には **Cloudflare WebSocket Hibernation（冬眠）API** を全面採用。全ての更新トリガーを WebSocket 接続へ寄せ、管理画面の周期ポーリングを廃止（完全WebSocket化）することで、リクエスト消費量を極限まで抑制します。

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                    Cloudflare Edge                      │
                    │                                                         │
  ┌──────────┐      │  ┌─────────────────┐      Proxy      ┌───────────────┐  │
  │ 管理画面 ├──────┼─►│                 ├────────────────►│               │  │
  │ (WS常時) │      │  │ Cloudflare      │ (WebSocket API) │ MaidCafeDO    │  │
  └──────────┘      │  │ Worker Proxy    │                 │ Durable       │  │
                    │  │ (Entrypoint)    │◄────────────────┤ Object        │  │
  ┌──────────┐      │  │                 │  Hibernation    │ (SQLite DB    │  │
  │ ゲスト画 ├──────┼─►│                 │  Real-time Sync │ & WebSockets) │  │
  │ 面 (WS)  │      │  └────────┬────────┘                 └───────────────┘  │
  └──────────┘      │           │                                             │
                    │           ▼                                             │
                    │  ┌─────────────────┐                                     │
                    │  │ Cloudflare      │                                     │
                    │  │ ASSETS          │                                     │
                    │  │ (Vite Static)   │                                     │
                    │  └─────────────────┘                                     │
                    └─────────────────────────────────────────────────────────┘
```

### 主要コンポーネントの役割

1. **Cloudflare Worker Proxy (エントリーポイント / `server/worker.js`):**
   - HTTP/HTTPS リクエストのフロントエンド側プロキシとして動作。
   - `OPTIONS` メソッドによるプリフライト（CORS）要求をエッジで瞬時に処理。
   - `/api` 以外のパスに対するリクエストを `Cloudflare ASSETS` (静的ファイル配信) にルーティング（フォールバック付き）。
   - メインのデータストアかつ WebSocket サーバーである Durable Object（`MaidCafeDO`）への WebSocket アップグレードを仲介。
2. **Durable Objects (`MaidCafeDO` / `server/worker.js` 内):**
   - **状態（State）の永続化と一貫性の担保:** インメモリ SQLite データベースを内包し、ディスク永続化と超高速アクセスを同時に実現。
   - **WebSocket 冬眠 (Hibernation) API によるコネクション管理:**
     - メモリ（JavaScript変数空間）上のソケット保持用配列（`this.sessions`）を完全に排除。
     - Cloudflare 独自の `state.acceptWebSocket(ws)` API に接続管理を全面的に委ねます。
     - 接続中ソケットに関連情報（`roomId`, `guestId`, `role` [admin/guest] 等）を `serializeAttachment()` で暗黙的に添付。
     - 通信がない非アクティブ時は、オブジェクトインスタンスが自動的に「冬眠（Hibernation）」して稼働時間（GB-秒枠）の消費をゼロ化。メッセージ到着時のみ自動でメモリ上に復帰し起動します。
3. **フロントエンド SPA (`src/`):**
   - React + Vite + Tailwind CSS を用いた、シングルページアプリケーション。
   - ゲスト画面だけでなく、**管理画面（`Admin.jsx`）も完全WebSocket常時接続に統一**し、周期HTTPポーリング（`setInterval`）を完全に廃止しました。

---

## 2. データベース設計（Durable Objects 内蔵 SQLite）

本システムは、Durable Object の `ctx.storage.sql` を直接実行して SQLite テーブルを生成・制御しています。

### 2.1 テーブル構造 (スキーマ)

データベースの初期化は `MaidCafeDO` インスタンス生成時に、以下のSQL文を実行して適用されます。

```sql
-- 1. ルーム（座席・テーブル）
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,               -- UUID もしくはユニーク文字列
  name TEXT NOT NULL,                -- ルーム表示名 (例: "テーブルA")
  phase TEXT NOT NULL DEFAULT 'WAITING', -- 演出フェーズ (WAITING, MENU_OPEN, HACKING, BLACKOUT など)
  created_date TEXT NOT NULL         -- ISO8601日時文字列
);

-- 2. ゲスト（お客様・入室セッション）
CREATE TABLE IF NOT EXISTS guest_users (
  id TEXT PRIMARY KEY,               -- ゲストUUID
  name TEXT NOT NULL,                -- ゲストのニックネーム
  room_id TEXT NOT NULL,             -- 所属ルームID
  session_token TEXT NOT NULL UNIQUE, -- 招待リンク等で使用されるセッショントークン
  is_active INTEGER NOT NULL DEFAULT 1, -- セッションが有効か否か (0=無効, 1=有効)
  is_online INTEGER NOT NULL DEFAULT 0, -- オンライン状態 (0=オフライン, 1=オンライン)
  last_seen TEXT,                    -- 最終アクティブ時刻 (ISO8601)
  created_date TEXT NOT NULL         -- ISO8601日時文字列
);

-- 3. メニュー（デジタルメニュー用マスタデータ）
CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,               -- メニュー項目UUID
  name TEXT NOT NULL,                -- メニュー名
  price REAL NOT NULL DEFAULT 0,     -- 価格
  category TEXT NOT NULL DEFAULT 'food', -- カテゴリ (food, drink, dessert, special など)
  description TEXT,                  -- 商品説明文
  image_url TEXT,                    -- 商品画像パス/URL
  order_index INTEGER NOT NULL DEFAULT 0, -- 表示並び順用インデックス
  created_date TEXT NOT NULL         -- ISO8601日時文字列
);
```

### 2.2 トランザクションと一貫性
- **インメモリアクセス:** すべてのクエリがエッジ上の超低遅延インメモリ SQLite で動作するため、ミリ秒以下でクエリが完結します。
- **データ不整合の排除:** Durable Object へのアクセスは、単一スレッドで順番にシリアライズされて処理されるため、データに対する同時書き込みによるデッドロックや不整合が論理的に防がれます。

---

## 3. WebSockets によるリアルタイム同期メカニズム（冬眠API採用）

本システムのコアとなるリアルタイム同期エンジンは、Cloudflare WebSocket Hibernation API を最大限利用するように最適化されています。

### 3.1 冬眠 (Hibernation) 接続フロー

```
管理画面 / ゲスト画面                          Worker (Proxy)                   Durable Object (DO)
      │                                       │                                     │
      │─── 1. HTTP Upgrade (GET /api/ws) ────►│                                     │
      │                                       │─── 2. Connect DO (/connect-ws) ────►│
      │                                       │                                     │  (ws.accept() を実行)
      │                                       │                                     │  (state.acceptWebSocket(ws) で登録)
      │                                       │                                     │  (serializeAttachment(...) で)
      │                                       │                                     │  ({ roomId, guestId, role } を暗黙添付)
      │                                       │◄─────── 3. WS Accept Handshake ─────│
      │◄────── 4. Established (101) ──────────│                                     │
      │                                                                             │
      │      [ 通信がない非アクティブ時 ]                                            │
      │                                                                             │  (DOインスタンスが自動的に冬眠)
      │                                                                             │  (GB-秒の課金消費を完全停止)
      │                                                                             │
      │─── 5. Send Command Message (JSON) ─────────────────────────────────────────►│  (自動復帰 / インスタンス活性化)
      │                                                                             │  (webSocketMessage(ws, msg)発火)
```

1. **メタデータ永続化とステートレス管理 (`serializeAttachment`):**
   - 接続が確立された際、Durable Object 側で `ws.serializeAttachment({ roomId, guestId, role: "admin" | "guest" })` を呼び出して、ソケット自身にメタデータを添付します。
   - `this.sessions` のような JavaScript の配列でソケットインスタンスをメモリ保持し続ける必要はありません。
2. **自動省電力と冬眠:**
   - メッセージのやりとりがない間、Cloudflare は Durable Object を冬眠（Hibernation）状態にし、不要なメモリ確保や CPU 実行時間（GB-秒）の消費を完全に自動で停止します。
   - クライアントからのメッセージ送信やサーバー側での状態変更（ブロードキャスト）のトリガーによって、自動でシームレスに冬眠から復帰します。
3. **常時接続（繋ぎっぱなし）の原則:**
   - 旧仕様に存在していた「静的フェーズ（`WAITING` や `BLACKOUT`）の時は WebSocket を切断する」という仕様は完全に廃止されました。
   - 状態に関わらず常に WebSocket は繋ぎっぱなしとし、通信がない時のリソース消費はすべて冬眠 API で自動節約する設計に統一されています。

### 3.2 フェーズブロードキャストパターン (`PHASE_UPDATE`)

管理者用 WebSocket 接続からフェーズ変更コマンドが送信された際の内部制御フローです。

```
管理画面 (Admin)                          Durable Object (DO)          対象ルームのゲスト
      │                                        │                               │
      │─── 1. Send WS Command Message ────────►│                               │
      │    (type: "SET_PHASE", phase: "HACKING",│                               │
      │     password: "maid2024")              │ (webSocketMessage発火)        │
      │                                        │ (パスワード認証 & SQLite更新)  │
      │                                        │ (state.getWebSockets()で検索)  │
      │                                        │                               │
      │                                        │─────── 2. WS Broadcast ──────►│
      │                                        │        (PHASE_UPDATE)         │
```

- **選択的ブロードキャスト (`state.getWebSockets(roomId)`)**:
  - `state.getWebSockets()` を用いて、現在 DO に属している全 WebSocket コネクションを取得。
  - 各ソケットに添付されたアタッチメント情報（`deserializeAttachment()`）を検証し、該当の `roomId` に属する接続に対してのみメッセージをブロードキャストします。

---

## 4. 管理画面の完全WebSocket化設計

Workers の 1日 10万回リクエスト（Freeプラン制限など）を消費しないために、ポーリングおよび従来の REST API（HTTP PATCH）を廃止し、すべて WebSocket のフレーム（メッセージ）送信へと移行しました。

1. **周期ポーリング（`setInterval`）の完全廃止:**
   - 管理画面はロード時に一度だけ WebSocket 接続を確立し、それ以降はルーム、メンバー、オンライン状態の更新をすべてプッシュ通知として WebSocket 経由で受け取ります。これにより、1秒ごとに実行されていた無駄な HTTP GET 要求が完全にゼロになります。
2. **演出・フェーズ変更の WS メッセージ化:**
   - フェーズ変更の操作も、従来の `PATCH /api/rooms/:id` ではなく、WebSocket 上で `{"type": "SET_PHASE", "roomId": "...", "phase": "HACKING", "password": "..."}` などの JSON メッセージを送信して行われます。

---

## 5. セキュリティ・認証・アクセス制御 (ACL) 設計

WebSocket 中心設計への移行に伴い、認証方式とアクセス制御リスト（ACL）が最適化されました。

1. **WebSocket 上での直接パスワード検証:**
   - 従来の「HTTP APIヘッダーでの検証」に加え、WebSocket 上で管理者権限が必要なコマンド（演出フェーズの変更、ルーム管理、ゲストの強制削除や追加など）を要求する際、送信メッセージ（JSON）内に直接パスワード（パスワード文字列）を含めて送信します。
   - Durable Object（`MaidCafeDO`）内部で、環境変数 `ADMIN_PASSWORD` とメッセージ内のパスワードが直接検証され、検証に合格した場合のみ操作を実行し、結果をブロードキャストします。
2. **ロールベースのソケットマーク（権限アタッチメント）:**
   - WebSocket 接続時に認証情報を提供するか、または接続確立後の初期メッセージで認証に成功すると、対象のソケットのアタッチメント情報に `role: "admin"` が付与されます。
   - `role: "admin"` が添付された接続からのみ、管理コマンドが実行可能となります。
3. **安全な一般公開用エンドポイント (ACL):**
   - 静的アセットの取得、`/api/ws` へのアップグレード要求、一般のゲストとしての WebSocket 受信はパスワード不要（一般公開）です。
   - これにより、一般ユーザー画面に不要なパスワード情報や機密データが一切露出せず、安全性が担保されます。
