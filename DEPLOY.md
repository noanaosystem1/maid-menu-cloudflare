# Cloudflare Workers & Durable Objects デプロイ・設定マニュアル

本システムを Cloudflare Workers + Durable Objects (内蔵 SQLite) 構成でデプロイ・運用するための総合マニュアルです。
**「Cloudflare ダッシュボード（管理画面）から一切のコマンドライン操作なしでデプロイする方法」**、および**「Wrangler CLI を用いたコマンドラインによる高速デプロイ方法」**の2つについて分かりやすく解説します。

---

## 1. Cloudflare ダッシュボード上で直接デプロイする方法（完全コマンド不要）

GitHub 連携（Workers Builds）を利用し、Cloudflare のダッシュボード（管理画面）の操作だけで、リポジトリのデプロイ、Durable Objects の構成、環境変数の設定まですべて完結できます。

### ステップ 1: GitHub へのリポジトリプッシュ
本ソースコードをお手持ちの GitHub アカウントのリポジトリにプッシュまたはインポートしておきます。

### ステップ 2: Workers & Pages でプロジェクトを作成
1. [Cloudflare 管理画面](https://dash.cloudflare.com)にログインします。
2. 左メニューから **「Workers & Pages（Worker と Pages）」** をクリックします。
3. 画面右上の **「Create application（アプリケーションの作成）」** ボタンをクリックします。
4. **「Workers」** タブにある **「Deploy from Git（Git からデプロイ）」** または **「Connect to Git」** を選択します。
5. ご自身の GitHub アカウントと連携し、該当のリポジトリを選択して **「Begin setup（セットアップの開始）」** をクリックします。

### ステップ 3: ビルド設定の指定
ビルド構成画面にて、以下のように設定を行います：
- **Project name（プロジェクト名）**: 任意のプロジェクト名（例: `maid-cafe-menu`）を入力
- **Production branch（本番ブランチ）**: デプロイ元とするブランチ名（例: `main`）
- **Build command（ビルドコマンド）**: **`npm run build`**
- **Build output directory（ビルド出力ディレクトリ）**: 設定不要（空欄、またはデフォルトのままで問題ありません。プロジェクトの `wrangler.json` にて、静的アセットディレクトリが `./dist` にバインドされているため、自動的に読み込まれます）
- **「Save and deploy（保存してデプロイ）」** をクリックします。
  *(初回デプロイが開始されます。Durable Objects や環境変数の設定前ですが、一度ビルドを完了させます)*

### ステップ 4: Durable Objects (MaidCafeDO) のバインド設定
本システムは SQLite データを Durable Object 内で管理するため、ダッシュボードからバインドを構成する必要があります。
1. デプロイ完了後、作成した Worker の詳細画面を開きます。
2. 上部タブの **「Settings（設定）」** -> **「Variables（変数）」** または **「Bindings（バインディング）」** タブを開きます。
3. **「Durable Object Bindings（Durable Object バインディング）」** セクションを探し、**「Add binding（バインディングの追加）」** をクリックします。
   - **Variable name（変数名）**: **`MAID_CAFE_DO`** *(大文字・アンダースコア必須。wrangler.json と完全に一致させる必要があります)*
   - **Durable Object class（Durable Object クラス）**: 一覧から **`MaidCafeDO`** を選択
4. **「Save and deploy（保存してデプロイ）」** をクリックして設定を保存します。

### ステップ 5: 環境変数 `ADMIN_PASSWORD` の設定
管理画面への不正アクセスを防ぐための管理者パスワードを設定します。
1. 同じく **「Settings（設定）」** -> **「Variables（変数）」** ページにある **「Environment Variables（環境変数）」** セクションを探します。
2. **「Add variable（変数の追加）」** をクリックします。
   - **Variable name（変数名）**: **`ADMIN_PASSWORD`**
   - **Value（値）**: 管理者画面ログインで使用したい任意のパスワードを設定（未設定の場合は、デフォルトで `maid2024` になります）
3. パスワードを暗号化（Encrypt）するか、プレーンテキストのまま **「Save and deploy（保存してデプロイ）」** をクリックします。

### ステップ 6: 再デプロイの実行
1. 設定保存後、画面に表示される指示に従い **「Redeploy（再デプロイ）」** を行うか、再度 GitHub にプッシュすることで、新しいバインディングが適用されたビルドが完全にデプロイされ、公開 URL (`https://<your-project>.<your-subdomain>.workers.dev`) にてサービスが稼働します！

---

## 2. CLI（コマンドライン）を用いた超高速デプロイ方法

開発用 PC などのターミナルから、数行のコマンドだけで一気にビルドからデプロイまでを完了させる方法です。

### ステップ 1: Cloudflare へのログイン
```bash
npx wrangler login
```
自動的にブラウザが開きますので、認証を許可してください。

### ステップ 2: ビルドとデプロイの実行
```bash
npm run build
npm run deploy
```
- このコマンドにより、Vite によるフロントエンドのコンパイルと、`wrangler.json` に基づく Cloudflare Workers への Durable Object スキーマ移行を伴うデプロイが自動で行われます。
- ターミナル上にデプロイ完了のメッセージと、公開アクセス用 URL が出力されます。

### ステップ 3: 本番環境の管理者パスワードの追加
本番環境の `ADMIN_PASSWORD` を設定します。
```bash
npx wrangler secret put ADMIN_PASSWORD
```
コマンド実行後、暗号化して保存したい任意のパスワード（例: `my_secure_maid_password_2026`）を入力して Enter を押してください。

---

## 3. Cloudflare 課金・パフォーマンス試算 (1,000人規模・48時間運用)

本システムを実運用（イベントや実店舗など）で動作させるにあたり、Cloudflare の Durable Objects における課金モデルと、**「1,000人規模、48時間常に同時20人接続」**という条件下におけるランニングコストの理論計算を記述します。

### 3.1 Durable Objects の料金・カウント仕組み

Durable Objects の料金は、主に以下の3つの指標で計算されます：

1. **Durable Objects 要求回数 (Durable Object Requests):**
   - Worker から Durable Object にリクエストが転送、または WebSocket 接続がアップグレードされるたびに 1 回カウントされます。
   - **本システムによる最適化:** REST API 操作や WebSocket 接続確立の際のみ要求が発生し、静的ファイルアセット(HTML/JS/CSS/画像)は Cloudflare のエッジ(ASSETS)から直接返されるため、余計な Durable Object 要求は走りません。

2. **Durable Objects 稼働時間 (Duration / GB-s):**
   - Durable Object がメモリ上で稼働している時間（秒数）に、割り当てられたメモリ容量（標準は 128MB = 0.125GB）を掛け合わせた値（GB秒）です。
   - **Durable Object がアクティブになる契機**: リクエストの受信、タイマー、または開いている WebSocket 接続が存在する間。接続がすべて閉じられると、オブジェクトは自動的にシャットダウンし、稼働時間は停止します。

3. **Durable Object 内蔵 SQLite 読み書き回数 (Storage API / SQL Ops):**
   - SQLite への SQL クエリを実行した回数、または読み書きしたデータサイズによって課金されます。通常の D1 のような複雑な行数ベースではなく、操作件数が基準となります。

---

### 3.2 イベント試算モデルの定義

- **イベント期間**: 48時間（連続稼働：$48 \times 3600 = 172,800$ 秒）
- **総来客規模**: 1,000名（イベント全体で登録・参加するユニークなお客様の総数）
- **同時接続数**: 20名（常時20台の端末がブラウザを開き、WebSocket 接続を開き続けている状態）
- **WebSocket 接続上のリアルタイム処理**:
  - 各接続が維持されている間、オブジェクトが稼働し続けます。
  - ルームのフェーズ更新時、またはゲスト一覧が更新された時のみ下りメッセージが飛びます。

---

### 3.3 料金・リソース消費試算

#### ① Durable Objects 稼働時間 (GB-seconds)
常時 20 名の同時接続 WebSocket が存在するため、48時間のイベント期間中、Durable Object インスタンスは完全に常時稼働（アクティブ状態）となります。

- **総秒数**: $48 \text{ 時間} \times 3,600 \text{ 秒} = 172,800 \text{ 秒}$
- **GB-s 計算**:
  $$172,800 \text{ 秒} \times 0.125 \text{ GB (128MB)} = 21,600 \text{ GB-seconds}$$

> 💡 **Cloudflare 料金比較**:
> - **無料枠 (Workers Paid 基本料金 $5/月に付属)**: **100万 GB-seconds**
> - **判定**: 今回消費する 21,600 GB-s は、無料枠の 100万 GB-s に対してわずか **2.16%** です。追加費用は **$0.00 (完全無料)** です。

---

#### ② Durable Object 要求数 (Requests)
- **要求数カウント要因**:
  1. ゲストの WebSocket 接続確立時: 1,000名 $\times$ 1回 = 1,000リクエスト
  2. 管理画面等からの REST API 操作 (ルーム作成、フェーズ変更、ゲスト登録など): イベント期間通算で約 2,000リクエスト
- **合計リクエスト数**: 約 3,000 リクエスト

> 💡 **Cloudflare 料金比較**:
> - **無料枠 (Workers Paid 基本料金 $5/月に付属)**: **1,000万 Requests / 月**
> - **判定**: 無料枠の 1,000万リクエストに対し、3,000リクエストは無視できるほど小さな数字です。当然追加料金は **$0.00** となります。

---

### 3.4 まとめ

本システムの **「Durable Objects SQLite + WebSocket 双方向通信」** 設計により、高頻度ポーリングによるデータベースサーバー負荷が根本から解消されました。

1,000人規模の48時間イベント運用時のインフラ費用は、Cloudflare の有料プランの基本料金 **$5 (約800円) のみ** で完全にカバーでき、追加の従量課金は **1円も発生しません。** 安定したリアルタイム体験と驚異的な低コストを両立させています。
