# Cloudflare Dashboard 手動デプロイ手順書

本手順書は、Wrangler CLI（コマンドラインツール）を使用せず、**Cloudflare Dashboard（管理Web画面）のGUI操作のみ**で、本システムの「静的フロントエンド（Vite）」および「Durable Objects (SQLite 搭載) バックエンド」をデプロイするための詳細マニュアルです。

---

## 前提条件

1. **Cloudflare アカウント:**
   - [Cloudflare Dashboard](https://dash.cloudflare.com/) にログインできること。
2. **Durable Objects の利用資格:**
   - Durable Objects は、Cloudflare **Workers Paid プラン（月額 $5〜）**でのみ利用可能です。デプロイ先の Cloudflare アカウントで Workers Paid が有効になっていることを確認してください。
3. **ローカルでの事前ビルド:**
   - デプロイする静的ファイル一式（`dist` ディレクトリ）を準備するため、ローカルで事前に一度ビルドを行ってください。
   ```bash
   npm run build
   ```
   ビルド完了後、プロジェクト直下に生成される `dist/` ディレクトリ内のファイルをダッシュボードへアップロードします。

---

## 手順 1. Durable Objects の作成と有効化

Durable Objects は、通常の Workers デプロイ時にバインディング（紐付け）を定義することで自動生成されます。手動で最初に行う設定はありませんが、アカウントが **Workers Paid** プランに加入している必要があります。

---

## 手順 2. Workers & Pages の新規作成

1. **Cloudflare Dashboard** にログインします。
2. 左メニューから **「Workers & Pages」（Workers と Pages）** を選択します。
3. 画面右上の **「Create Application」（アプリケーションの作成）** ボタンをクリックします。
4. **「Workers」** タブが選択されている状態で、**「Create Worker」（Worker の作成）** ボタンをクリックします。
5. Worker に任意の名前（例: `maid-cafe-menu`）を入力し、画面右下の **「Deploy」（デプロイ）** をクリックします。
   *(※この段階では、デフォルトのハローワールドコードがデプロイされます。次のステップで上書きします)*

---

## 手順 3. 環境変数（ADMIN_PASSWORD）の設定

管理画面や各種管理用APIの認証に利用するパスワードを設定します。

1. 作成した Worker の詳細ダッシュボード画面を開きます。
2. 上部タブから **「Settings」（設定）** ＞ **「Variables」（変数）** を選択します。
3. **「Environment Variables」（環境変数）** セクションで **「Add Variable」（変数の追加）** をクリックします。
4. 以下の通り入力します：
   - **Name（名前）:** `ADMIN_PASSWORD`
   - **Type（タイプ）:** `Encrypt / Secret` (暗号化) または `Text`
   - **Value（値）:** 任意のパスワード（例: `maid2024`）
5. **「Save and Deploy」（保存してデプロイ）** をクリックします。

---

## 手順 4. Durable Objects バインディングの設定

本システムの持久ストレージ（SQLite & WebSockets）である Durable Object を Worker に紐付けます。

1. Worker の **「Settings」（設定）** ＞ **「Bindings」（バインディング）** セクションにスクロールします。
2. **「Add」（追加）** または **「Add Binding」（バインディングの追加）** をクリックし、**「Durable Object」** を選択します。
3. 以下の通り設定値を入力します：
   - **Variable Name（変数名）:** `MAID_CAFE_DO`
   - **Class Name（クラス名）:** `MaidCafeDO`
   - **Durable Object Namespace（名前空間）:**
     - 既存のものが無い場合は、新規にクラス名 `MaidCafeDO` を指定して、Durable Object 名前空間をその場で新規作成・紐付けます。
4. **「Save and Deploy」（保存してデプロイ）** をクリックします。

---

## 手順 5. マイグレーションの実行

Durable Objects で SQLite クラスを新規に定義するために、Cloudflare 上でマイグレーション定義（新しい Durable Object クラスの定義登録）を適用する必要があります。

1. Worker の **「Settings」（設定）** ＞ **「Durable Objects」** セクションに移動します。
2. マイグレーション設定（Migrations）欄で、新規登録を行います。
3. `wrangler.json` に記載されているマイグレーション設定を GUI 上で手動でマッピングします：
   - **Tag（タグ）:** `v1`
   - **New SQLite Classes（新規SQLiteクラス）:** `MaidCafeDO`
4. 変更を保存して適用します。

---

## 手順 6. Worker コード (`worker.js`) の手動アップロード・貼り付け

Vite ビルドプロセスによって、`server/worker.js` の内容は `dist/_worker.js` に自動的にコピーされています。このコードを Cloudflare のオンラインエディタに直接貼り付けます。

1. ローカル環境の `server/worker.js` の全内容、またはビルド成果物である `dist/_worker.js` の内容をすべてコピーします。
2. Cloudflare Dashboard の Worker 画面右上にある **「Edit Code」（コードを編集）** ボタンをクリックします。
3. ブラウザ上にオンラインエディタ（VS Code ライクな画面）が開きます。
4. 左メニューのファイルリストから、メインファイル（通常 `index.js` または `worker.js`）を開きます。
5. エディタ内の既存のコードをすべて削除し、手順 1 でコピーした `worker.js` の内容をそのまま貼り付けます。
6. 画面右上の **「Save and Deploy」（保存してデプロイ）** ボタンをクリックします。

---

## 手順 7. フロントエンド静的アセット (`dist/` 配下) のアップロード

Cloudflare Workers に静的アセット（HTML/CSS/JSなど）を一緒にホスト・配信させるための手順です。

1. **「Workers & Pages」** ＞ **「Pages」** 連携を利用するか、または上記で作成した Worker に静的アセット（`ASSETS` バインディング）を直接アップロードします。
2. Dashboard 上で静的配信用の **Pages アプリケーション** を別途新規作成します。
   - **「Create Application」** ＞ **「Pages」** タブ ＞ **「Upload assets」（アセットを直接アップロード）** を選択。
   - プロジェクト名（例: `maid-cafe-frontend`）を入力。
   - **「Upload」（アップロード）** 領域に、ローカルでビルドして得られた `dist/` ディレクトリそのものをドラッグ＆ドロップします（※`dist/` ディレクトリの中に `index.html` や `assets/` フォルダが直接入っている状態にしてください）。
   - アップロード完了後、**「Deploy site」（サイトをデプロイ）** をクリックします。

---

## 手順 8. ドメイン・ルーティングの統合（オプション）

Pages（フロントエンド）と Worker（バックエンド API / WebSocket）を同一ドメイン下で安全に協調動作させます。

1. Pages の **「Custom Domains」（カスタムドメイン）** で、運用したいドメインを設定します。
2. Worker 側でも、同一ドメインの `/api/*` パスに対するリクエストが Worker に転送されるよう、**「Triggers」（トリガー）** タブの **「Routes」（ルート）** 設定にてルートを追加します：
   - **Route:** `example.com/api/*`
   - **Zone:** 対象のドメインゾーン
3. これにより、ブラウザ上の同一ドメイン(`/api`)から、CORS制約を回避しながら安全に Durable Object の SQLite / WebSocket 接続へアクセスできるようになります。
