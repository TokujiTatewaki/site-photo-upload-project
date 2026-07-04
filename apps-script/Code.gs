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
 *    ※ doGet追加時など、このファイルを更新した場合は必ずこの手順で
 *      「新バージョン」を発行し直すこと（コード保存だけでは公開URLに反映されない）。
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

// メールに埋め込むサムネイル画像の最大枚数（メール肥大化防止のための安全上限。
// アプリ側(js/config.js の NOTIFY_MAX_INLINE_PHOTOS)でも同様に上限を設けて
// 送信するファイルID数を絞っているが、念のためサーバー側でも二重に制限する）
const MAX_INLINE_PHOTOS = 10;

// 補足：GAS の Web アプリはリクエストを内部的に script.googleusercontent.com へ
// 302リダイレクトする。その際、POSTでリクエストしても多くの環境（fetch()等）では
// 仕様上リダイレクト先へはGETとして送り直されてしまい、doPostではなくdoGetが
// 呼ばれてbody(JSON)が失われて失敗する（実行ログに「doGet」「失敗しました」と出る
// 場合はこれが原因）。これを避けるため、クライアント側(js/notify.js)は最初から
// GETリクエスト（クエリパラメータ）で送信する方式にしている。
// doPostは万一POSTで呼ばれた場合のために残してあるが、通常はdoGetのみが使われる。

function doGet(e) {
  return handleNotifyRequest(e.parameter || {});
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    return handleNotifyRequest(data);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function handleNotifyRequest(data) {
  try {
    if (!data || data.secret !== SHARED_SECRET) {
      return jsonResponse({ ok: false, error: "unauthorized" });
    }

    const photos = fetchInlinePhotos(data);

    const subject = buildSubject(data);
    const body = buildBody(data);
    const htmlBody = buildHtmlBody(data, photos.htmlParts);

    const recipients = [ADMIN_EMAIL];
    if (data.uploaderEmail) {
      recipients.push(data.uploaderEmail);
    }
    // 重複があれば1通にまとめる
    const uniqueRecipients = Array.from(new Set(recipients)).join(",");

    const mailOptions = {
      to: uniqueRecipients,
      subject: subject,
      body: body,
      htmlBody: htmlBody,
    };
    if (Object.keys(photos.inlineImages).length > 0) {
      mailOptions.inlineImages = photos.inlineImages;
    }
    MailApp.sendEmail(mailOptions);

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

// data.photoFileIdsJson（アップロード済みDriveファイルIDのJSON配列文字列）から、
// 各ファイルのDrive生成サムネイルを取得し、メール本文に埋め込むための
// inlineImages（cid指定用のBlobマップ）とHTML断片を組み立てる。
// 個々の画像取得に失敗しても、その画像だけスキップしてメール送信自体は継続する。
function fetchInlinePhotos(data) {
  const inlineImages = {};
  const htmlParts = [];

  let fileIds = [];
  if (data.photoFileIdsJson) {
    try {
      const parsed = JSON.parse(data.photoFileIdsJson);
      if (Array.isArray(parsed)) {
        fileIds = parsed;
      }
    } catch (e) {
      // 不正なJSONは無視する（画像なしでメール送信を続ける）
    }
  }
  fileIds = fileIds.slice(0, MAX_INLINE_PHOTOS);

  if (fileIds.length === 0) {
    return { inlineImages, htmlParts };
  }

  // アップロード直後はDrive側のサムネイル生成が間に合っていないことがあるため、
  // 少し待ってから取得する（完全な対策ではないが簡易的な緩和策）。
  Utilities.sleep(2000);

  fileIds.forEach(function (fileId, idx) {
    try {
      const file = DriveApp.getFileById(fileId);
      const thumb = file.getThumbnail();
      if (thumb) {
        const cid = "photo" + idx;
        inlineImages[cid] = thumb;
        htmlParts.push(
          '<img src="cid:' +
            cid +
            '" alt="" style="max-width:220px;max-height:220px;margin:4px;border-radius:6px;border:1px solid #ddd;" />'
        );
      }
    } catch (e) {
      // 個別の画像取得失敗は無視する（サムネイル未生成・アクセス不可等）
    }
  });

  return { inlineImages, htmlParts };
}

// data.folderUrl（単一フォルダ）/ data.folderLinksJson（複数フォルダのJSON配列）から
// 保存先フォルダへのリンク行を、プレーンテキスト用・HTML用それぞれ組み立てる。
function buildFolderLines(data) {
  const plainLines = [];
  const htmlLines = [];

  if (data.folderUrl) {
    plainLines.push(`保存先　　：${data.folderUrl}`);
    htmlLines.push(
      '<p>保存先：<a href="' +
        escapeHtml(data.folderUrl) +
        '">Googleドライブでフォルダを開く</a></p>'
    );
  }

  if (data.folderLinksJson) {
    try {
      const folders = JSON.parse(data.folderLinksJson);
      if (Array.isArray(folders) && folders.length > 0) {
        plainLines.push("保存先一覧：");
        folders.forEach(function (f) {
          plainLines.push(`　- ${f.label}：${f.url}`);
        });
        htmlLines.push(
          "<p>保存先一覧：</p><ul>" +
            folders
              .map(function (f) {
                return (
                  '<li><a href="' +
                  escapeHtml(f.url) +
                  '">' +
                  escapeHtml(f.label) +
                  "</a></li>"
                );
              })
              .join("") +
            "</ul>"
        );
      }
    } catch (e) {
      // 不正なJSONは無視する
    }
  }

  return { plainLines, htmlLines };
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
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

  const folderInfo = buildFolderLines(data);
  if (folderInfo.plainLines.length > 0) {
    lines.push("", folderInfo.plainLines.join("\n"));
  }

  return lines.join("\n");
}

// HTMLメール本文を組み立てる。photoHtmlPartsは埋め込み済みサムネイル画像の<img>タグ配列。
function buildHtmlBody(data, photoHtmlParts) {
  const statusLabel =
    {
      completed: "全てのファイルが正常にアップロードされました。",
      cancelled: "アップロードが中断されました。",
      partial_failed: "一部のファイルが未完了です。",
    }[data.event] || data.event;

  function row(label, value) {
    return (
      '<tr><td style="padding:2px 8px;color:#666;white-space:nowrap;">' +
      escapeHtml(label) +
      '</td><td style="padding:2px 8px;">' +
      escapeHtml(value) +
      "</td></tr>"
    );
  }

  let html = "<p>" + escapeHtml(statusLabel) + "</p>";
  html += '<table style="border-collapse:collapse;font-size:13px;">';
  html += row("顧客名", data.customer || "-");
  html += row("施工現場", data.site || "-");
  html += row("施工年月", data.yearMonth || "-");
  html += row("作業者", `${data.uploaderName || "-"}（${data.uploaderEmail || "-"}）`);
  html += row(
    "件数",
    `完了 ${data.successCount != null ? data.successCount : "-"} / 全体 ${data.totalCount != null ? data.totalCount : "-"}`
  );
  html += row("日時", data.timestamp || new Date().toISOString());
  html += "</table>";

  if (data.note) {
    html += "<p>対象：" + escapeHtml(data.note) + "</p>";
  }

  const folderInfo = buildFolderLines(data);
  html += folderInfo.htmlLines.join("");

  if (photoHtmlParts && photoHtmlParts.length > 0) {
    html += "<div>" + photoHtmlParts.join("") + "</div>";
    const totalPhotoCount = Number(data.photoCount) || photoHtmlParts.length;
    if (totalPhotoCount > photoHtmlParts.length) {
      html +=
        '<p style="color:#888;font-size:12px;">ほか' +
        (totalPhotoCount - photoHtmlParts.length) +
        "件（メールには一部のみ表示。全件はGoogleドライブでご確認ください）</p>";
    }
  }

  return html;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
