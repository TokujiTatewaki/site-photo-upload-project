// ============================================================
// Google Drive API ラッパー
// - フォルダのfind-or-create
// - マスタデータ／履歴JSONの読み書き
// - レジューム対応 resumable upload
// ============================================================
const Drive = (() => {
  const API_BASE = "https://www.googleapis.com/drive/v3";
  const UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

  async function authHeader() {
    const token = await Auth.getAccessToken();
    return { Authorization: "Bearer " + token };
  }

  async function apiFetch(url, options = {}) {
    const headers = Object.assign({}, options.headers, await authHeader());
    const res = await fetch(url, Object.assign({}, options, { headers }));
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Drive API エラー (${res.status}): ${text}`);
    }
    return res;
  }

  // ---- フォルダ ----

  async function findFolder(name, parentId) {
    const q = encodeURIComponent(
      `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const res = await apiFetch(`${API_BASE}/files?q=${q}&fields=files(id,name)`);
    const data = await res.json();
    return (data.files && data.files[0]) || null;
  }

  async function createFolder(name, parentId) {
    const res = await apiFetch(`${API_BASE}/files?fields=id,name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
      }),
    });
    return res.json();
  }

  async function findOrCreateFolder(name, parentId) {
    const existing = await findFolder(name, parentId);
    if (existing) return existing;
    return createFolder(name, parentId);
  }

  // 顧客名＞施工現場 の2階層フォルダをfind-or-createする（アップロード実行時にのみ呼ぶこと）
  async function ensureCustomerSiteFolder(customerName, siteName) {
    const customerFolder = await findOrCreateFolder(customerName, CONFIG.ROOT_FOLDER_ID);
    const siteFolder = await findOrCreateFolder(siteName, customerFolder.id);
    return siteFolder.id;
  }

  // 通知メール添付用サムネイルの保存先（ルート直下の専用の隠しフォルダ）。
  // 顧客/現場フォルダとは別にしておき、本体写真のフォルダ構成を汚さないようにする。
  async function ensureEmailThumbnailsFolder() {
    const folder = await findOrCreateFolder(CONFIG.EMAIL_THUMBNAILS_FOLDER_NAME, CONFIG.ROOT_FOLDER_ID);
    return folder.id;
  }

  // 通知メール添付用サムネイル（小さい画像）を1回のリクエストでアップロードする。
  // サイズが小さいためresumable uploadは使わず、multipartの単発アップロードでよい。
  async function uploadEmailThumbnail(blob, fileName) {
    const folderId = await ensureEmailThumbnailsFolder();
    const boundary = "-------driveimageboundary" + Date.now();
    const metadata = { name: fileName, parents: [folderId] };
    const head =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\n` +
      `Content-Type: ${blob.type || "image/jpeg"}\r\n\r\n`;
    const tail = `\r\n--${boundary}--`;
    // メタデータ(文字列)と画像本体(Blob)を混在させて、正しいバイト列としてリクエストボディを組み立てる
    // （文字列連結だとバイナリデータが壊れるため、Blobコンストラクタで結合する）
    const body = new Blob([head, blob, tail]);

    const res = await apiFetch(`${UPLOAD_BASE}/files?uploadType=multipart&fields=id`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    return res.json(); // { id }
  }

  // ---- フォルダ内ファイル一覧（連番採番用、ページング対応） ----
  async function listAllFiles(folderId) {
    let files = [];
    let pageToken = null;
    do {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
      let url = `${API_BASE}/files?q=${q}&fields=nextPageToken,files(id,name)&pageSize=1000`;
      if (pageToken) url += `&pageToken=${pageToken}`;
      const res = await apiFetch(url);
      const data = await res.json();
      files = files.concat(data.files || []);
      pageToken = data.nextPageToken || null;
    } while (pageToken);
    return files;
  }

  // 同一フォルダ内での連番（000〜999）を求める
  async function nextSequenceNumber(folderId) {
    const files = await listAllFiles(folderId);
    let max = -1;
    const re = /_(\d{3})\.[^.]+$/;
    for (const f of files) {
      const m = f.name.match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return max + 1;
  }

  function pad(num, digits) {
    return String(num).padStart(digits, "0");
  }

  async function buildFileName(folderId, yearMonth, customerName, siteName, extension) {
    const seq = await nextSequenceNumber(folderId);
    const seqStr = pad(seq, CONFIG.SEQUENCE_DIGITS);
    return `${yearMonth}_${customerName}_${siteName}_${seqStr}.${extension}`;
  }

  // 複数ファイルを一括アップロードする際、Driveへの問い合わせを1回にまとめて連番を採番する
  async function buildFileNames(folderId, yearMonth, customerName, siteName, count, extension) {
    const start = await nextSequenceNumber(folderId);
    const names = [];
    for (let i = 0; i < count; i++) {
      names.push(`${yearMonth}_${customerName}_${siteName}_${pad(start + i, CONFIG.SEQUENCE_DIGITS)}.${extension}`);
    }
    return names;
  }

  // ---- マスタデータ / 履歴 JSON ----

  async function findFileInRoot(name) {
    const q = encodeURIComponent(
      `name='${name.replace(/'/g, "\\'")}' and '${CONFIG.ROOT_FOLDER_ID}' in parents and trashed=false`
    );
    const res = await apiFetch(`${API_BASE}/files?q=${q}&fields=files(id,name)`);
    const data = await res.json();
    return (data.files && data.files[0]) || null;
  }

  async function createJsonFileInRoot(name, data) {
    const boundary = "-------drivejsonboundary" + Date.now();
    const metadata = { name, parents: [CONFIG.ROOT_FOLDER_ID], mimeType: "application/json" };
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(data) +
      `\r\n--${boundary}--`;

    const res = await apiFetch(
      `${UPLOAD_BASE}/files?uploadType=multipart&fields=id,name`,
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      }
    );
    return res.json();
  }

  async function readJsonFile(fileId) {
    const res = await apiFetch(`${API_BASE}/files/${fileId}?alt=media`);
    return res.json();
  }

  async function updateJsonFile(fileId, data) {
    await apiFetch(`${UPLOAD_BASE}/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return data;
  }

  const DEFAULT_MASTER = { customers: [], sites: [], yearMonths: [] };

  async function loadMasterData() {
    let file = await findFileInRoot(CONFIG.MASTER_DATA_FILENAME);
    if (!file) {
      file = await createJsonFileInRoot(CONFIG.MASTER_DATA_FILENAME, DEFAULT_MASTER);
      await DB.setMasterCache(DEFAULT_MASTER);
      return { fileId: file.id, data: DEFAULT_MASTER };
    }
    const data = await readJsonFile(file.id);
    await DB.setMasterCache(data);
    return { fileId: file.id, data };
  }

  async function saveMasterData(fileId, data) {
    await updateJsonFile(fileId, data);
    await DB.setMasterCache(data);
    return data;
  }

  // 同一idのレコードが既にあれば内容を上書きし、無ければ末尾に追加する（upsert）。
  // 「まとめて再試行」で後から状態が変わったファイル（中断→完了 等）を反映する際、
  // 単純に配列へ追記するだけだと同じファイルの記録が重複して残ってしまうため。
  // Mapは既存キーへのset()では順序を変えない仕様なので、既存レコードは元の位置を
  // 保ったまま内容だけ更新され、新規レコードのみ末尾に追加される。
  async function appendHistoryRecords(records) {
    let file = await findFileInRoot(CONFIG.HISTORY_FILENAME);
    let data;
    if (!file) {
      file = await createJsonFileInRoot(CONFIG.HISTORY_FILENAME, []);
      data = [];
    } else {
      data = await readJsonFile(file.id);
      if (!Array.isArray(data)) data = [];
    }
    const byId = new Map(data.map((r) => [r.id, r]));
    for (const rec of records) {
      byId.set(rec.id, rec);
    }
    const merged = Array.from(byId.values());
    await updateJsonFile(file.id, merged);
    return merged;
  }

  async function loadHistory() {
    let file = await findFileInRoot(CONFIG.HISTORY_FILENAME);
    if (!file) {
      file = await createJsonFileInRoot(CONFIG.HISTORY_FILENAME, []);
      return [];
    }
    const data = await readJsonFile(file.id);
    return Array.isArray(data) ? data : [];
  }

  // ---- Resumable Upload ----

  async function createResumableSession(fileName, folderId, mimeType) {
    const res = await apiFetch(
      `${UPLOAD_BASE}/files?uploadType=resumable&fields=id`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ name: fileName, parents: [folderId] }),
      }
    );
    const sessionUrl = res.headers.get("Location");
    if (!sessionUrl) throw new Error("アップロードセッションURLの取得に失敗しました");
    return sessionUrl;
  }

  // サーバー側が受信済みのバイト数を確認する（レジューム時に使用）
  async function queryUploadedBytes(sessionUrl, totalBytes, signal) {
    const token = await Auth.getAccessToken();
    let res;
    try {
      res = await fetch(sessionUrl, {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Range": `bytes */${totalBytes}`,
        },
        signal,
      });
    } catch (networkErr) {
      if (networkErr.name === "AbortError") {
        throw Object.assign(new Error("アップロードが中断されました"), { code: "CANCELLED" });
      }
      throw networkErr;
    }
    if (res.status === 308) {
      const range = res.headers.get("Range"); // 例: "bytes=0-524287"
      if (!range) return 0;
      const end = parseInt(range.split("-")[1], 10);
      return end + 1;
    }
    if (res.status === 200 || res.status === 201) {
      return { done: true, file: await res.json() };
    }
    if (res.status === 404) {
      throw Object.assign(new Error("アップロードセッションが無効です（期限切れの可能性）"), {
        code: "SESSION_EXPIRED",
      });
    }
    throw new Error(`アップロード状態確認に失敗しました (${res.status})`);
  }

  // blobをチャンク単位でアップロードし、進捗をonProgressで通知する。
  // 中断された場合は例外を投げるので、呼び出し側でitemをpaused状態にして保存しておき、
  // 再度呼び出す際はresumeFromで再開位置を渡す。
  async function uploadInChunks(sessionUrl, blob, totalBytes, resumeFrom, onProgress, signal) {
    let offset = resumeFrom || 0;
    const chunkSize = CONFIG.UPLOAD_CHUNK_SIZE;

    while (offset < totalBytes) {
      const end = Math.min(offset + chunkSize, totalBytes);
      const chunk = blob.slice(offset, end);
      const token = await Auth.getAccessToken();

      let res;
      try {
        res = await fetch(sessionUrl, {
          method: "PUT",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Range": `bytes ${offset}-${end - 1}/${totalBytes}`,
          },
          body: chunk,
          signal,
        });
      } catch (networkErr) {
        if (networkErr.name === "AbortError") {
          // ユーザーによる中断操作。呼び出し側でpaused扱いにして後で再開できるようにする。
          const err = new Error("アップロードが中断されました");
          err.code = "CANCELLED";
          err.uploadedBytes = offset;
          throw err;
        }
        // 通信断。呼び出し側でpaused扱いにして再接続後に再開できるようにする。
        const err = new Error("通信エラーによりアップロードが中断されました");
        err.code = "NETWORK_ERROR";
        err.uploadedBytes = offset;
        throw err;
      }

      if (res.status === 308) {
        offset = end;
        if (onProgress) onProgress(offset, totalBytes);
        continue;
      }
      if (res.status === 200 || res.status === 201) {
        const file = await res.json();
        if (onProgress) onProgress(totalBytes, totalBytes);
        return file;
      }
      if (res.status === 404) {
        const err = new Error("アップロードセッションが無効です（期限切れの可能性）");
        err.code = "SESSION_EXPIRED";
        throw err;
      }
      const text = await res.text().catch(() => "");
      throw new Error(`アップロードに失敗しました (${res.status}): ${text}`);
    }
  }

  // itemはDBの1レコード（id, blob, fileName, folderId, totalBytes, sessionUrl, uploadedBytes, status など）
  // signalはAbortSignal（ユーザーの「中断」操作で中断できるようにするため）
  async function uploadItem(item, onProgress, signal) {
    let sessionUrl = item.sessionUrl;
    let resumeFrom = item.uploadedBytes || 0;

    if (!sessionUrl) {
      sessionUrl = await createResumableSession(item.fileName, item.folderId, item.mimeType);
      await DB.updateUploadItem(item.id, { sessionUrl, status: "uploading" });
    } else {
      // 既存セッションがあれば、サーバー側の受信済みバイト数を確認してから再開する
      try {
        const status = await queryUploadedBytes(sessionUrl, item.totalBytes, signal);
        if (status && status.done) {
          return status.file;
        }
        resumeFrom = status || 0;
      } catch (e) {
        if (e.code === "SESSION_EXPIRED") {
          sessionUrl = await createResumableSession(item.fileName, item.folderId, item.mimeType);
          resumeFrom = 0;
          await DB.updateUploadItem(item.id, { sessionUrl, uploadedBytes: 0, status: "uploading" });
        } else {
          throw e;
        }
      }
    }

    const file = await uploadInChunks(
      sessionUrl,
      item.blob,
      item.totalBytes,
      resumeFrom,
      async (uploaded, total) => {
        await DB.updateUploadItem(item.id, { uploadedBytes: uploaded, status: "uploading" });
        if (onProgress) onProgress(uploaded, total);
      },
      signal
    );
    return file;
  }

  return {
    ensureCustomerSiteFolder,
    ensureEmailThumbnailsFolder,
    uploadEmailThumbnail,
    buildFileName,
    buildFileNames,
    loadMasterData,
    saveMasterData,
    appendHistoryRecords,
    loadHistory,
    uploadItem,
    createResumableSession,
  };
})();

window.Drive = Drive;
