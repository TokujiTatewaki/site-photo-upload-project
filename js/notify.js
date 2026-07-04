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
      // 補足：Google Apps ScriptのウェブアプリはリクエストをGoogle内部の
      // 別ドメインへ302リダイレクトする仕様になっており、その際POSTで送っても
      // リダイレクト先へはGETとして送り直されてしまう（＝bodyが失われ、
      // doPostではなくdoGetが呼ばれて失敗する）。この問題を避けるため、
      // 最初からGETリクエスト（クエリパラメータ）で送信する。
      // クエリパラメータのみの単純なGETリクエストなのでCORSプリフライトも発生しない。
      // Apps Script側では doGet(e) の e.parameter で受け取る。
      const params = new URLSearchParams(
        Object.assign({ secret: CONFIG.NOTIFY_SHARED_SECRET }, payload)
      );
      await fetch(`${CONFIG.NOTIFY_WEBAPP_URL}?${params.toString()}`, {
        method: "GET",
      });
    } catch (e) {
      console.warn("完了通知メールの送信に失敗しました（アップロード自体は正常です）", e);
    }
  }

  return { sendUploadNotification };
})();

window.Notify = Notify;
