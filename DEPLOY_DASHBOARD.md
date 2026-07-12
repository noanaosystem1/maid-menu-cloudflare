# Cloudflare & GitHub 連動・自動デプロイ手順書

本手順書は、Wrangler CLI によるローカルからの手動デプロイではなく、**GitHub リポジトリと Cloudflare Dashboard を直接連携させ、コミットのプッシュをトリガーに「静的フロントエンド」および「Durable Objects (SQLite 搭載) バックエンド」を完全自動デプロイ（CI/CD）する**ための詳細マニュアルです。

---

## 全体設計イメージ

```
 [ローカル開発]             [GitHub リポジトリ]                  [Cloudflare Platform]
   │                             │                                      │
   │─── git push origin main ───►│                                      │
   │                             │─── (A) Trigger Pages Deploy ────────►│ (Pages: フロントエンドビルド & 配信)
   │                             │                                      │
   │                             │─── (B) Trigger GitHub Actions ──────►│ (Worker: バックエンドデプロイ)
```

- **フロントエンド (Pages):** GitHub リポジトリと Cloudflare Pages を直接連携させ、`main` ブランチへのプッシュ時に Cloudflare 側で自動ビルド & 配信を行います。
- **バックエンド (Worker & Durable Objects):** GitHub Actions を利用し、`main` ブランチへのプッシュ時に Cloudflare Workers へ自動デプロイします。

---

## 前提条件

1. **GitHub アカウント & リポジトリ:**
   - 本システムのコードが GitHub の非公開（プライベート）または公開リポジトリにホストされていること。
2. **Durable Objects の利用資格:**
   - Durable Objects は、Cloudflare **Workers Paid プラン（月額 $5〜）**でのみ利用可能です。デプロイ先の Cloudflare アカウントで Workers Paid が有効になっていることを確認してください。

---

## 手順 1. フロントエンド（Cloudflare Pages）の GitHub 連携デプロイ

Cloudflare Pages の持つ Git 統合機能を利用して、フロントエンド静的ファイルを自動ビルド・デプロイします。

1. **Cloudflare Dashboard** にログインします。
2. 左メニューから **「Workers & Pages」** ＞ **「Overview」（概要）** を選択します。
3. **「Create」（作成）** ＞ **「Pages」** タブ ＞ **「Connect to Git」（Git に接続）** ボタンをクリックします。
4. **「GitHub」** を選択し、指示に従って GitHub アカウントとの連携認証および対象リポジトリへのアクセス権を付与します。
5. デプロイ対象のリポジトリを選択し、**「Begin setup」（セットアップの開始）** をクリックします。
6. **「Build settings」（ビルド設定）** を以下の通り入力します：
   - **Framework preset（フレームワークのプリセット）:** `Vite` (または `None`)
   - **Build command（ビルドコマンド）:** `npm run build`
   - **Build output directory（ビルド出力ディレクトリ）:** `dist`
   - **Root directory（ルートディレクトリ）:** 空白（リポジトリルート）
7. **「Save and Deploy」（保存してデプロイ）** をクリックします。
   - これにより、初回ビルドが開始され、以降は `main` ブランチへのプッシュごとに自動でフロントエンドがビルド & 更新されます。

---

## 手順 2. バックエンド（Cloudflare Workers & Durable Objects）の GitHub Actions 自動デプロイ

バックエンドの Worker コード（`server/worker.js`）および SQLite Durable Object スキーマ定義を GitHub Actions を使って自動デプロイします。

### 2.1 API トークンとアカウント ID の取得

GitHub Actions から Cloudflare にデプロイするための認証情報を取得します。

1. **Cloudflare アカウント ID の取得:**
   - Cloudflare Dashboard の右側メニュー（または Worker 概要ページ）に表示されている **「Account ID」（アカウント ID）** をコピーして控えておきます。
2. **API トークンの生成:**
   - 画面右上のアイコン ＞ **「My Profile」（マイプロフィール）** ＞ **「API Tokens」（API トークン）** を選択します。
   - **「Create Token」（トークンの作成）** をクリックし、**「Edit Cloudflare Workers」（Cloudflare Workers の編集）** テンプレートを使用します。
   - 権限（Permissions）に以下が含まれていることを確認してください：
     - `Account - Durable Objects - Edit`
     - `Account - Worker Scripts - Edit`
   - 生成された **API トークン** を安全にコピーして控えておきます。

### 2.2 GitHub Secrets の設定

取得した認証情報を GitHub リポジトリの機密変数（Secrets）に登録します。

1. GitHub リポジトリのページを開き、**「Settings」（設定）** ＞ **「Secrets and variables」** ＞ **「Actions」** を選択します。
2. **「New repository secret」（新しいリポジトリシークレット）** ボタンをクリックし、以下の2つを登録します：
   - **Name:** `CLOUDFLARE_API_TOKEN` / **Value:** コピーした API トークン
   - **Name:** `CLOUDFLARE_ACCOUNT_ID` / **Value:** コピーした アカウント ID

### 2.3 ワークフロー定義ファイル (`.github/workflows/deploy.yml`) の作成

リポジトリ直下に以下の GitHub Actions ワークフローファイルを作成してコミット・プッシュします。

**ファイルパス:** `.github/workflows/deploy.yml`

```yaml
name: Deploy Cloudflare Worker

on:
  push:
    branches:
      - main # main ブランチにプッシュされた時に動作します

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18

      - name: Install Dependencies
        run: npm ci

      - name: Deploy Worker via Wrangler
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

---

## 手順 3. 環境変数（ADMIN_PASSWORD）と Durable Objects の初期バインド

GitHub 経由の自動デプロイを行う前に、一度だけ Cloudflare のダッシュボード上で Worker に対して以下の設定を行います。

1. **環境変数の設定:**
   - Cloudflare Dashboard ＞ **「Workers & Pages」** ＞ 作成された Worker ＞ **「Settings」** ＞ **「Variables」** に移動。
   - 変数 `ADMIN_PASSWORD` に、管理者コンソールログイン用の安全なパスワードを入力し、保存します。
2. **Durable Objects バインディングの登録:**
   - 同じく **「Settings」** ＞ **「Bindings」（バインディング）** セクションへ移動。
   - Durable Object バインディングを追加し、**変数名（Variable Name）** を `MAID_CAFE_DO`、**クラス名（Class Name）** を `MaidCafeDO` に指定して保存・デプロイします。
3. **マイグレーションの登録:**
   - **「Settings」** ＞ **「Durable Objects」** セクションへ移動し、マイグレーションタグ `v1` と SQLiteクラス名 `MaidCafeDO` のマッピングを保存します。
   *(※これら1回限りのバインド定義を Cloudflare 側に記憶させることで、以降 GitHub Actions がプッシュをトリガーにデプロイしても、データベースや環境変数の設定が一切破壊されることなく安全に上書きデプロイされます)*

---

## 手順 4. ドメインの完全統合

フロントエンド（Pages）とバックエンド（Worker）を同じドメインの傘下に入れ、シームレスな通信環境を作ります。

1. **Pages カスタムドメインの設定:**
   - Pages のダッシュボード ＞ **「Custom Domains」** で任意の独自ドメイン（例: `maid-cafe.example.com`）を設定します。
2. **Worker ルーティングの登録:**
   - 作成した Worker ＞ **「Triggers」** タブ ＞ **「Routes」（ルート）** にて以下のようにルートを追加します：
     - **Route:** `maid-cafe.example.com/api/*`
     - **Zone:** 対象の DNS ゾーン
3. これにより、ブラウザ上の同一ドメインから `/api` に向けて CORS エラーの発生しない超高速な REST / WebSocket 接続（冬眠 API）が自動的に機能します。
