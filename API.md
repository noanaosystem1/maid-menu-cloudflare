# 狂気メイド喫茶 — Cloudflare Worker API 仕様書 (Durable Objects SQLite + WebSockets リアルタイム同期版)

本システムは、**Cloudflare Workers** の **Durable Objects (SQLite 搭載)** を全面採用した、100% D1-Free（D1データベース非依存）のリアルタイム分散制御システムです。
データストアの全操作が単一の Durable Object インスタンス (`MaidCafeDO`) 内の SQLite に対して実行され、WebSocket 接続されたクライアントにリアルタイムに状態変更がブロードキャストされます。

外部サービスやフロントエンドから本システムと連携できるよう、すべての API のリクエスト形式と、成功・失敗時のレスポンス形式を具体例とともに以下に詳しく記述します。

---

## 1. 共通仕様

- **ベース URL**: `http://localhost:8787/api` (ローカル開発時) / `https://<your-subdomain>.workers.dev/api` (本番時)
- **プロトコル**: HTTPS (REST API) / WSS (WebSocket)
- **Content-Type**: `application/json` (REST API リクエスト/レスポンス)
- **CORS**: すべてのオリジンに対して CORS を許可しています。
  - 許可メソッド: `GET`, `HEAD`, `POST`, `PATCH`, `PUT`, `DELETE`, `OPTIONS`
  - 許可ヘッダー: `Content-Type`, `X-Admin-Password`, `Authorization`
- **管理者認証**:
  - データの更新・削除を行うすべてのミューテーション操作（`POST`, `PATCH`, `DELETE`）、およびクエリパラメータなしのゲスト全件取得には管理者認証が必要です。
  - **認証方法**: リクエストヘッダーに `X-Admin-Password` または `Authorization` を付与し、正しいパスワードを設定してください。
  - **パスワード**: Worker の環境変数 `ADMIN_PASSWORD` (デフォルトは `"maid2024"`) と照合されます。
  - **認証失敗時のレスポンス (共通)**:
    - **ステータス**: `401 Unauthorized`
    - **ボディ**:
      ```json
      { "error": "Unauthorized access" }
      ```

---

## 2. WebSocket リアルタイム接続 API (`/api/ws`)

クライアント（ゲスト画面、管理画面等）がリアルタイム同期を行うための双方向通信エンドポイントです。

- **メソッド**: `GET`
- **パス**: `/api/ws`
- **認証**: 不要（一般公開）
- **クエリパラメータ**:
  - `roomId` (string, **必須**): 接続先となるルームのUUID。指定しない場合は `400 Bad Request` となります。
  - `guestId` (string, 任意): 接続するゲストのID。指定すると、接続開始時に自動的にデータベースの `is_online` が `1` に更新され、切断時には自動的に `0` に戻ります。

### 2.1 接続・アップグレード動作
- **リクエストヘッダー**:
  - `Upgrade: websocket`
  - `Connection: Upgrade`
- **接続成功時 (101 Switching Protocols)**:
  - 接続が確立されると、Durable Object から接続したクライアントに対して、現在のルームフェーズを通知するメッセージが即座に送られます。
- **接続失敗時 (400 Bad Request)**:
  - `roomId` がクエリパラメータに含まれていない場合。
  - **ボディ**:
    ```json
    { "error": "roomId is required" }
    ```
- **接続失敗時 (426 Upgrade Required)**:
  - WebSocket アップグレード用のヘッダーが欠落している場合。
  - **レスポンス**: `Expected Upgrade: websocket` (プレーンテキスト)

### 2.2 ブロードキャストメッセージ (下り)
サーバーから WebSocket を通じてクライアントに送信される JSON メッセージのフォーマットです。

#### 2.2.1 フェーズ更新通知 (`PHASE_UPDATE`)
ルームの進行フェーズ（待機中、メニュー表示中、ハッキング、ブラックアウトなど）が更新された際に、該当ルームの全クライアントに配信されます。また、WebSocket 接続完了時に必ず最初に1回送信されます。
- **ペイロード形式**:
  ```json
  {
    "type": "PHASE_UPDATE",
    "phase": "MENU_OPEN"
  }
  ```
  - `phase` 有効値: `WAITING` / `MENU_OPEN` / `HACKING` / `BLACKOUT` 等

#### 2.2.2 ゲスト状態更新通知 (`GUEST_UPDATE`)
ゲストのオンライン・オフラインなどの状態が変化した際に、該当ルームに属するすべての WebSocket 接続に配信されます。
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
登録されているルームの一覧情報を降順（作成日順）で全件取得します。

- **メソッド / パス**: `GET /api/rooms`
- **認証**: 不要（一般公開）
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

### 3.2 ルーム詳細取得
指定した ID のルーム詳細情報を取得します。

- **メソッド / パス**: `GET /api/rooms/:id`
- **認証**: 不要（一般公開）
- **成功レスポンス 200 (OK)**:
  ```json
  {
    "id": "96ca036a-222c-4396-b0bd-2050fd8c1987",
    "name": "テーブルA",
    "phase": "WAITING",
    "created_date": "2026-07-10T14:56:02.130Z"
  }
  ```
- **失敗レスポンス 404 (Not Found)**:
  - 指定された ID のルームが存在しない場合。
  ```json
  { "error": "Room not found" }
  ```

---

### 3.3 ルーム新規作成
新しくルーム（座席・テーブル）を登録します。

- **メソッド / パス**: `POST /api/rooms`
- **認証**: 必要 (`X-Admin-Password` or `Authorization`)
- **リクエスト Body (JSON)**:
  ```json
  {
    "id": "96ca036a-222c-4396-b0bd-2050fd8c1987", 
    "name": "テーブルA",
    "phase": "WAITING"
  }
  ```
  - `id` (string, 任意): UUID。指定しない場合は、Worker 側で自動的に UUID が生成・割り当てられます。
  - `name` (string, 必須): ルーム名
  - `phase` (string, 必須): 初期フェーズ（例: `WAITING`）
- **成功レスポンス 201 (Created)**:
  ```json
  {
    "id": "96ca036a-222c-4396-b0bd-2050fd8c1987",
    "name": "テーブルA",
    "phase": "WAITING",
    "created_date": "2026-07-11T02:15:30.123Z"
  }
  ```
- **失敗レスポンス 400 (Bad Request)**:
  - JSONパースエラー、または必須パラメータが欠落している場合。
  ```json
  { "error": "name and phase are required" }
  ```
- **失敗レスポンス 500 (Internal Server Error)**:
  - SQLite の一意制約エラーなど、DB 書き込みに致命的エラーが発生した場合。
  ```json
  { "error": "Durable Object SQLite execution failed" }
  ```

---

### 3.4 ルーム情報の更新（フェーズ変更等）
指定したルームの名前や進行フェーズを更新します。

- **メソッド / パス**: `PATCH /api/rooms/:id`
- **認証**: 必要 (`X-Admin-Password` or `Authorization`)
- **リクエスト Body (JSON)**:
  ```json
  {
    "name": "新テーブルA",
    "phase": "HACKING"
  }
  ```
  - `name` (string, 任意): 更新するルーム名
  - `phase` (string, 任意): 更新するフェーズ
- **動作**: `phase` が更新された場合、接続されている該当ルームの全 WebSocket クライアントへリアルタイム通知 (`PHASE_UPDATE`) がブロードキャストされます。
- **成功レスポンス 200 (OK)**:
  ```json
  {
    "id": "96ca036a-222c-4396-b0bd-2050fd8c1987",
    "name": "新テーブルA",
    "phase": "HACKING",
    "created_date": "2026-07-10T14:56:02.130Z"
  }
  ```
- **失敗レスポンス 404 (Not Found)**:
  - 指定された ID のルームが存在しない場合。
  ```json
  { "error": "Room not found" }
  ```

---

### 3.5 ルーム削除
指定したルームを削除します。ルームに紐づくすべてのゲスト（`guest_users`）も、カスケード的に自動削除されます。

- **メソッド / パス**: `DELETE /api/rooms/:id`
- **認証**: 必要 (`X-Admin-Password` or `Authorization`)
- **成功レスポンス 204 (No Content)**:
  - ボディなし（空文字）

---

## 4. Guests API (ゲスト管理)

### 4.1 ゲスト一覧取得
登録されているゲスト情報を取得します。

- **メソッド / パス**: `GET /api/guests`
- **クエリパラメータ (任意)**:
  - `roomId=<id>`: 特定のルームに所属しているゲストのみを抽出します。(**認証不要**)
  - `sessionToken=<token>`: 招待リンクのトークンに紐づく特定の1名を抽出します。(**認証不要**)
- **認証仕様**:
  - `roomId` または `sessionToken` が**指定されている場合**: **認証不要（一般公開）**
  - パラメータなしで**全件リストを取得する場合**: **管理者認証が必要** (`X-Admin-Password`)
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

### 4.2 ゲスト登録（招待リンク発行）
新しくルームにお客様を登録（招待リンク発行用情報の作成）します。

- **メソッド / パス**: `POST /api/guests`
- **認証**: 必要 (`X-Admin-Password` or `Authorization`)
- **リクエスト Body (JSON)**:
  ```json
  {
    "id": "b8f8e6f1-33f6-4fe0-bdbe-f9d9bf2a396c",
    "name": "さくら",
    "roomId": "96ca036a-222c-4396-b0bd-2050fd8c1987",
    "sessionToken": "token-abc-123",
    "isActive": true,
    "isOnline": false
  }
  ```
  - `id` (string, 任意): UUID。指定しない場合は Worker 側で自動的に生成されます。
  - `name` (string, 必須)
  - `roomId` (string, 必須): 所属させるルームのID
  - `sessionToken` (string, 必須): ユニークなトークン文字列
  - `isActive` (boolean, 任意): デフォルトは `true`
  - `isOnline` (boolean, 任意): デフォルトは `false`
- **成功レスポンス 201 (Created)**:
  ```json
  {
    "id": "b8f8e6f1-33f6-4fe0-bdbe-f9d9bf2a396c",
    "name": "さくら",
    "roomId": "96ca036a-222c-4396-b0bd-2050fd8c1987",
    "sessionToken": "token-abc-123",
    "isActive": true,
    "isOnline": false,
    "lastSeen": null,
    "created_date": "2026-07-10T14:56:36.728Z"
  }
  ```
- **失敗レスポンス 400 (Bad Request)**:
  - 必須パラメータが不足しているか、JSON が破損している場合。
  ```json
  { "error": "name, roomId, sessionToken are required" }
  ```
- **失敗レスポンス 500 (Internal Server Error)**:
  - `sessionToken` の一意制約エラー（既に同じトークンが存在する）等。
  ```json
  { "error": "Unique constraint failed" }
  ```

---

### 4.3 ゲスト情報の更新
ゲスト情報（名前、ルームID、有効フラグ、オンライン状態など）を更新します。

- **メソッド / パス**: `PATCH /api/guests/:id`
- **認証**: **必要** (`X-Admin-Password` or `Authorization`)
  - *注意: 一般公開向けのポーリング API と異なり、本エンドポイントはデータの根本的な更新（名前や所属ルームの変更など）を行うため、管理者認証を必要とします。*
- **リクエスト Body (JSON)**:
  ```json
  {
    "name": "さくら改",
    "roomId": "96ca036a-222c-4396-b0bd-2050fd8c1987",
    "sessionToken": "token-new-456",
    "isActive": true,
    "isOnline": true,
    "lastSeen": "2026-07-10T15:20:00.000Z"
  }
  ```
- **成功レスポンス 200 (OK)**:
  ```json
  {
    "id": "b8f8e6f1-33f6-4fe0-bdbe-f9d9bf2a396c",
    "name": "さくら改",
    "roomId": "96ca036a-222c-4396-b0bd-2050fd8c1987",
    "sessionToken": "token-new-456",
    "isActive": true,
    "isOnline": true,
    "lastSeen": "2026-07-10T15:20:00.000Z",
    "created_date": "2026-07-10T14:56:36.728Z"
  }
  ```
- **失敗レスポンス 404 (Not Found)**:
  - 指定された ID のゲストが見つからない場合。
  ```json
  { "error": "Guest not found" }
  ```

---

### 4.4 ゲスト削除
ゲスト情報をデータベースから完全に削除します。

- **メソッド / パス**: `DELETE /api/guests/:id`
- **認証**: 必要 (`X-Admin-Password` or `Authorization`)
- **成功レスポンス 204 (No Content)**:
  - ボディなし（空文字）

---

## 5. Menu Items API (メニュー管理)

### 5.1 メニュー一覧取得
登録されているすべてのメニュー項目を取得します。

- **メソッド / パス**: `GET /api/menu-items?limit=100`
- **認証**: 不要（一般公開）
- **クエリパラメータ**:
  - `limit` (number, 任意): 取得件数の上限。デフォルトは `100`。
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

### 5.2 メニュー項目追加
新しくメニュー項目を追加します。

- **メソッド / パス**: `POST /api/menu-items`
- **認証**: 必要 (`X-Admin-Password` or `Authorization`)
- **リクエスト Body (JSON)**:
  ```json
  {
    "id": "1",
    "name": "萌え萌えハンバーグ",
    "price": 1280,
    "category": "food",
    "description": "デミグラスたっぷり",
    "imageUrl": "https://example.com/hamburg.jpg",
    "order": 1
  }
  ```
  - `id` (string, 任意): UUID。指定しない場合は Worker 側で自動的に生成されます。
  - `name` (string, 必須): メニュー名
  - `price` (number, 必須): 価格
  - `category` (string, 必須): カテゴリ名 (`food`, `drink`, `dessert`, `special` など)
  - `description` (string, 任意): 商品説明
  - `imageUrl` (string, 任意): 画像URL
  - `order` (number, 必須): 表示順インデックス
- **成功レスポンス 201 (Created)**:
  ```json
  {
    "id": "1",
    "name": "萌え萌えハンバーグ",
    "price": 1280,
    "category": "food",
    "description": "デミグラスたっぷり",
    "imageUrl": "https://example.com/hamburg.jpg",
    "order": 1,
    "created_date": "2026-07-11T03:00:00.000Z"
  }
  ```
- **失敗レスポンス 400 (Bad Request)**:
  - 必須パラメータの欠落、または不正な JSON フォーマット。
  ```json
  { "error": "name, price, category, order are required" }
  ```

---

### 5.3 メニュー項目更新
既存のメニュー項目を更新します。

- **メソッド / パス**: `PATCH /api/menu-items/:id`
- **認証**: 必要 (`X-Admin-Password` or `Authorization`)
- **リクエスト Body (JSON)**:
  ```json
  {
    "price": 1380,
    "description": "特製デミグラスをたっぷりかけた王道ハンバーグ"
  }
  ```
- **成功レスポンス 200 (OK)**:
  ```json
  {
    "id": "1",
    "name": "萌え萌えハンバーグ",
    "price": 1380,
    "category": "food",
    "description": "特製デミグラスをたっぷりかけた王道ハンバーグ",
    "imageUrl": "https://example.com/hamburg.jpg",
    "order": 1,
    "created_date": "2026-07-11T03:00:00.000Z"
  }
  ```
- **失敗レスポンス 404 (Not Found)**:
  - 指定された ID のメニュー項目が見つからない場合。
  ```json
  { "error": "Menu item not found" }
  ```

---

### 5.4 メニュー項目削除
指定されたメニュー項目を削除します。

- **メソッド / パス**: `DELETE /api/menu-items/:id`
- **認証**: 必要 (`X-Admin-Password` or `Authorization`)
- **成功レスポンス 204 (No Content)**:
  - ボディなし（空文字）

---

## 6. Health API (状態確認)

Durable Objects 内の SQLite データストアへの接続を含む、API サービスの健康状態を確認します。

- **メソッド / パス**: `GET /api/health`
- **認証**: 不要（一般公開）
- **成功レスポンス 200 (OK)**:
  ```json
  {
    "ok": true,
    "database": "durable_objects_sqlite"
  }
  ```
