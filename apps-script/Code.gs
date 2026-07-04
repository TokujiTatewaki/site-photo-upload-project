/**
 * ============================================================
 * 現場写真アップロード - 完了通知メール送信スクリプト
 * ============================================================
 *
 * 【これは何か】
 * PWA（現場写真アップロードアプリ）からアップロード完了・中断・一部失敗の
 * 通知を受け取り、アップロード先のGoogleアカウントの権限でメールを送信する
 * ための Google Apps Script です。このスクリプトは "アップロード先の
 * 共有Driveフォルダを所有するGoogleアカウント" で作成・デプロイしてください。
 * これにより、現場作業者側の端末には一切追加の権限（Gmail送信権限など）を
 * 要求せずに、常に同じ固定アカウントからメールを送信できます。
 *
 * 【デプロイ手順】
 * 1. https://script.google.com を開き、"アップロード先の共有フォルダを
 *    所有するGoogleアカウント" でログインする。
 * 2. 「新しいプロジェクト」を作成し、このファイルの内容を丸ごと貼り付ける
 *    （デフォルトの Code.gs を全て置き換える）。
 * 3. 下記の SHARED_SECRET を、他人に推測されにくいランダムな文字列に
 *    書き換える（例：長い英数字のランダム文字列）。
 *    ※ この値は、後でアプリ側の js/config.js の
 *      CONFIG.NOTIFY_SHARED_SECRET に同じ値を設定する必要がある。
 * 4. ADMIN_EMAIL は既定で tokuji.tatewaki@gmail.com を設定済み。
 *    管理者宛先を変更したい場合はここを書き換えて「新しいバージョンを
 *    デプロイ」するだけでよい（アプリ側の再デプロイは不要）。
 * 5. 画面右上の「デプロイ」→「新しいデプロイ」を選択。
 *    - 種類の選択：「ウェブアプリ」
 *    - 次のユーザーとして実行：「自分」
 *    - アクセスできるユーザー：「全員」
 *    でデプロイする。初回は権限の承認（自分のGoogleアカウントに対して）が
 *    求められるので許可する。
 * 6. デプロイ後に表示される「ウェブアプリのURL」をコピーし、
 *    アプリ側の js/config.js の CONFIG.NOTIFY_WEBAPP_URL に設定する。
 * 7. 以後、このスクリプトのコードを修正した場合は、
 *    「デプロイ」→「デプロイを管理」→ 編集(鉛筆アイコン) →
 *    「バージョン：新バージョン」を選んで「デプロイ」を押すことで反映される
 *    （URLは変わらないので、アプリ側の再設定は不要）。
 *
 * 【セキュリティについて】
 * このウェブアプリは「全員」がアクセスできる設定になるため、URLを知っていれば
 * 誰でもリクエストを送れてしまう。それを防ぐため、リクエストに含まれる
 * secret の値が SHARED_SECRET と一致しない場合は送信を拒否するようにしている。
 * SHARED_SECRET は他人に見せないこと（GitHubなど公開の場に書かないこと）。
 */

// ▼▼▼ 以下2つを必ず自分の環境に合わせて書き換えること ▼▼▼
const SHARED_SECRET = "ここを推測されにくいランダムな文字列に書き換えてください";
const ADMIN_EMAIL = "tokuji.tatewaki@gmail.com";
// ▲▲▲ ここまで ▲▲▲

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (!data || data.secret !== SHARED_SECRET) {
      return jsonResponse({ ok: false, error: "unauthorized" });
    }

    const subject = buildSubject(data);
    const body = buildBody(data);

    const recipients = [ADMIN_EMAIL];
    if (data.uploaderEmail) {
      recipients.push(data.uploaderEmail);
    }
    // 重複があれば1通にまとめる
    const uniqueRecipients = Array.from(new Set(recipients)).join(",");

    MailApp.sendEmail({
      to: uniqueRecipients,
      subject: subject,
      body: body,
    });

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function buildSubject(data) {
  const statusLabel =
    {
      completed: "完了",
      cancelled: "中断",
      partial_failed: "一部失敗",
    }[data.event] || data.event;

  return `[現場写真アップロード] ${statusLabel}：${data.customer || ""} / ${data.site || ""}`;
}

function buildBody(data) {
  const statusLabel =
    {
      completed: "全てのファイルが正常にアップロードされました。",
      cancelled: "アップロードが中断されました。",
      partial_failed: "一部のファイルが未完了です。",
    }[data.event] || data.event;

  const lines = [
    statusLabel,
    "",
    `顧客名　　：${data.customer || "-"}`,
    `施工現場　：${data.site || "-"}`,
    `施工年月　：${data.yearMonth || "-"}`,
    `作業者　　：${data.uploaderName || "-"}（${data.uploaderEmail || "-"}）`,
    `件数　　　：完了 ${data.successCount != null ? data.successCount : "-"} / 全体 ${data.totalCount != null ? data.totalCount : "-"}`,
    `日時　　　：${data.timestamp || new Date().toISOString()}`,
  ];
  // 履歴画面の「まとめて再試行」のように、複数の顧客/現場が混在するケース用の補足
  if (data.note) {
    lines.push("", `対象　　　：${data.note}`);
  }
  return lines.join("\n");
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
