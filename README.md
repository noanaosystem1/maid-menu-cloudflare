# 狂気メイド喫茶 — デジタルメニュー制御システム (Cloudflare Workers & Durable Objects SQLite 搭載版)

React + Cloudflare Workers + Durable Objects (SQLite) の高信頼・リアルタイム双方向サーバーレス構成。

## 構成

```
メニュー/
├── wrangler.json     Wrangler 設定ファイル
├── server/
│   └── worker.js     Cloudflare Workers & Durable Object API / SQLite データベース
├── src/              React フロントエンド
└── dist/             ビルド済みフロントエンドアセット
```

## Cloudflare Durable Objects + WebSockets リアルタイム設計

本システムは、従来の Cloudflare D1 データベースなどの外部依存を一切排除した **100% D1-Free アーキテクチャ**を採用しています。

1. **Durable Objects 内蔵 SQLite による状態永続化:**
   - データベース（`rooms`, `guest_users`, `menu_items`）はすべて Durable Object (`MaidCafeDO`) の超高速・低遅延なインメモリ SQLite ストレージに永続的に保存されます。
   - すべての書き込み・読み込み操作がこのオブジェクト内でトランザクション処理されるため、データ競合が絶対に発生しません。

2. **WebSockets を用いた真のリアルタイム同期:**
   - メニュー画面、演出画面、および管理者ダッシュボードは、API `/api/ws` を介して Durable Object に直接 WebSocket 接続します。
   - ルームの「演出フェーズ」（待機中、メニュー閲覧、ハッキング開始、暗転等）が管理画面から更新されると、Durable Object から接続中の全クライアントの WebSocket 接続へ **1ミリ秒未満で一斉ブロードキャスト** され、画面演出が完全にシンクロして即時遷移します。

3. **管理サイトの認証セキュリティ:**
   - パスワードは Worker 側の環境変数 `ADMIN_PASSWORD` (デフォルトは `"maid2024"`) にて安全に保持・検証。
   - 管理画面から送信される `X-Admin-Password` (または `Authorization`) ヘッダーと照合し、管理用 API への不正アクセスを未然に防止します。

---

## ローカル開発環境のセットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. フロントエンドのビルド & ローカルサーバーの起動

```bash
npm run build
npm run dev
```

- Wrangler が自動的に Durable Objects とローカル SQLite をエミュレートして http://localhost:8787 にてフロントエンドと API を起動します（従来のような D1 手動マイグレーションのコマンド実行は不要です）。
- 管理サイトのデフォルトパスワード: `maid2024`

---

## 本番デプロイ

### 1. デプロイの実行

```bash
npm run build
npm run deploy
```

デプロイ完了後、Cloudflare 側で割り当てられた `xxx.workers.dev` などの URL からアクセス可能です。
管理画面のパスワードを変更する場合は、Cloudflare Dashboard または wrangler コマンドから `ADMIN_PASSWORD` 環境変数を追加・更新してください。
詳細なデプロイ方法については、[DEPLOY.md](DEPLOY.md) をご参照ください。
