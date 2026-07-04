// ============================================================
// アプリ全体の設定値
// spec.md 10章に記載の手順で発行した値をここに設定する。
// クライアントIDとAPIキーは公開しても問題ない値（フロントエンドで使う想定のもの）。
// ============================================================
const CONFIG = {
  // Google OAuth 2.0 クライアントID（Google Auth Platform > クライアント で発行）
  GOOGLE_CLIENT_ID:
    "938476549651-86rc43jj915jsfb2qqekfn3ma61iqr80.apps.googleusercontent.com",

  // Google APIキー（Picker APIの読み込みに使用）
  GOOGLE_API_KEY: "AIzaSyAHZOJfj_C2fK1d_UJ-VcUuzGHU0Otze4E",

  // 使用するOAuthスコープ（アプリが作成/明示的に開いたファイルのみアクセス可能な限定スコープ）
  OAUTH_SCOPE: "https://www.googleapis.com/auth/drive.file",

  // 保存先ルートフォルダ（既存の共有フォルダ）
  ROOT_FOLDER_ID: "1elNZfn2-OmjJ03Z4fgUPlBSNsBjnpugt",

  // ルートフォルダ配下に置くマスタデータ・履歴ファイルの名前
  MASTER_DATA_FILENAME: "master-data.json",
  HISTORY_FILENAME: "upload-history.json",

  // 画像圧縮設定
  IMAGE_MAX_DIMENSION: 2000, // 長辺の最大ピクセル数
  IMAGE_QUALITY: 0.8, // JPEG品質（0〜1）

  // 履歴一覧のサムネイル用（低解像度・小さいサイズでよい）
  THUMBNAIL_MAX_DIMENSION: 96, // 長辺の最大ピクセル数
  THUMBNAIL_QUALITY: 0.5, // JPEG品質（0〜1）

  // 全体共有履歴に表示する対象期間（日数）
  SHARED_HISTORY_DAYS: 7,

  // レジューム用アップロードのチャンクサイズ（バイト）。Drive APIの仕様上256KBの倍数を推奨。
  UPLOAD_CHUNK_SIZE: 5 * 1024 * 1024, // 5MB

  // 同一フォルダ内のファイル名連番の桁数
  SEQUENCE_DIGITS: 3,

  // アップロード完了通知メール（Google Apps Script経由で送信）
  // NOTIFY_WEBAPP_URL: Apps Scriptを「ウェブアプリ」としてデプロイしたURL。
  //   空欄のままなら通知機能自体を送信しない（未設定時は何もしない安全側の実装）。
  // NOTIFY_SHARED_SECRET: Apps Script側のSHARED_SECRETと同じ文字列を設定すること
  //   （第三者によるなりすまし送信を防ぐための簡易的な合言葉）。
  // 管理者宛先(ADMIN_EMAIL)はApps Script側で管理する（変更してもこのアプリの再デプロイ不要）。
  NOTIFY_WEBAPP_URL: "",
  NOTIFY_SHARED_SECRET: "",

  // 通知メールに埋め込むサムネイル画像の最大枚数
  // （多すぎるとメールが肥大化する・GETリクエストのURLが長くなりすぎるための上限。
  //   実際の完了件数はphotoCountとして別途送るので、超過分は「ほかN件」として案内される）
  NOTIFY_MAX_INLINE_PHOTOS: 10,

  // 通知メール添付用サムネイル画像の設定
  // Googleドライブ側の自動サムネイル生成（非同期・生成タイミング不定）に依存せず、
  // 端末側で確実に用意できる中サイズ画像を別途生成してDriveにアップロードし、
  // Apps Script側はそれをそのまま取得してメールに埋め込む（送信後は自動で削除される）。
  EMAIL_THUMBNAIL_MAX_DIMENSION: 480, // 長辺の最大ピクセル数
  EMAIL_THUMBNAIL_QUALITY: 0.55, // JPEG品質（0〜1）
  // このサムネイル専用ファイルの保存先（ルート直下の専用フォルダ。顧客/現場フォルダは汚さない）
  EMAIL_THUMBNAILS_FOLDER_NAME: ".email-thumbnails",
};
