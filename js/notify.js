// ============================================================
// アップロード完了通知（Google Apps Script経由でメール送信）
// - 送信元は「アップロード先のGoogleアカウント」（Apps Scriptのデプロイ元アカウント）。
//   このアプリ自体はGmail送信権限を一切要求しない。
// - CONFIG.NOTIFY_WEBAPP_URL が未設定の場合は何もしない。
// - 通知の送信に失敗しても、アップロード自体の結果には影響させない（握りつぶしてログのみ）。
// ============================================================
const Notify = (() => {
  // event: "completed" | "cancelled" | "partial_failed"
  async function sendUploadNotification(payload) {
    if (!CONFIG.NOTIFY_WEBAPP_URL) return;
    try {
      // 補足：Google Apps ScriptのウェブアプリはCORSのプリフライト(OPTIONSリクエスト)を
      // 正しく処理できないため、Content-Typeをtext/plainにしてプリフライトを発生させずに送る。
      // Apps Script側では e.postData.contents をJSON.parse()して受け取る。
      await fetch(CONFIG.NOTIFY_WEBAPP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(
          Object.assign({ secret: CONFIG.NOTIFY_SHARED_SECRET }, payload)
        ),
      });
    } catch (e) {
      console.warn("完了通知メールの送信に失敗しました（アップロード自体は正常です）", e);
    }
  }

  return { sendUploadNotification };
})();

window.Notify = Notify;
