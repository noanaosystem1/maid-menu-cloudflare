# 狂気メイド喫茶 — Cloudflare Worker API 仕様書 (Durable Objects SQLite + WebSocket 完全統合・冬眠API対応版)

本システムは、**Cloudflare Workers** の **Durable Objects (SQLite 搭載)** を全面採用し、さらに **Cloudflare WebSocket Hibernation（冬眠）API** を活用した、100% D1-Free（D1データベース非依存）かつ極めて省電力なリアルタイム分散制御システムです。

従来の周期HTTPポーリングや HTTP PATCH 要求を完全に廃止し、管理画面（Admin）とゲスト画面（Guest）の双方が常に WebSocket で接続され、進行管理コマンドもすべて WebSocket メッセージを介して処理される仕組みに変更されました。これにより、1日の Workers 実行回数をほぼゼロ近くまで削減しています。

---

## 1. 共通仕様

- **ベース URL**: `http://localhost:8787/api` (ローカル開発時) / `https://<your-subdomain>.workers.dev/api` (本番時)
- **プロトコル**: HTTPS (REST API) / WSS (WebSocket)
- **CORS**: すべてのオリジンに対して CORS を許可しています。
  - 許可メソッド: `GET`, `HEAD`, `POST`, `PATCH`, `PUT`, `DELETE`, `OPTIONS`
  - 許可ヘッダー: `Content-Type`, `X-Admin-Password`, `Authorization`

---

## 2. WebSocket リアルタイム常時接続 & 管理コマンド API (`/api/ws`)

クライアント（ゲスト画面、管理画面等）がすべてのリアルタイム同期およびコマンドの送信を行うための統一されたエンドポイントです。
すべての演出フェーズにおいて、接続は切断せず「繋ぎっぱなし（常時接続）」を原則とします。通信がない時は **Cloudflareの冬眠機能** によりサーバーリソースが自動で節約されます。

- **メソッド**: `GET`
- **パス**: `/api/ws`
- **認証**: 不要（一般公開 / コマンド送信時にパスワード検証）
- **クエリパラメータ**:
  - `roomId` (string, **必須**): 接続先となるルームのUUID。指定しない場合は `400 Bad Request` となります。
  - `guestId` (string, 任意): 接続するゲストのID。指定すると、接続開始時に自動的にデータベースの `is_online` が `1` に更新され、切断時には自動的に `0` に戻ります。

### 2.1 メタデータの添付 (`serializeAttachment`)
接続が受理されると、Durable Object 側で以下のオブジェクトが永続データとして接続ソケットにアタッチされます。
```json
{
  "roomId": "96ca036a-222c-4396-b0bd-2050fd8c1987",
  "guestId": "b8f8e6f1-33f6-4fe0-bdbe-f9d9bf2a396c",
  "role": "guest" // または "admin"
}
```

### 2.2 上りメッセージ (クライアント -> サーバー)

#### 2.2.1 演出フェーズの変更要求（管理者コマンド）
管理画面からルームの演出フェーズを切り替える際に、WebSocket 経由で送信するメッセージです。
- **メッセージ形式 (JSON)**:
  ```json
  {
    "type": "SET_PHASE",
    "roomId": "96ca036a-222c-4396-b0bd-2050fd8c1987",
    "phase": "HACKING",
    "password": "maid2024"
  }
  ```
- **バリデーション**:
  - 送信された `password` が、環境変数 `ADMIN_PASSWORD`（デフォルトは `"maid2024"`）と合致しているかを Durable Object 内部で直接検証します。
  - 認証に成功した場合、SQLite 上のルームフェーズを更新し、同ルームに属する全 WebSocket クライアントにフェーズ変更通知（`PHASE_UPDATE`）を配信します。不一致の場合はエラーを返します。

---

### 2.3 下りメッセージ (サーバー -> クライアント)

#### 2.3.1 フェーズ更新通知 (`PHASE_UPDATE`)
ルームの進行フェーズが更新された際、または接続確立時に配信されます。
- **ペイロード形式**:
  ```json
  {
    "type": "PHASE_UPDATE",
    "phase": "MENU_OPEN"
  }
  ```
  - `phase` 有効値: `WAITING` / `MENU_OPEN` / `HACKING` / `BLACKOUT` など

#### 2.3.2 ゲスト状態更新通知 (`GUEST_UPDATE`)
ゲストのオンライン・オフラインの状態が変化した際に、該当ルームの WebSocket 接続に配信されます。
- **ペイロード形式**:
  ```json
  {
    "type": "GUEST_UPDATE",
    "guestId": "b8f8e6f1-33f6-4fe0-bdbe-f9d9bf2a396c",
    "isOnline": true
  }
  ```

---

## 3. Rooms API (ルーム・テーブル管理)

### 3.1 ルーム一覧取得
現在登録されているルームの一覧情報を取得します。（主に入室時や管理画面ロード時の初期化用）。

- **メソッド / パス**: `GET /api/rooms`
- **認証**: 不要
- **成功レスポンス 200 (OK)**:
  ```json
  [
    {
      "id": "96ca036a-222c-4396-b0bd-2050fd8c1987",
      "name": "テーブルA",
      "phase": "WAITING",
      "created_date": "2026-07-10T14:56:02.130Z"
    }
  ]
  ```

---

## 4. Guests API (ゲスト管理)

### 4.1 ゲスト一覧取得 (トークン検証用)
特定のトークンまたは特定のルームに所属しているゲストを取得します。

- **メソッド / パス**: `GET /api/guests`
- **クエリパラメータ (任意)**:
  - `roomId=<id>`: 特定のルームに所属しているゲストのみを抽出します。
  - `sessionToken=<token>`: 招待トークンに紐づく特定の1名を抽出します。
- **認証仕様**:
  - `roomId` または `sessionToken` が**指定されている場合**: 認証不要（一般公開）
- **成功レスポンス 200 (OK)**:
  ```json
  [
    {
      "id": "b8f8e6f1-33f6-4fe0-bdbe-f9d9bf2a396c",
      "name": "さくら",
      "roomId": "96ca036a-222c-4396-b0bd-2050fd8c1987",
      "sessionToken": "token-abc-123",
      "isActive": true,
      "isOnline": true,
      "lastSeen": "2026-07-10T14:57:37.592Z",
      "created_date": "2026-07-10T14:56:36.728Z"
    }
  ]
  ```

---

## 5. Menu Items API (メニュー管理)

### 5.1 メニュー一覧取得
登録されているすべてのメニュー項目を取得します。

- **メソッド / パス**: `GET /api/menu-items?limit=100`
- **認証**: 不要
- **成功レスポンス 200 (OK)**:
  ```json
  [
    {
      "id": "1",
      "name": "オムライス♡",
      "price": 980,
      "category": "food",
      "description": "ふわとろ卵の王道メニュー",
      "imageUrl": null,
      "order": 0,
      "created_date": "2026-07-10T14:53:31.000Z"
    }
  ]
  ```

---

## 6. Health API (状態確認)

Durable Objects 内の SQLite データストアへの接続を含む、API サービスの健康状態を確認します。

- **メソッド / パス**: `GET /api/health`
- **認証**: 不要
- **成功レスポンス 200 (OK)**:
  ```json
  {
    "ok": true,
    "database": "durable_objects_sqlite"
  }
  ```
