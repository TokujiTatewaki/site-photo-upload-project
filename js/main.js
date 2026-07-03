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

  try {
    if (type === "customer") {
      const id = crypto.randomUUID();
      state.masterData.customers.push({ id, name: value });
      await persistMasterData();
      state.selectedCustomerId = id;
      state.selectedSiteId = "";
      renderCustomerOptions();
      renderSiteOptions();
    } else if (type === "site") {
      if (!state.selectedCustomerId) {
        alert("先に顧客名を選択してください");
        return;
      }
      const id = crypto.randomUUID();
      state.masterData.sites.push({ id, customerId: state.selectedCustomerId, name: value });
      await persistMasterData();
      state.selectedSiteId = id;
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

function renderProgressRow(id, fileName) {
  const container = $("#upload-progress-list");
  let row = document.getElementById("progress-" + id);
  if (!row) {
    row = document.createElement("div");
    row.className = "progress-row";
    row.id = "progress-" + id;
    row.innerHTML = `
      <div class="progress-filename"></div>
      <div class="progress-bar-outer"><div class="progress-bar-inner"></div></div>
      <div class="progress-status"></div>
    `;
    container.appendChild(row);
  }
  row.querySelector(".progress-filename").textContent = fileName;
  return row;
}

function updateProgressRow(id, uploaded, total, statusText) {
  const row = document.getElementById("progress-" + id);
  if (!row) return;
  const pct = total > 0 ? Math.round((uploaded / total) * 100) : 0;
  row.querySelector(".progress-bar-inner").style.width = pct + "%";
  row.querySelector(".progress-status").textContent =
    statusText || `${pct}% (${formatBytes(uploaded)} / ${formatBytes(total)})`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}

async function uploadSingleItem(item) {
  renderProgressRow(item.id, item.fileName);
  updateProgressRow(item.id, item.uploadedBytes || 0, item.totalBytes, "アップロード準備中...");
  try {
    const file = await Drive.uploadItem(item, (uploaded, total) => {
      updateProgressRow(item.id, uploaded, total);
    });
    await DB.updateUploadItem(item.id, {
      status: "completed",
      driveFileId: file.id,
      completedAt: new Date().toISOString(),
    });
    await DB.dropBlob(item.id);
    updateProgressRow(item.id, item.totalBytes, item.totalBytes, "完了");
    return { status: "completed", driveFileId: file.id };
  } catch (e) {
    const status = e.code === "NETWORK_ERROR" ? "paused" : "failed";
    await DB.updateUploadItem(item.id, { status, error: e.message });
    updateProgressRow(
      item.id,
      item.uploadedBytes || 0,
      item.totalBytes,
      status === "paused" ? "中断（再接続時に自動再開します）" : "失敗: " + e.message
    );
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
  $("#upload-progress-list").innerHTML = "";
  $("#upload-warning").classList.remove("hidden");
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

    setStatusMessage("アップロード中...");
    const results = [];
    for (const item of items) {
      const result = await uploadSingleItem(item);
      results.push({ item, result });
    }

    const historyRecords = results.map(({ item, result }) => ({
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

    try {
      await Drive.appendHistoryRecords(historyRecords);
    } catch (e) {
      console.warn("共有履歴ファイルへの反映に失敗しました（端末ローカル履歴には記録済み）", e);
    }

    const failedCount = results.filter((r) => r.result.status !== "completed").length;
    setStatusMessage(
      failedCount === 0
        ? "全てのアップロードが完了しました"
        : `${failedCount}件が未完了です。履歴画面から再試行できます。`,
      failedCount > 0
    );

    state.selectedFiles = [];
    $("#file-input").value = "";
    updateSelectedFilesInfo();
  } catch (e) {
    setStatusMessage("アップロード処理でエラーが発生しました: " + e.message, true);
  } finally {
    $("#btn-upload").disabled = false;
    $("#upload-warning").classList.add("hidden");
  }
}

// ---------------- レジューム（再開）----------------

async function retryPendingUploads() {
  const items = await DB.getResumableItems();
  for (const item of items) {
    if (!item.blob) continue; // Blobが失われている場合は再開不可（履歴上は失敗のまま）
    renderProgressRow(item.id, item.fileName);
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
    if (item.status === "failed" || item.status === "paused") {
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

  showScreen("login");
}

document.addEventListener("DOMContentLoaded", init);
