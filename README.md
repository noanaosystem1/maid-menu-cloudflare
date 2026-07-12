# 狂気メイド喫茶 — デジタルメニュー制御システム (Cloudflare Workers & Durable Objects SQLite & 冬眠API搭載版)

React + Cloudflare Workers + Durable Objects (SQLite) の高信頼・超省電力リアルタイム双方向サーバーレス構成。

## 構成

```
メニュー/
├── wrangler.json            Wrangler 設定ファイル
├── server/
│   └── worker.js            Cloudflare Workers & Durable Object API / SQLite / WebSocket 冬眠処理
├── src/                     React フロントエンド
├── WORKER_TRIGGERS.md       Workerの実行タイミング・トリガー解説
├── ARCHITECTURE_DESIGN.md   全体アーキテクチャ・技術仕組み解説
└── dist/                    ビルド済みフロントエンドアセット
```

## Cloudflare Durable Objects + WebSockets リアルタイム設計

本システムは、従来の Cloudflare D1 データベースなどの外部依存を排除した **100% D1-Free アーキテクチャ** を採用し、さらにランタイム効率とコストを追求した設計となっています。

1. **Durable Objects 内蔵 SQLite による状態永続化:**
   - データベース（`rooms`, `guest_users`, `menu_items`）はすべて Durable Object (`MaidCafeDO`) のインメモリ SQLite ストレージに保存されます。

2. **WebSockets 冬眠（Hibernation）API による常時接続:**
   - ゲスト画面および**管理画面の双方とも、WebSocket による常時接続（繋ぎっぱなし）**を基本とします。
   - メモリ上に接続インスタンスの配列（`this.sessions`）を抱える代わりに、Cloudflareの `state.acceptWebSocket()` を活用して冬眠を委譲。
   - 通信が無いときは、Durable Object 自体が「冬眠（Hibernation）」して課金リソース消費（GB-秒）を自動削減。メッセージ到着時やブロードキャスト時のみ自動でシームレスに活性化します。
   - 管理画面の定期 HTTP ポーリングを完全に廃止したため、1日のリクエスト消費数をほぼゼロに抑制します。

3. **管理サイトの WebSocket メッセージ認証:**
   - パスワードは Worker 側の環境変数 `ADMIN_PASSWORD` (デフォルトは `"maid2024"`) にて安全に検証。
   - 演出フェーズの切り替えなどの管理操作は WebSocket を介したメッセージフレームで行われ、メッセージ内のパスワード値を Durable Object の内部で安全に突き合わせ検証します。

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

- Wrangler が自動的に Durable Objects とローカル SQLite をエミュレートして http://localhost:8787 にてフロントエンドと API を起動します。
- 管理サイトのデフォルトパスワード: `maid2024`

---

## 本番デプロイ

### 1. デプロイの実行

```bash
npm run build
npm run deploy
```

デプロイ完了後、Cloudflare 側で割り当てられた `xxx.workers.dev` などの URL からアクセス可能です。
詳細なデプロイ方法については、[DEPLOY.md](DEPLOY.md) をご参照ください。
