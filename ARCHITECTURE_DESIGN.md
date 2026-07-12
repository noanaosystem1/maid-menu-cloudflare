# 技術アーキテクチャ・システム設計仕様書

本仕様書は、**「狂気メイド喫茶 — デジタルメニュー制御システム」**のバックエンドからフロントエンドに至るまでの詳細な技術、アーキテクチャ、リアルタイム同期システム、データベース設計、およびセキュリティ設計について記述したものです。

---

## 1. 全体アーキテクチャ概要

本システムは、**「100% D1-Free（外部RDB非依存）エッジネイティブ・アーキテクチャ」**を採用しています。Cloudflare Workers と Durable Objects 内蔵の SQLite データベースを活用し、すべてのデータをネットワーク最寄りのエッジ上で超低遅延で処理します。

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                    Cloudflare Edge                      │
                    │                                                         │
  ┌──────────┐      │  ┌─────────────────┐      Proxy      ┌───────────────┐  │
  │ 管理画面 ├──────┼─►│                 ├────────────────►│               │  │
  └──────────┘      │  │ Cloudflare      │ (REST / WS API) │ MaidCafeDO    │  │
                    │  │ Worker Proxy    │                 │ Durable       │  │
  ┌──────────┐      │  │ (Entrypoint)    │◄────────────────┤ Object        │  │
  │ ゲスト画 ├──────┼─►│                 │  Real-time DO   │ (SQLite       │  │
  │ 面       │      │  └────────┬────────┘  State Sync     │  Database)    │  │
  └──────────┘      │           │                          └───────────────┘  │
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
   - 管理者認証 (`ADMIN_PASSWORD` ヘッダー照合) を行い、不正なミューテーション操作をブロック。
   - メインのデータストアである Durable Object への WebSocket アップグレードや REST API のプロキシ。
2. **Durable Objects (`MaidCafeDO` / `server/worker.js` 内):**
   - **状態（State）の永続化と一貫性の担保:** インメモリ SQLite データベースを内包し、ディスク永続化と超高速アクセスを同時に実現。
   - **WebSocket コネクション管理:** 接続中クライアントのソケットインスタンスをメモリ上で集約保持。
   - **トランザクション制御:** すべての書き込みと読み込みが単一スレッド（DOの仕組み）で処理されるため、データ競合（Race Condition）が根底から発生しません。
3. **フロントエンド SPA (`src/`):**
   - React + Vite + Tailwind CSS を用いた、シングルページアプリケーション。
   - 状態管理は、ポーリングによる自動補正と、WebSocket による超低遅延フェーズ遷移のハイブリッド構成。

---

## 2. データベース設計（Durable Objects 内蔵 SQLite）

本システムは、Durable Object の `ctx.storage.sql` を直接実行して SQLite テーブルを生成・制御しています。

### 2.1 テーブル構造 (スキーマ)

データベースの初期化は `MaidCafeDO` インスタンス生成時に、以下のSQL文を実行して冪等（`CREATE TABLE IF NOT EXISTS`）に適用されます。

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
  room_id TEXT NOT NULL,             -- 所属ルームID (ForeignKey的な関係)
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
- **データ不整合の排除:** Durable Object へのアクセスはシリアライズされるため、DBに対する同時書き込みによるデッドロックや不整合が論理的に防がれます。
- **カスケード削除の疑似実装:** ルームを削除した際、Workerのハンドラが明示的に `DELETE FROM guest_users WHERE room_id = ?` を実行して、ゾンビデータの発生をクリーンアップします。

---

## 3. WebSockets によるリアルタイム同期メカニズム

本システムの最大の特徴は、管理画面での進行フェーズ切り替えと、各テーブルのゲスト画面の同期にあります。

### 3.1 双方向コネクションフロー

```
ゲスト画面 (Client)                       Worker (Proxy)                   Durable Object (DO)
      │                                       │                                     │
      │─── 1. HTTP Upgrade (GET /api/ws) ────►│                                     │
      │                                       │─── 2. Connect DO (/connect-ws) ────►│
      │                                       │                                     │  (ws.accept() を実行)
      │                                       │                                     │  (Durable Object 内の)
      │                                       │                                     │  (sessions 配列へ追加)
      │                                       │◄─────── 3. WS Accept Handshake ─────│
      │◄────── 4. Established (101) ──────────│                                     │
      │                                                                             │
      │◄────── 5. Broadcast Initial Phase (e.g. WAITING) ───────────────────────────│
```

1. **接続管理:**
   - 接続が確立されると、Durable Object 内の `this.sessions` 配列に `{ ws, roomId, guestId }` オブジェクトが保持されます。
   - `guestId` が渡された場合、自動的に対象ゲストのデータベース行を `is_online = 1` に更新します。

2. **切断およびエラー時の自動クリーンアップ:**
   - クライアントが切断される、あるいはタブを閉じる、またはネットワークエラーが発生すると、`ws.addEventListener("close")` と `error` リスナーが発火。
   - メモリ上の `this.sessions` から該当接続を即座に破棄。
   - データベース（SQLite）の該当ゲストの `is_online` を `0` にリセットし、生存プールの健全性を保ちます。

### 3.2 フェーズブロードキャストパターン (`PHASE_UPDATE`)

管理者が特定のルームの演出進行フェーズを更新した際の内部制御フローです。

```
管理者ダッシュボード                         Worker (Proxy)                   Durable Object (DO)          対象ルームのゲスト
      │                                       │                                     │                       │
      │─── PATCH /api/rooms/:id ─────────────►│                                     │                       │
      │    (phase = "HACKING")                │─── Forward to DO ──────────────────►│                       │
      │                                       │                                     │  (DB更新 & 該当DO稼働) │
      │                                       │                                     │  (broadcastToRoom発火) │
      │                                       │                                     │─────── WS Frame ─────►│
      │                                       │                                     │       (PHASE_UPDATE)  │
      │◄── 200 OK (更新後レコード) ───────────│◄────────────────────────────────────│                       │
```

- **選択的ブロードキャスト:** `broadcastToRoom(roomId, message)` は、`this.sessions` から `session.roomId === roomId` が一致するアクティブなソケットに対してのみフレームを送信します。これにより、多店舗・多テーブルで運用しても混線せず、該当テーブルのみが完璧にシンクロして画面演出が変化します。

---

## 4. フロントエンド・ステート管理 & 負荷最適化設計

フロントエンド React アプリは、クラウド側のコストを最小限に抑え、快適なユーザー体験を実現する設計が取り入れられています。

1. **静的フェーズと動的フェーズの切り分け (負荷最適化):**
   - **静的フェーズ (`WAITING`, `BLACKOUT`):**
     - この演出状態のときは、**WebSocket 接続を完全に遮断**し、無駄なエッジへのロングラン・コネクション接続や、無駄な Worker 起動時間を 0 に抑制します。
     - ゲスト画面の待機状態（WAITING）では、フレンドリーな手動リロードボタンを促すことで、サーバーへのリクエスター負担を劇的に削減します。
   - **動的フェーズ (`MENU_OPEN`, `HACKING`):**
     - インタラクティブなフェーズに突入した時のみ、WebSocket コネクションを自動確立し、リアルタイムのブロードキャスト情報を受信可能にします。

2. **管理画面の自動補正ポーリング:**
   - `Admin.jsx` では、`setInterval` を使用して、1秒間に1回ルーム状況とメンバーのリアルタイム状況を REST API 経由で再同期（ポーリング）しています。これにより、管理者は全テーブルの状態や誰が今オンライン状態にいるかを完全に掌握できます。

---

## 5. セキュリティ・認証設計

本システムは、エッジならではの軽量かつ強固な認証システムで保護されています。

1. **環境変数によるパスワード検証:**
   - 管理画面からの状態変更やデータ操作（ミューテーション）、全ゲストの一覧取得は、Worker 内で環境変数 `ADMIN_PASSWORD` (デフォルトは `"maid2024"`) と直接突き合わせ検証。
   - リクエストヘッダーに `X-Admin-Password` または `Authorization` を付与して認証をパスします。

2. **アクセス制御リスト (ACL):**
   - **認証が必要な操作:** `POST` / `PATCH` / `DELETE` の全 API 操作、パラメータ無しの `GET /api/guests`
   - **認証が不要な一般公開操作:** 静的アセットの取得、`/api/ws` への接続、`GET /api/rooms` (一覧取得)、`GET /api/rooms/:id` (特定のルーム詳細)、特定のクエリパラメータ付き `GET /api/guests`（自分自身のセッショントークン検証用）、`GET /api/menu-items` (メニュー一覧取得)、`GET /api/health`（ヘルスチェック）

3. **プリフライト (OPTIONS) の事前遮断:**
   - すべての REST API エンドポイントの手前で `OPTIONS` リクエストを受け取り、`204 No Content` を CORS 許可ヘッダー付きで返すため、ブラウザ側からの無駄なDBアクセスや計算処理がメイン処理を圧迫するのを防止しています。
