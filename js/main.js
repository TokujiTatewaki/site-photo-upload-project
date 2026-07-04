// ============================================================
// 画面ロジック統合
// ============================================================
const state = {
  masterDataFileId: null,
  masterData: { customers: [], sites: [], yearMonths: [] },
  selectedCustomerId: "",
  selectedSiteId: "",
  selectedYearMonth: "",
  selectedFiles: [],
  pendingModalType: null, // 'customer' | 'site' | 'yearMonth'
  uploadAbortController: null, // アップロード中断用（「中断」ボタンで.abort()する）
};

const NEW_VALUE = "__new__";

function getDeviceId() {
  let id = localStorage.getItem("deviceId");
  if (!id) {
    id = "device-" + Math.random().toString(36).slice(2, 8);
    localStorage.setItem("deviceId", id);
  }
  return id;
}

function $(sel) {
  return document.querySelector(sel);
}

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  $("#screen-" + name).classList.remove("hidden");
}

function setStatusMessage(msg, isError) {
  const el = $("#status-message");
  el.textContent = msg || "";
  el.classList.toggle("error", !!isError);
}

// ---------------- マスタデータ / プルダウン ----------------

function findCustomerName(id) {
  const c = state.masterData.customers.find((c) => c.id === id);
  return c ? c.name : "";
}

function findSiteName(id) {
  const s = state.masterData.sites.find((s) => s.id === id);
  return s ? s.name : "";
}

function renderCustomerOptions() {
  const sel = $("#select-customer");
  sel.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "-- 選択してください --";
  sel.appendChild(blank);

  state.masterData.customers.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });

  const newOpt = document.createElement("option");
  newOpt.value = NEW_VALUE;
  newOpt.textContent = "その他（新規作成）";
  sel.appendChild(newOpt);

  sel.value = state.selectedCustomerId || "";
}

function renderSiteOptions() {
  const sel = $("#select-site");
  sel.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "-- 選択してください --";
  sel.appendChild(blank);

  if (state.selectedCustomerId) {
    state.masterData.sites
      .filter((s) => s.customerId === state.selectedCustomerId)
      .forEach((s) => {
        const opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.name;
        sel.appendChild(opt);
      });
  }

  const newOpt = document.createElement("option");
  newOpt.value = NEW_VALUE;
  newOpt.textContent = "その他（新規作成）";
  sel.appendChild(newOpt);

  sel.disabled = !state.selectedCustomerId;
  sel.value = state.selectedSiteId || "";
}

function renderYearMonthOptions() {
  const sel = $("#select-yearmonth");
  sel.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "-- 選択してください --";
  sel.appendChild(blank);

  const sorted = [...state.masterData.yearMonths].sort().reverse();
  sorted.forEach((ym) => {
    const opt = document.createElement("option");
    opt.value = ym;
    opt.textContent = formatYearMonth(ym);
    sel.appendChild(opt);
  });

  const newOpt = document.createElement("option");
  newOpt.value = NEW_VALUE;
  newOpt.textContent = "その他（新規作成）";
  sel.appendChild(newOpt);

  sel.value = state.selectedYearMonth || "";
}

function formatYearMonth(ym) {
  if (!/^\d{6}$/.test(ym)) return ym;
  return `${ym.slice(0, 4)}年${ym.slice(4, 6)}月`;
}

async function loadMasterDataAndRender() {
  try {
    const { fileId, data } = await Drive.loadMasterData();
    state.masterDataFileId = fileId;
    state.masterData = data;
  } catch (e) {
    console.warn("マスタデータのDrive読み込みに失敗。ローカルキャッシュを使用します。", e);
    const cached = await DB.getMasterCache();
    state.masterData = cached || { customers: [], sites: [], yearMonths: [] };
  }
  renderCustomerOptions();
  renderSiteOptions();
  renderYearMonthOptions();
}

// ---------------- 新規作成モーダル ----------------

function openModal(type) {
  state.pendingModalType = type;
  const titleMap = {
    customer: "顧客名を新規作成",
    site: "施工現場を新規作成",
    yearMonth: "施工年月を新規作成",
  };
  $("#modal-title").textContent = titleMap[type];
  $("#modal-text-input").classList.toggle("hidden", type === "yearMonth");
  $("#modal-month-input").classList.toggle("hidden", type !== "yearMonth");
  $("#modal-text-input").value = "";
  $("#modal-month-input").value = "";
  $("#modal-overlay").classList.remove("hidden");
}

function closeModal() {
  $("#modal-overlay").classList.add("hidden");
  state.pendingModalType = null;
}

async function confirmModal() {
  const type = state.pendingModalType;
  let value = "";
  if (type === "yearMonth") {
    const raw = $("#modal-month-input").value; // "YYYY-MM"
    if (!raw) {
      alert("施工年月を入力してください");
      return;
    }
    value = raw.replace("-", "");
  } else {
    value = $("#modal-text-input").value.trim();
    if (!value) {
      alert("入力してください");
      return;
    }
  }

  const confirmBtn = $("#modal-confirm");
  const cancelBtn = $("#modal-cancel");
  confirmBtn.disabled = true;
  cancelBtn.disabled = true;

  try {
    if (type === "customer") {
      // 同名の顧客が既にあれば新規作成せず既存を選択する
      // （二重タップ等で同名が重複登録されるのを防ぐ）
      const existing = state.masterData.customers.find((c) => c.name === value);
      if (existing) {
        state.selectedCustomerId = existing.id;
      } else {
        const id = crypto.randomUUID();
        state.masterData.customers.push({ id, name: value });
        await persistMasterData();
        state.selectedCustomerId = id;
      }
      state.selectedSiteId = "";
      renderCustomerOptions();
      renderSiteOptions();
    } else if (type === "site") {
      if (!state.selectedCustomerId) {
        alert("先に顧客名を選択してください");
        return;
      }
      // 同じ顧客配下に同名の施工現場が既にあれば新規作成せず既存を選択する
      const existing = state.masterData.sites.find(
        (s) => s.customerId === state.selectedCustomerId && s.name === value
      );
      if (existing) {
        state.selectedSiteId = existing.id;
      } else {
        const id = crypto.randomUUID();
        state.masterData.sites.push({ id, customerId: state.selectedCustomerId, name: value });
        await persistMasterData();
        state.selectedSiteId = id;
      }
      renderSiteOptions();
    } else if (type === "yearMonth") {
      if (!state.masterData.yearMonths.includes(value)) {
        state.masterData.yearMonths.push(value);
        await persistMasterData();
      }
      state.selectedYearMonth = value;
      renderYearMonthOptions();
    }
    closeModal();
  } catch (e) {
    alert("新規項目の保存に失敗しました: " + e.message);
  } finally {
    confirmBtn.disabled = false;
    cancelBtn.disabled = false;
  }
}

async function persistMasterData() {
  await DB.setMasterCache(state.masterData);
  if (state.masterDataFileId) {
    await Drive.saveMasterData(state.masterDataFileId, state.masterData);
  }
}

// ---------------- 写真選択・アップロード ----------------

function updateSelectedFilesInfo() {
  const info = $("#selected-files-info");
  if (state.selectedFiles.length === 0) {
    info.textContent = "写真が選択されていません";
  } else {
    info.textContent = `${state.selectedFiles.length} 件の写真を選択中`;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}

// ---------------- アップロード進捗モーダル ----------------

function openUploadModal() {
  $("#upload-modal-overlay").classList.remove("hidden");
}

function closeUploadModal() {
  $("#upload-modal-overlay").classList.add("hidden");
}

// mode: "running"（中断ボタン表示）| "done"（閉じるボタン表示）
function setUploadModalMode(mode) {
  $("#btn-upload-cancel").classList.toggle("hidden", mode !== "running");
  $("#btn-upload-cancel").disabled = false;
  $("#btn-upload-close").classList.toggle("hidden", mode !== "done");
  $("#upload-modal-warning").classList.toggle("hidden", mode !== "running");
}

function showUploadModalMessage(msg, isError) {
  const el = $("#upload-modal-message");
  el.textContent = msg || "";
  el.classList.toggle("hidden", !msg);
  el.classList.toggle("error", !!isError);
}

function setUploadOverallProgress(uploadedBytes, totalBytes, doneCount, totalCount) {
  const pct = totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0;
  $("#upload-overall-bar").style.width = pct + "%";
  $("#upload-overall-count").textContent = `${doneCount} / ${totalCount} 件`;
  $("#upload-overall-status").textContent = `${pct}% (${formatBytes(uploadedBytes)} / ${formatBytes(totalBytes)})`;
}

function setUploadCurrentProgress(fileName, uploaded, total) {
  const pct = total > 0 ? Math.round((uploaded / total) * 100) : 0;
  $("#upload-current-filename").textContent = fileName;
  $("#upload-current-bar").style.width = pct + "%";
  $("#upload-current-status").textContent = `${pct}% (${formatBytes(uploaded)} / ${formatBytes(total)})`;
}

// リセットして最初から作業できるようにする（アップロード完了後、閉じるボタン押下時に使用）
function resetSelectionForNextUpload() {
  state.selectedCustomerId = "";
  state.selectedSiteId = "";
  state.selectedYearMonth = "";
  renderCustomerOptions();
  renderSiteOptions();
  renderYearMonthOptions();
}

// onProgress(uploaded, total) はアップロード中の進捗コールバック（省略可）
// signalはAbortSignal（省略可、中断操作に対応するため）
async function uploadSingleItem(item, onProgress, signal) {
  try {
    const file = await Drive.uploadItem(
      item,
      (uploaded, total) => {
        if (onProgress) onProgress(uploaded, total);
      },
      signal
    );
    await DB.updateUploadItem(item.id, {
      status: "completed",
      driveFileId: file.id,
      completedAt: new Date().toISOString(),
    });
    await DB.dropBlob(item.id);
    if (onProgress) onProgress(item.totalBytes, item.totalBytes);
    return { status: "completed", driveFileId: file.id };
  } catch (e) {
    if (e.code === "CANCELLED") {
      await DB.updateUploadItem(item.id, {
        status: "paused",
        uploadedBytes: e.uploadedBytes != null ? e.uploadedBytes : item.uploadedBytes || 0,
      });
      return { status: "cancelled" };
    }
    const status = e.code === "NETWORK_ERROR" ? "paused" : "failed";
    await DB.updateUploadItem(item.id, { status, error: e.message });
    return { status, error: e.message };
  }
}

async function startUpload() {
  if (!state.selectedCustomerId || state.selectedCustomerId === NEW_VALUE) {
    alert("顧客名を選択してください");
    return;
  }
  if (!state.selectedSiteId || state.selectedSiteId === NEW_VALUE) {
    alert("施工現場を選択してください");
    return;
  }
  if (!state.selectedYearMonth || state.selectedYearMonth === NEW_VALUE) {
    alert("施工年月を選択してください");
    return;
  }
  if (state.selectedFiles.length === 0) {
    alert("写真を選択してください");
    return;
  }

  const customerName = findCustomerName(state.selectedCustomerId);
  const siteName = findSiteName(state.selectedSiteId);
  const yearMonth = state.selectedYearMonth;

  $("#btn-upload").disabled = true;
  state.uploadAbortController = new AbortController();
  setUploadOverallProgress(0, 1, 0, 0);
  setUploadCurrentProgress("-", 0, 1);
  showUploadModalMessage("");
  setUploadModalMode("running");
  openUploadModal();
  setStatusMessage("フォルダを準備しています...");

  try {
    const folderId = await Drive.ensureCustomerSiteFolder(customerName, siteName);

    setStatusMessage("画像を圧縮しています...");
    const compressedList = [];
    for (const file of state.selectedFiles) {
      const compressed = await Compress.processFile(file);
      compressedList.push(compressed);
    }

    setStatusMessage("ファイル名を採番しています...");
    const fileNames = await Drive.buildFileNames(
      folderId,
      yearMonth,
      customerName,
      siteName,
      compressedList.length,
      "jpg"
    );

    const items = [];
    for (let i = 0; i < compressedList.length; i++) {
      const c = compressedList[i];
      const item = {
        id: crypto.randomUUID(),
        blob: c.blob,
        fileName: fileNames[i],
        mimeType: c.mimeType,
        folderId,
        totalBytes: c.blob.size,
        uploadedBytes: 0,
        sessionUrl: null,
        status: "pending",
        customer: customerName,
        site: siteName,
        yearMonth,
        device: getDeviceId(),
        createdAt: new Date().toISOString(),
      };
      await DB.addUploadItem(item);
      items.push(item);
    }

    const totalBytesAll = items.reduce((sum, i) => sum + i.totalBytes, 0);
    let completedBytesAll = 0;
    let cancelledMidway = false;

    setStatusMessage("アップロード中...");
    const results = [];
    for (let idx = 0; idx < items.length; idx++) {
      if (state.uploadAbortController.signal.aborted) {
        cancelledMidway = true;
        break;
      }
      const item = items[idx];
      setUploadCurrentProgress(item.fileName, 0, item.totalBytes);
      setUploadOverallProgress(completedBytesAll, totalBytesAll, idx, items.length);

      const result = await uploadSingleItem(
        item,
        (uploaded, total) => {
          setUploadCurrentProgress(item.fileName, uploaded, total);
          setUploadOverallProgress(completedBytesAll + uploaded, totalBytesAll, idx, items.length);
        },
        state.uploadAbortController.signal
      );
      results.push({ item, result });

      if (result.status === "cancelled") {
        cancelledMidway = true;
        break;
      }
      completedBytesAll += item.totalBytes;
      setUploadOverallProgress(completedBytesAll, totalBytesAll, idx + 1, items.length);
    }

    const historyRecords = results
      .filter(({ result }) => result.status !== "cancelled")
      .map(({ item, result }) => ({
        id: item.id,
        customer: item.customer,
        site: item.site,
        yearMonth: item.yearMonth,
        fileName: item.fileName,
        status: result.status,
        startedAt: item.createdAt,
        completedAt: result.status === "completed" ? new Date().toISOString() : null,
        sizeBytes: item.totalBytes,
        driveFileId: result.driveFileId || null,
        device: item.device,
      }));

    if (historyRecords.length > 0) {
      try {
        await Drive.appendHistoryRecords(historyRecords);
      } catch (e) {
        console.warn("共有履歴ファイルへの反映に失敗しました（端末ローカル履歴には記録済み）", e);
      }
    }

    const failedCount = results.filter(
      (r) => r.result.status === "failed" || r.result.status === "paused"
    ).length;

    setUploadModalMode("done");
    if (cancelledMidway) {
      showUploadModalMessage(
        "アップロードを中断しました。未完了分は履歴画面から再開できます。",
        true
      );
    } else if (failedCount === 0) {
      showUploadModalMessage("全てのアップロードが完了しました。");
    } else {
      showUploadModalMessage(
        `${failedCount}件が未完了です。履歴画面から再試行できます。`,
        true
      );
    }

    setStatusMessage("");
    state.selectedFiles = [];
    $("#file-input").value = "";
    updateSelectedFilesInfo();
  } catch (e) {
    setUploadModalMode("done");
    showUploadModalMessage("アップロード処理でエラーが発生しました: " + e.message, true);
    setStatusMessage("");
  } finally {
    $("#btn-upload").disabled = false;
    state.uploadAbortController = null;
  }
}

// ---------------- レジューム（再開）----------------

async function retryPendingUploads() {
  const items = await DB.getResumableItems();
  for (const item of items) {
    if (!item.blob) continue; // Blobが失われている場合は再開不可（履歴上は失敗のまま）
    await uploadSingleItem(item);
  }
  if (items.length > 0) {
    await renderHistory();
  }
}

window.addEventListener("online", () => {
  setStatusMessage("ネットワークに再接続しました。中断していたアップロードを再開します。");
  retryPendingUploads();
});

// ---------------- 履歴画面 ----------------

function statusLabel(status) {
  return (
    {
      completed: "完了",
      uploading: "アップロード中",
      pending: "待機中",
      paused: "中断（再開待ち）",
      failed: "失敗",
    }[status] || status
  );
}

async function renderHistory() {
  const localItems = await DB.getAllUploadItems();
  const localEl = $("#local-history-list");
  localEl.innerHTML = "";
  if (localItems.length === 0) {
    localEl.innerHTML = "<p>この端末での履歴はまだありません。</p>";
  }
  localItems.forEach((item) => {
    const row = document.createElement("div");
    row.className = "history-row status-" + item.status;
    row.innerHTML = `
      <div class="history-main">
        <strong>${escapeHtml(item.fileName)}</strong>
        <span class="badge">${statusLabel(item.status)}</span>
      </div>
      <div class="history-sub">${escapeHtml(item.customer)} / ${escapeHtml(item.site)} / ${formatYearMonth(item.yearMonth)}</div>
    `;
    // 中断時、実際にアップロード中だった1件は"paused"になるが、
    // まだ順番が来ていなかった（中断でループが止まった）残りの分は"pending"のまま
    // 履歴に残る。"completed"以外はすべて再試行できるようにする。
    if (item.status !== "completed") {
      const btn = document.createElement("button");
      btn.textContent = "再試行";
      btn.onclick = async () => {
        btn.disabled = true;
        await uploadSingleItem(item);
        await renderHistory();
      };
      row.appendChild(btn);
    }
    localEl.appendChild(row);
  });

  const sharedEl = $("#shared-history-list");
  sharedEl.innerHTML = "読み込み中...";
  try {
    const shared = await Drive.loadHistory();
    sharedEl.innerHTML = "";
    if (shared.length === 0) {
      sharedEl.innerHTML = "<p>共有履歴はまだありません。</p>";
    }
    shared
      .slice()
      .reverse()
      .forEach((rec) => {
        const row = document.createElement("div");
        row.className = "history-row status-" + rec.status;
        row.innerHTML = `
          <div class="history-main">
            <strong>${escapeHtml(rec.fileName)}</strong>
            <span class="badge">${statusLabel(rec.status)}</span>
          </div>
          <div class="history-sub">${escapeHtml(rec.customer)} / ${escapeHtml(rec.site)} / ${formatYearMonth(rec.yearMonth)} / ${escapeHtml(rec.device || "")}</div>
        `;
        sharedEl.appendChild(row);
      });
  } catch (e) {
    sharedEl.innerHTML = "<p>共有履歴の取得に失敗しました（オフラインの可能性があります）。</p>";
  }
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

// ---------------- 初期化・イベント登録 ----------------

async function init() {
  const versionEl = $("#app-version");
  if (versionEl) versionEl.textContent = "Version: " + APP_VERSION;

  await Auth.init();

  $("#btn-login").addEventListener("click", async () => {
    $("#btn-login").disabled = true;
    setStatusMessage("Googleにログインしています...");
    try {
      await Auth.signIn();
      await Auth.ensureRootFolderAccess();
      await loadMasterDataAndRender();
      showScreen("main");
      setStatusMessage("");
      retryPendingUploads();
    } catch (e) {
      setStatusMessage("ログインに失敗しました: " + e.message, true);
      $("#btn-login").disabled = false;
    }
  });

  $("#select-customer").addEventListener("change", (e) => {
    if (e.target.value === NEW_VALUE) {
      openModal("customer");
      e.target.value = state.selectedCustomerId || "";
      return;
    }
    state.selectedCustomerId = e.target.value;
    state.selectedSiteId = "";
    renderSiteOptions();
  });

  $("#select-site").addEventListener("change", (e) => {
    if (e.target.value === NEW_VALUE) {
      openModal("site");
      e.target.value = state.selectedSiteId || "";
      return;
    }
    state.selectedSiteId = e.target.value;
  });

  $("#select-yearmonth").addEventListener("change", (e) => {
    if (e.target.value === NEW_VALUE) {
      openModal("yearMonth");
      e.target.value = state.selectedYearMonth || "";
      return;
    }
    state.selectedYearMonth = e.target.value;
  });

  $("#modal-confirm").addEventListener("click", confirmModal);
  $("#modal-cancel").addEventListener("click", closeModal);

  $("#file-input").addEventListener("change", (e) => {
    state.selectedFiles = Array.from(e.target.files || []);
    updateSelectedFilesInfo();
  });

  $("#btn-upload").addEventListener("click", startUpload);

  $("#btn-upload-cancel").addEventListener("click", () => {
    if (state.uploadAbortController) {
      state.uploadAbortController.abort();
    }
    $("#btn-upload-cancel").disabled = true;
  });

  $("#btn-upload-close").addEventListener("click", () => {
    closeUploadModal();
    resetSelectionForNextUpload();
  });

  $("#tab-main").addEventListener("click", () => {
    $("#tab-main").classList.add("active");
    $("#tab-history").classList.remove("active");
    $("#panel-main").classList.remove("hidden");
    $("#panel-history").classList.add("hidden");
  });
  $("#tab-history").addEventListener("click", async () => {
    $("#tab-history").classList.add("active");
    $("#tab-main").classList.remove("active");
    $("#panel-history").classList.remove("hidden");
    $("#panel-main").classList.add("hidden");
    await renderHistory();
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW登録失敗", e));
  }

  // 補足：Google Identity Services（OAuthトークンモデル）は仕様上、
  // ユーザー操作（クリック等のジェスチャー）を伴わないトークン取得を認めていない。
  // そのため起動直後の完全自動ログインは実現できず、毎回「ログイン」ボタンの
  // タップは必要になる。ただし signIn() 側でまずサイレント取得を試みるため、
  // 有効なセッション・許可が残っていればタップ後に同意画面を経由せず即座に進める。
  showScreen("login");
}

document.addEventListener("DOMContentLoaded", init);
