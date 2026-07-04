// ============================================================
// GitHub Actions のデプロイ時にのみ実行するスクリプト。
// リポジトリの Secrets (NOTIFY_WEBAPP_URL / NOTIFY_SHARED_SECRET) の値を
// js/config.js のプレースホルダー（空文字）に差し込む。
//
// 重要：このスクリプトは「デプロイ用に checkout したワークフロー実行環境の
// ファイル」を書き換えるだけであり、git にコミットし直すことは一切ない。
// そのため、実際のURL・シークレットの値はリポジトリのソース・コミット履歴
// には一切残らず、公開されたPagesサイトの成果物にのみ埋め込まれる。
// （Secretsが未設定の場合は空文字のままになり、通知メール機能は
//   従来通り安全に無効化される。）
// ============================================================
const fs = require("fs");

const CONFIG_PATH = "js/config.js";
const url = process.env.NOTIFY_WEBAPP_URL || "";
const secret = process.env.NOTIFY_SHARED_SECRET || "";

let content = fs.readFileSync(CONFIG_PATH, "utf8");

content = content.replace(
  'NOTIFY_WEBAPP_URL: ""',
  `NOTIFY_WEBAPP_URL: ${JSON.stringify(url)}`
);
content = content.replace(
  'NOTIFY_SHARED_SECRET: ""',
  `NOTIFY_SHARED_SECRET: ${JSON.stringify(secret)}`
);

fs.writeFileSync(CONFIG_PATH, content);

console.log(
  url
    ? "NOTIFY_WEBAPP_URL を設定しました（通知メール機能は有効になります）。"
    : "NOTIFY_WEBAPP_URL が未設定のため、通知メール機能は無効のままデプロイします。"
);
