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

// ---------------- ユーザー情報（氏名・メールアドレス） ----------------
// 端末のlocalStorageにのみ保存する（サーバー等には送らない。通知メール送信時のみ利用）。

function getUserProfile() {
  try {
    const raw = localStorage.getItem("userProfile");
    return raw ? JSON.parse(raw) : { name: "", email: "" };
  } catch (e) {
    return { name: "", email: "" };
  }
}

function setUserProfile(profile) {
  localStorage.setItem("userProfile", JSON.stringify(profile));
}

// 共有履歴に表示する名前。氏名が未設定の場合は、これまで通り端末IDで代替する。
function getDisplayName() {
  const profile = getUserProfile();
  return profile.name && profile.name.trim() ? profile.name.trim() : getDeviceId();
}

function $(sel) {
  return document.querySelector(sel);
}

// 設定画面を開く際、現在保存されている氏名・メールアドレスをフォームに反映してから表示する。
function openSettingsSheet() {
  const profile = getUserProfile();
  $("#profile-name-input").value = profile.name || "";
  $("#profile-email-input").value = profile.email || "";
  $("#profile-save-message").classList.add("hidden");
  $("#screen-settings").classList.add("open");
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
  newOpt.textContent = "その他（新規登録）";
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
  newOpt.textContent = "その他（新規登録）";
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
  newOpt.textContent = "その他（新規登録）";
  sel.appendChild(newOpt);

  sel.value = state.selectedYearMonth || "";
}

function formatYearMonth(ym) {
  if (!/^\d{6}$/.test(ym)) return ym;
  return `${ym.slice(0, 4)}年${ym.slice(4, 6)}月`;
}

// 完了通知メールに載せる、保存先Googleドライブフォルダへのリンク
function buildDriveFolderUrl(folderId) {
  return "https://drive.google.com/drive/folders/" + folderId;
}

// data URL文字列（"data:image/jpeg;base64,..."）をBlobに変換する。
// 「まとめて再試行」時、以前のアップロード実行で既に完了済みのファイルは
// 圧縮後Blobが完了時に破棄済み（js/db.jsのdropBlob参照）で、その写真自体からは
// メール用サムネイルを作り直せない。代わりに履歴表示用に保存してある小さな
// thumbnailDataUrlを転用してメールに添付するために使う（画質は低めになる）。
function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// 通知メールに埋め込むサムネイル画像をDriveにアップロードし、ファイルIDの一覧を返す。
// Googleドライブ側の自動サムネイル生成に頼らず確実にメールへ表示するため、
// 端末側で生成した画像を専用の小さなファイルとしてアップロードしておく方式。
// entries: [{ id: 識別用文字列, blob: Blob }, ...]（blobが無いものはスキップ）
// 個々のアップロード失敗はスキップするのみで、本体アップロードや通知送信自体は継続する。
async function uploadNotifyThumbnails(entries) {
  const fileIds = [];
  for (const entry of entries) {
    if (fileIds.length >= CONFIG.NOTIFY_MAX_INLINE_PHOTOS) break;
    if (!entry.blob) continue;
    try {
      const file = await Drive.uploadEmailThumbnail(entry.blob, `email-thumb_${entry.id}.jpg`);
      fileIds.push(file.id);
    } catch (e) {
      console.warn(
        "通知メール用サムネイルのアップロードに失敗しました（本体の写真アップロードには影響ありません）",
        e
      );
    }
  }
  return fileIds;
}

// 現在の年月を"YYYYMM"形式で返す
function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ③施工年月の初期選択として現在の年月を使う。マスタデータに無ければ仮登録する。
async function applyDefaultYearMonth() {
  const currentYm = getCurrentYearMonth();
  if (!state.masterData.yearMonths.includes(currentYm)) {
    state.masterData.yearMonths.push(currentYm);
    await persistMasterData();
  }
  state.selectedYearMonth = currentYm;
  renderYearMonthOptions();
  updateUploadButtonState();
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
  await applyDefaultYearMonth();
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
  // 施工年月の新規作成時は、入力の手間を減らすため現在の年月をあらかじめセットしておく
  if (type === "yearMonth") {
    const ym = getCurrentYearMonth(); // "YYYYMM"
    $("#modal-month-input").value = `${ym.slice(0, 4)}-${ym.slice(4, 6)}`;
  } else {
    $("#modal-month-input").value = "";
  }
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
    updateUploadButtonState();
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

// ①②③と写真選択がすべて揃うまでは、アップロード実行ボタンを見た目上disabledにする。
// ただし実際のdisabled属性は付けない（ボタン自体は押せる状態のままにする）ことで、
// 準備が整う前に間違って押した場合は従来通り「xxしてください」という案内が出るようにする。
function updateUploadButtonState() {
  const ready =
    !!state.selectedCustomerId &&
    state.selectedCustomerId !== NEW_VALUE &&
    !!state.selectedSiteId &&
    state.selectedSiteId !== NEW_VALUE &&
    !!state.selectedYearMonth &&
    state.selectedYearMonth !== NEW_VALUE &&
    state.selectedFiles.length > 0;
  $("#btn-upload").classList.toggle("look-disabled", !ready);
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

// mode: "running"（中断ボタン・スピナー表示）| "done"（閉じるボタン表示、完了時）
//     | "cancelled"（閉じるボタン表示、ユーザーが中断した場合）
const UPLOAD_MODAL_TITLES = {
  running: "アップロード中",
  done: "アップロード完了",
  cancelled: "アップロード中断",
};
function setUploadModalMode(mode) {
  $("#upload-modal-title").textContent = UPLOAD_MODAL_TITLES[mode] || UPLOAD_MODAL_TITLES.running;
  $("#btn-upload-cancel").classList.toggle("hidden", mode !== "running");
  $("#btn-upload-cancel").disabled = false;
  $("#btn-upload-close").classList.toggle("hidden", mode === "running");
  $("#upload-modal-warning").classList.toggle("hidden", mode !== "running");
  $("#upload-modal-spinner").classList.toggle("hidden", mode !== "running");
}

// アップロード処理の現在の段階（フォルダ準備中、圧縮中など）をポップアップ内に表示する
// （以前はメイン画面上部のステータス欄に表示していたが、ポップアップ側に集約する）
function setUploadStageMessage(msg) {
  $("#upload-modal-stage").textContent = msg || "";
}

function showUploadModalMessage(msg, isError) {
  const el = $("#upload-modal-message");
  el.textContent = msg || "";
  el.classList.toggle("hidden", !msg);
  el.classList.toggle("error", !!isError);
}

// 全体進捗バー用。percentは0〜100の数値をそのまま渡す（算出は呼び出し側のステージ管理で行う）。
// 以前はアップロード済みバイト数だけから算出していたため、本体アップロードが終わった
// 直後に100%表示になり、その後のサムネイル生成・アップロード・履歴反映が続く間も
// 100%のまま止まって見える問題があった。現在は複数ステージの重み付き合計を
// 呼び出し側（computeStageProgress）で算出し、ここには最終的なpercentのみ渡す。
function setUploadOverallProgress(percent, doneCount, totalCount, uploadedBytes, totalBytes) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  $("#upload-overall-bar").style.width = pct + "%";
  $("#upload-overall-count").textContent = `${doneCount} / ${totalCount} 件`;
  $("#upload-overall-status").textContent = `${pct}% (${formatBytes(uploadedBytes)} / ${formatBytes(totalBytes)})`;
}

// 複数ステージ（フォルダ準備・圧縮・本体アップロード・サムネイル準備・仕上げ等）を
// 重み付き合計することで、全体進捗が実際の残り作業量をより正確に反映するようにする。
// stages: [{ weight: number, getFraction: () => 0〜1の完了率 }, ...]（weightの合計は100想定）
function computeStageProgress(stages) {
  let sum = 0;
  for (const s of stages) {
    const frac = Math.max(0, Math.min(1, s.getFraction()));
    sum += s.weight * frac;
  }
  return Math.min(100, Math.round(sum));
}

// ---------------- 複数ファイル並列アップロードの進捗表示（スロット方式） ----------------
// 同時アップロード数ぶんの「スロット」をあらかじめ用意し、各スロットが次々と
// 未処理のファイルを引き継いで進捗表示を更新する（案C：並列アップロード）。

function renderUploadSlots(count) {
  const container = $("#upload-file-progress-list");
  container.innerHTML = "";
  for (let s = 0; s < count; s++) {
    const row = document.createElement("div");
    row.className = "progress-row";
    row.id = `upload-slot-${s}`;
    row.innerHTML = `
      <div class="progress-filename" id="upload-slot-${s}-filename">待機中...</div>
      <div class="progress-bar-outer"><div class="progress-bar-inner" id="upload-slot-${s}-bar"></div></div>
      <div class="progress-status" id="upload-slot-${s}-status"></div>
    `;
    container.appendChild(row);
  }
}

function setSlotFile(slotIndex, fileName) {
  const el = $(`#upload-slot-${slotIndex}-filename`);
  if (el) el.textContent = fileName;
  const bar = $(`#upload-slot-${slotIndex}-bar`);
  if (bar) bar.style.width = "0%";
  const status = $(`#upload-slot-${slotIndex}-status`);
  if (status) status.textContent = "";
}

function setSlotProgress(slotIndex, uploaded, total) {
  const pct = total > 0 ? Math.round((uploaded / total) * 100) : 0;
  const bar = $(`#upload-slot-${slotIndex}-bar`);
  if (bar) bar.style.width = pct + "%";
  const status = $(`#upload-slot-${slotIndex}-status`);
  if (status) status.textContent = `${pct}% (${formatBytes(uploaded)} / ${formatBytes(total)})`;
}

// 複数ファイルを指定した並列数で同時アップロードするワーカープール。
// 各ワーカー（スロット）は担当ファイルが完了したら次の未処理ファイルを引き継ぐ。
// 中断（signal.abort()）時は、実行中のアイテムはfetch側で中断されそれぞれ
// "cancelled"扱いで返るが、まだ着手していないアイテムはそのまま何もせず終了する
// （以前の直列処理で「中断以降は一切手をつけない」としていた挙動を踏襲）。
// 戻り値resultsは items と同じ順序・同じ長さの配列（未着手のインデックスはundefinedのまま）。
async function runUploadQueue(items, { concurrency, signal, onItemStart, onItemProgress, onItemDone }) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker(slotIndex) {
    while (true) {
      if (signal && signal.aborted) return;
      const idx = nextIndex;
      nextIndex += 1;
      if (idx >= items.length) return;
      const item = items[idx];
      if (onItemStart) onItemStart(slotIndex, idx, item);
      const result = await uploadSingleItem(
        item,
        (uploaded, total) => {
          if (onItemProgress) onItemProgress(slotIndex, idx, uploaded, total);
        },
        signal
      );
      results[idx] = result;
      if (onItemDone) onItemDone(slotIndex, idx, result);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, (_, s) => worker(s)));
  return results;
}

// リセットして最初から作業できるようにする（アップロード完了後、閉じるボタン押下時に使用）
// ③施工年月は空欄に戻さず、現在の年月を初期選択として再設定する
async function resetSelectionForNextUpload() {
  state.selectedCustomerId = "";
  state.selectedSiteId = "";
  renderCustomerOptions();
  renderSiteOptions();
  await applyDefaultYearMonth();
  updateUploadButtonState();
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
  const totalFileCount = state.selectedFiles.length;
  const notifyEnabled = !!CONFIG.NOTIFY_WEBAPP_URL;
  // このアップロード実行（＝1回のアップロード操作）をまとめるための識別子。
  // 履歴画面では、この値が同じアイテムを1つのグループとしてまとめて表示する。
  const batchId = crypto.randomUUID();

  $("#btn-upload").disabled = true;
  state.uploadAbortController = new AbortController();
  showUploadModalMessage("");
  setUploadModalMode("running");
  openUploadModal();
  setUploadStageMessage("フォルダを準備しています...");

  // 全体進捗は「フォルダ準備・圧縮・採番・本体アップロード・サムネイル準備・仕上げ」の
  // 重み付き合計で算出する（本体アップロードの完了だけで100%にならないようにするため）。
  // フォルダ準備／採番／サムネイル準備／仕上げは所要時間が短く内訳を追う意味が薄いため
  // 完了・未完了の二値、圧縮とアップロードはファイル数・バイト数から連続的に算出する。
  const progress = {
    folderDone: false,
    compressedCount: 0,
    namingDone: false,
    uploadedBytesByItem: new Map(), // item.id -> uploadedBytes
    totalBytes: null, // 圧縮完了まで未確定
    thumbsDone: false,
    finalizeDone: false,
  };
  const stages = [
    { weight: 3, getFraction: () => (progress.folderDone ? 1 : 0) },
    { weight: 12, getFraction: () => progress.compressedCount / totalFileCount },
    { weight: 3, getFraction: () => (progress.namingDone ? 1 : 0) },
    {
      weight: notifyEnabled ? 60 : 77,
      getFraction: () => {
        if (progress.totalBytes === null) return 0;
        if (progress.totalBytes === 0) return 1;
        let sum = 0;
        for (const v of progress.uploadedBytesByItem.values()) sum += v;
        return sum / progress.totalBytes;
      },
    },
    { weight: notifyEnabled ? 17 : 0, getFraction: () => (progress.thumbsDone ? 1 : 0) },
    { weight: 5, getFraction: () => (progress.finalizeDone ? 1 : 0) },
  ];
  let completedFileCount = 0;
  function refreshOverallProgress() {
    let uploadedBytesSum = 0;
    for (const v of progress.uploadedBytesByItem.values()) uploadedBytesSum += v;
    setUploadOverallProgress(
      computeStageProgress(stages),
      completedFileCount,
      totalFileCount,
      uploadedBytesSum,
      progress.totalBytes || 0
    );
  }
  refreshOverallProgress();

  try {
    const folderId = await Drive.ensureCustomerSiteFolder(customerName, siteName);
    progress.folderDone = true;
    refreshOverallProgress();

    setUploadStageMessage("画像を圧縮しています...");
    const compressedList = [];
    for (const file of state.selectedFiles) {
      const compressed = await Compress.processFile(file);
      compressedList.push(compressed);
      progress.compressedCount += 1;
      refreshOverallProgress();
    }

    setUploadStageMessage("ファイル名を採番しています...");
    const fileNames = await Drive.buildFileNames(
      folderId,
      yearMonth,
      customerName,
      siteName,
      compressedList.length,
      "jpg"
    );
    progress.namingDone = true;
    refreshOverallProgress();

    const items = [];
    // 通知メールに埋め込むサムネイル画像（DBには保存しない。この関数の実行中のみ使う一時データ）
    const emailThumbnailBlobs = [];
    for (let i = 0; i < compressedList.length; i++) {
      const c = compressedList[i];
      const item = {
        id: crypto.randomUUID(),
        batchId,
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
        device: getDisplayName(),
        createdAt: new Date().toISOString(),
        thumbnailDataUrl: c.thumbnailDataUrl || null,
      };
      await DB.addUploadItem(item);
      items.push(item);
      emailThumbnailBlobs.push(c.emailThumbnailBlob || null);
    }

    progress.totalBytes = items.reduce((sum, i) => sum + i.totalBytes, 0);
    refreshOverallProgress();

    const concurrency = Math.max(1, Math.min(CONFIG.UPLOAD_CONCURRENCY, items.length));
    setUploadStageMessage(
      totalFileCount > 1 ? `アップロード中...（同時${concurrency}件ずつ処理）` : "アップロード中..."
    );
    renderUploadSlots(concurrency);

    const rawResults = await runUploadQueue(items, {
      concurrency: CONFIG.UPLOAD_CONCURRENCY,
      signal: state.uploadAbortController.signal,
      onItemStart: (slotIndex, idx, item) => {
        setSlotFile(slotIndex, item.fileName);
        progress.uploadedBytesByItem.set(item.id, 0);
        refreshOverallProgress();
      },
      onItemProgress: (slotIndex, idx, uploaded, total) => {
        setSlotProgress(slotIndex, uploaded, total);
        progress.uploadedBytesByItem.set(items[idx].id, uploaded);
        refreshOverallProgress();
      },
      onItemDone: (slotIndex, idx, result) => {
        const item = items[idx];
        progress.uploadedBytesByItem.set(item.id, item.totalBytes);
        if (result.status === "completed") completedFileCount += 1;
        refreshOverallProgress();
      },
    });

    const cancelledMidway = state.uploadAbortController.signal.aborted;
    // rawResultsはitemsと同じ順序・長さ（未着手はundefined）。emailThumbnailBlobsとの
    // 対応を保つため、元のインデックス（idx）を保持したまま扱う。
    const results = items
      .map((item, idx) => (rawResults[idx] ? { item, result: rawResults[idx], idx } : null))
      .filter(Boolean);

    const historyRecords = results
      .filter(({ result }) => result.status !== "cancelled")
      .map(({ item, result }) => ({
        id: item.id,
        batchId: item.batchId,
        folderId: item.folderId,
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
        thumbnailDataUrl: item.thumbnailDataUrl || null,
      }));

    if (historyRecords.length > 0) {
      try {
        await Drive.appendHistoryRecords(historyRecords);
      } catch (e) {
        console.warn("共有履歴ファイルへの反映に失敗しました（端末ローカル履歴には記録済み）", e);
      }
    }
    progress.finalizeDone = true;
    refreshOverallProgress();

    const failedCount = results.filter(
      (r) => r.result.status === "failed" || r.result.status === "paused"
    ).length;
    const successCount = results.filter((r) => r.result.status === "completed").length;

    // 通知メールに埋め込むサムネイル画像をアップロードする（通知メール機能が有効な場合のみ）。
    // Googleドライブの自動サムネイル生成（非同期）を待つのではなく、端末側で生成した
    // 専用の小さな画像を確実に用意しておく方式。
    // 中断（cancelledMidway）の場合は、そもそもこのメール自体に写真を添付する意味が薄い
    // （まだアップロード作業の途中であり、完了報告ではないため）ので、サムネイル生成・
    // アップロード自体をスキップする（中断時のメール送信を早く・軽くする効果もある）。
    let notifyPhotoFileIds = [];
    if (notifyEnabled && !cancelledMidway) {
      setUploadStageMessage("通知メール用の画像を準備しています...");
      const thumbEntries = [];
      for (const r of results) {
        if (r.result.status === "completed") {
          thumbEntries.push({ id: r.item.id, blob: emailThumbnailBlobs[r.idx] });
        }
      }
      notifyPhotoFileIds = await uploadNotifyThumbnails(thumbEntries);
    }
    progress.thumbsDone = true;
    refreshOverallProgress();

    setUploadModalMode(cancelledMidway ? "cancelled" : "done");
    setUploadStageMessage("");
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

    // 完了・中断・一部失敗のいずれの場合も通知メールを送る
    // （NOTIFY_WEBAPP_URL未設定の場合はNotify側で何もしない）
    const profile = getUserProfile();
    Notify.sendUploadNotification({
      event: cancelledMidway ? "cancelled" : failedCount === 0 ? "completed" : "partial_failed",
      customer: customerName,
      site: siteName,
      yearMonth: formatYearMonth(yearMonth),
      uploaderName: profile.name || "",
      uploaderEmail: profile.email || "",
      successCount,
      totalCount: items.length,
      timestamp: new Date().toISOString(),
      folderUrl: buildDriveFolderUrl(folderId),
      photoFileIdsJson: JSON.stringify(notifyPhotoFileIds),
      photoCount: successCount,
    });

    state.selectedFiles = [];
    $("#file-input").value = "";
    updateSelectedFilesInfo();
    updateUploadButtonState();
  } catch (e) {
    setUploadModalMode("done");
    setUploadStageMessage("");
    showUploadModalMessage("アップロード処理でエラーが発生しました: " + e.message, true);
  } finally {
    $("#btn-upload").disabled = false;
    state.uploadAbortController = null;
  }
}

// ---------------- レジューム（再開）----------------

// retryPendingUploads()の多重実行防止フラグ。
// 補足：オンライン復帰イベント('online')は、電波の弱い場所で接続が数秒おきに
// 切断・再接続を繰り返す（いわゆる「フラップ」）と短時間に何度も発火することがある。
// 以前はこの関数に多重実行防止が無かったため、'online'が連続発火したり、
// ログイン直後の自動再開とオンライン復帰の自動再開がほぼ同時に走ったりすると、
// 同じ写真が複数の実行から並行してアップロードされ（Driveの再開可能セッションへの
// 同時書き込みで片方が失敗する等）、DB上のステータス更新にも競合が生じる。
// その結果、後から手動で「まとめて再試行」を押した際にも同じファイルがまだ
// 未完了に見えてしまい再度アップロードされ、結果として1回の「再開」のつもりが
// 完了通知メールが複数回送信される、という不具合につながっていた。
let autoResumeInProgress = false;

// オンライン復帰時・ログイン直後の自動再開用（モーダル表示なし、バックグラウンドで静かに再開する）
async function retryPendingUploads() {
  // 既にこの関数自体が実行中、または「まとめて再試行」等ユーザー操作による
  // アップロードが進行中の場合は多重実行しない（上記コメント参照）。
  if (autoResumeInProgress || state.uploadAbortController) return;
  autoResumeInProgress = true;
  try {
    const items = await DB.getResumableItems();
    for (const item of items) {
      if (!item.blob) continue; // Blobが失われている場合は再開不可（履歴上は失敗のまま）
      await uploadSingleItem(item);
    }
    if (items.length > 0) {
      await renderHistory();
    }
  } finally {
    autoResumeInProgress = false;
  }
}

// 履歴画面の「まとめて再試行」ボタン用。通常のアップロードと同じ進捗モーダル
// （全体／個別ファイルの進捗バー、中断ボタン）を表示しながら、
// 中断・待機中・失敗の未完了ファイルをすべて連続で再試行する。
async function retryAllUploads() {
  if (state.uploadAbortController || autoResumeInProgress) return; // 実行中の多重起動防止

  // ガード（state.uploadAbortController）は、この後にawaitが挟まる前、
  // ここで同期的に確保しておく。以前はDB.getResumableItems()のawaitの後に
  // セットしていたため、その待ち時間の間に本関数が連続して呼ばれると
  // ガードが効かずに複数回並行実行されてしまう隙があった（同じファイルの
  // 重複アップロードや完了通知メールの重複送信の原因になっていた）。
  state.uploadAbortController = new AbortController();

  const resumable = await DB.getResumableItems();
  const items = resumable.filter((i) => i.blob);
  const missingBlobCount = resumable.length - items.length;

  if (items.length === 0) {
    state.uploadAbortController = null;
    if (missingBlobCount > 0) {
      alert(
        "再試行対象のファイルデータが端末に残っていないため、自動では再開できません。お手数ですが、写真を選び直して再度アップロードしてください。"
      );
    }
    await renderHistory();
    return;
  }

  const notifyEnabled = !!CONFIG.NOTIFY_WEBAPP_URL;
  const totalFileCount = items.length;

  // まとめて再試行では、フォルダ準備・圧縮・採番は既に完了済みのファイルのみを対象にするため、
  // ステージは「本体アップロード・サムネイル準備・仕上げ」の3段階のみで重み付けする。
  const progress = {
    uploadedBytesByItem: new Map(),
    totalBytes: items.reduce((sum, i) => sum + i.totalBytes, 0),
    thumbsDone: false,
    finalizeDone: false,
  };
  const stages = [
    {
      weight: notifyEnabled ? 75 : 95,
      getFraction: () => {
        if (progress.totalBytes === 0) return 1;
        let sum = 0;
        for (const v of progress.uploadedBytesByItem.values()) sum += v;
        return sum / progress.totalBytes;
      },
    },
    { weight: notifyEnabled ? 20 : 0, getFraction: () => (progress.thumbsDone ? 1 : 0) },
    { weight: 5, getFraction: () => (progress.finalizeDone ? 1 : 0) },
  ];
  let completedFileCount = 0;
  function refreshOverallProgress() {
    let uploadedBytesSum = 0;
    for (const v of progress.uploadedBytesByItem.values()) uploadedBytesSum += v;
    setUploadOverallProgress(
      computeStageProgress(stages),
      completedFileCount,
      totalFileCount,
      uploadedBytesSum,
      progress.totalBytes
    );
  }

  let failedCount = 0;
  let successCount = 0;
  // 通知メールの「保存先リンク」「サムネイル画像」に使うため、完了したファイルを控えておく
  const completedItems = [];
  // 共有履歴（Drive上のupload-history.json）を再試行後の状態で更新するため、
  // 試行した（中断以外の）アイテムをここに集めておく。
  const attemptedResults = [];

  showUploadModalMessage("");
  setUploadModalMode("running");
  openUploadModal();
  const concurrency = Math.max(1, Math.min(CONFIG.UPLOAD_CONCURRENCY, items.length));
  setUploadStageMessage(
    totalFileCount > 1
      ? `未完了ファイルを再試行しています...（同時${concurrency}件ずつ処理）`
      : "未完了ファイルを再試行しています..."
  );
  renderUploadSlots(concurrency);
  refreshOverallProgress();

  try {
    const rawResults = await runUploadQueue(items, {
      concurrency: CONFIG.UPLOAD_CONCURRENCY,
      signal: state.uploadAbortController.signal,
      onItemStart: (slotIndex, idx, item) => {
        setSlotFile(slotIndex, item.fileName);
        progress.uploadedBytesByItem.set(item.id, item.uploadedBytes || 0);
        refreshOverallProgress();
      },
      onItemProgress: (slotIndex, idx, uploaded, total) => {
        setSlotProgress(slotIndex, uploaded, total);
        progress.uploadedBytesByItem.set(items[idx].id, uploaded);
        refreshOverallProgress();
      },
      onItemDone: (slotIndex, idx, result) => {
        const item = items[idx];
        progress.uploadedBytesByItem.set(item.id, item.totalBytes);
        attemptedResults.push({ item, result });
        if (result.status === "completed") {
          completedFileCount += 1;
          successCount++;
          completedItems.push({ item, driveFileId: result.driveFileId });
        } else if (result.status !== "cancelled") {
          failedCount++;
        }
        refreshOverallProgress();
      },
    });

    const cancelledMidway = state.uploadAbortController.signal.aborted;
    void rawResults; // 個々の結果はonItemDone側で集計済み（ここでは中断有無だけ見る）

    // 再試行後の最新ステータスを共有履歴（Drive上のupload-history.json）にも反映する。
    // 履歴画面は共有履歴側もこのアップロード実行（batchId）単位でまとめて表示するため、
    // ここで反映しておかないと、他端末から見た共有履歴がいつまでも「中断あり」等の
    // 古い状態のまま更新されない。
    const historyRecords = attemptedResults
      .filter(({ result }) => result.status !== "cancelled")
      .map(({ item, result }) => ({
        id: item.id,
        batchId: item.batchId,
        folderId: item.folderId,
        customer: item.customer,
        site: item.site,
        yearMonth: item.yearMonth,
        fileName: item.fileName,
        status: result.status,
        startedAt: item.createdAt,
        completedAt: result.status === "completed" ? new Date().toISOString() : null,
        sizeBytes: item.totalBytes,
        driveFileId: result.driveFileId || item.driveFileId || null,
        device: item.device,
        thumbnailDataUrl: item.thumbnailDataUrl || null,
      }));
    if (historyRecords.length > 0) {
      try {
        await Drive.appendHistoryRecords(historyRecords);
      } catch (e) {
        console.warn("共有履歴ファイルへの反映に失敗しました（端末ローカル履歴には記録済み）", e);
      }
    }

    // 通知メールは、このretryAllUploads呼び出しでまとめて再試行した分だけでなく、
    // 元のアップロード実行（batchId）単位で「そのアップロード実行で指定した全体」の
    // 件数・サムネイルを反映して送る。以前は「まとめて再試行」用の集約1通のみを
    // 送っており、件数・サムネイルが今回retryした分だけになってしまっていた
    // （中断前に完了済みだった分が抜け落ちていた）。
    // 中断の場合はstartUpload()同様、サムネイル準備・メール送信自体をスキップする。
    if (notifyEnabled && !cancelledMidway) {
      setUploadStageMessage("通知メール用の画像を準備しています...");

      // 今回実際に処理した（onItemDoneが呼ばれた）アイテムが属するアップロード実行単位。
      const batchKeysInvolved = Array.from(
        new Set(attemptedResults.map(({ item }) => batchKeyOf(item)))
      );
      // 件数・サムネイルを「そのアップロード実行で指定した全体」で計算するため、
      // 今回の再試行対象に限らず端末内の全アイテム（軽量なメタデータのみ）を取得する。
      const allLocalItems = await DB.getAllUploadItems();

      for (const batchKey of batchKeysInvolved) {
        const batchItems = allLocalItems.filter((i) => batchKeyOf(i) === batchKey);
        if (batchItems.length === 0) continue;

        const totalInBatch = batchItems.length;
        const completedInBatch = batchItems.filter((i) => i.status === "completed").length;
        const activeInBatch = batchItems.some(
          (i) => i.status === "paused" || i.status === "uploading"
        );
        let batchEvent;
        if (completedInBatch === totalInBatch) {
          batchEvent = "completed";
        } else if (activeInBatch) {
          batchEvent = "cancelled";
        } else {
          batchEvent = "partial_failed";
        }

        // このアップロード実行で完了した写真すべてのサムネイルを集める。
        // 今回のretryで実際にアップロードし終えたファイルはメモリ上のBlobから生成し、
        // それ以前から完了済みだったファイルは既にBlobが破棄済みのため、履歴表示用に
        // 保存してある小さなthumbnailDataUrlを転用する（その分、画質は低くなる）。
        const thumbEntries = [];
        for (const rec of batchItems) {
          if (rec.status !== "completed") continue;
          if (thumbEntries.length >= CONFIG.NOTIFY_MAX_INLINE_PHOTOS) break;
          const justCompleted = completedItems.find(({ item }) => item.id === rec.id);
          if (justCompleted) {
            try {
              const thumbBlob = await Compress.makeEmailThumbnailFromBlob(justCompleted.item.blob);
              thumbEntries.push({ id: rec.id, blob: thumbBlob });
              continue;
            } catch (e) {
              console.warn(
                "通知メール用サムネイルの生成に失敗しました（本体のアップロードには影響ありません）",
                e
              );
            }
          }
          if (rec.thumbnailDataUrl) {
            try {
              thumbEntries.push({ id: rec.id, blob: dataUrlToBlob(rec.thumbnailDataUrl) });
            } catch (e) {
              console.warn("通知メール用サムネイル（履歴データからの転用）の生成に失敗しました", e);
            }
          }
        }
        const photoFileIds = await uploadNotifyThumbnails(thumbEntries);

        const first = batchItems[0];
        const profile = getUserProfile();
        Notify.sendUploadNotification({
          event: batchEvent,
          customer: first.customer,
          site: first.site,
          yearMonth: formatYearMonth(first.yearMonth),
          uploaderName: profile.name || "",
          uploaderEmail: profile.email || "",
          successCount: completedInBatch,
          totalCount: totalInBatch,
          timestamp: new Date().toISOString(),
          folderUrl: first.folderId ? buildDriveFolderUrl(first.folderId) : "",
          photoFileIdsJson: JSON.stringify(photoFileIds),
          photoCount: completedInBatch,
        });
      }
    }
    progress.thumbsDone = true;
    progress.finalizeDone = true;
    refreshOverallProgress();

    setUploadModalMode(cancelledMidway ? "cancelled" : "done");
    setUploadStageMessage("");
    if (cancelledMidway) {
      showUploadModalMessage(
        "再試行を中断しました。未完了分は履歴画面からまとめて再試行できます。",
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
  } catch (e) {
    setUploadModalMode("done");
    setUploadStageMessage("");
    showUploadModalMessage("再試行処理でエラーが発生しました: " + e.message, true);
  } finally {
    state.uploadAbortController = null;
    // 中断・完了いずれの場合も、履歴画面の表示を必ず最新状態に更新する
    // （以前はここが漏れており、タブを切り替えるまで完了状態に見えない不具合があった）
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

// isoString（createdAt等）が「今日」の日付かどうか（端末のローカル日付で判定）
function isToday(isoString) {
  if (!isoString) return false;
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

// isoStringが現在から指定日数以内かどうか
function isWithinDays(isoString, days) {
  if (!isoString) return false;
  const t = new Date(isoString).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= days * 24 * 60 * 60 * 1000;
}

// 履歴レコードの代表時刻（完了していれば完了日時、していなければ開始日時）
function recordTimestamp(rec) {
  return rec.completedAt || rec.startedAt || rec.createdAt;
}

// 小さなサムネイル表示用のHTML（サムネイルが無い場合はプレースホルダー枠のみ）
function thumbHtml(dataUrl) {
  if (dataUrl) {
    return `<img class="thumb" src="${dataUrl}" alt="" />`;
  }
  return `<div class="thumb thumb-placeholder"></div>`;
}

// "yyyy/mm/dd hh:mm" 形式で日時を表示する（履歴画面の「作業日時」表示用）
function formatDateTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 同一アップロード実行内のファイル名は連番以外同じになるため、
// 「202607_A社_B現場_005.jpg ～ 008.jpg」のように連番の範囲だけを示す形に短縮する。
// 命名規則が揃っていない場合（想定外のデータ）は件数表示にフォールバックする。
function summarizeFileNames(fileNames) {
  if (fileNames.length === 0) return "";
  if (fileNames.length === 1) return fileNames[0];
  const re = /^(.*_)(\d{3})\.([^.]+)$/;
  const first = fileNames[0].match(re);
  if (
    first &&
    fileNames.every((n) => {
      const m = n.match(re);
      return m && m[1] === first[1] && m[3] === first[3];
    })
  ) {
    const digits = first[2].length;
    const nums = fileNames.map((n) => parseInt(n.match(re)[2], 10));
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const prefix = first[1];
    const ext = first[3];
    return `${prefix}${String(min).padStart(digits, "0")}.${ext} ～ ${String(max).padStart(digits, "0")}.${ext}`;
  }
  return `${fileNames.length}件のファイル`;
}

// レコード（DBのuploadsアイテム、または共有履歴JSONの1件）から、
// そのアイテムが属するアップロード実行（batchId）の代表的な開始時刻を取り出す。
// 共有履歴レコードはstartedAt、ローカルDBアイテムはcreatedAtに開始時刻が入っている。
function batchRecordTimestamp(rec) {
  return rec.createdAt || rec.startedAt || rec.completedAt || "";
}

// レコード/アイテムが属するアップロード実行（batchId）のグループ化キー。
// batchIdを持たない古いデータ（この機能追加前に記録されたもの）は、
// 1件ずつ単独のグループとして扱う。履歴表示のグループ化と、通知メールを
// アップロード実行単位で送るための集計の両方で共通して使う。
function batchKeyOf(rec) {
  return rec.batchId || "single:" + rec.id;
}

// アイテム/レコードの配列を、同じアップロード実行（batchId）ごとにグループ化して
// 表示用のサマリーオブジェクトへ変換する。batchIdを持たない古いデータ（この機能追加前に
// 記録されたもの）は、1件ずつ単独のグループとして扱う（従来通り1行ずつ表示される）。
function groupRecordsIntoBatches(records) {
  const groups = new Map();
  records.forEach((rec) => {
    const key = batchKeyOf(rec);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  });

  const batches = Array.from(groups.values()).map((recs) => {
    const sorted = recs.slice().sort((a, b) => (batchRecordTimestamp(a) < batchRecordTimestamp(b) ? -1 : 1));
    const first = sorted[0];
    const timestamp = batchRecordTimestamp(first);

    const total = recs.length;
    const completedCount = recs.filter((r) => r.status === "completed").length;
    const activeCount = recs.filter((r) => r.status === "paused" || r.status === "uploading").length;
    const pendingCount = recs.filter((r) => r.status === "pending").length;
    const failedCount = recs.filter((r) => r.status === "failed").length;

    let statusKey;
    let statusLabelText;
    if (completedCount === total) {
      statusKey = "completed";
      statusLabelText = "完了";
    } else if (activeCount > 0) {
      statusKey = "paused";
      statusLabelText = `中断あり (${completedCount}/${total}件完了)`;
    } else if (pendingCount > 0) {
      statusKey = "pending";
      statusLabelText = `待機中 (${completedCount}/${total}件完了)`;
    } else if (failedCount > 0) {
      statusKey = "failed";
      statusLabelText = `失敗あり (${completedCount}/${total}件完了)`;
    } else {
      statusKey = "completed";
      statusLabelText = "完了";
    }

    const folderRec = recs.find((r) => r.folderId);

    return {
      customer: first.customer,
      site: first.site,
      yearMonth: first.yearMonth,
      device: first.device,
      timestamp,
      statusKey,
      statusLabelText,
      folderId: folderRec ? folderRec.folderId : null,
      fileNameSummary: summarizeFileNames(recs.map((r) => r.fileName).filter(Boolean)),
      thumbnails: recs.map((r) => r.thumbnailDataUrl || null),
    };
  });

  // 新しい実行が上に来るように、代表時刻の降順で並べる
  batches.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return batches;
}

// グループ化済みのバッチ1件分の履歴行DOMを組み立てる
function renderBatchRow(batch) {
  const row = document.createElement("div");
  row.className = "history-row status-" + batch.statusKey;
  const thumbsHtml = batch.thumbnails.map((t) => thumbHtml(t)).join("");
  const folderLinkHtml = batch.folderId
    ? `<a class="history-batch-link" href="${buildDriveFolderUrl(batch.folderId)}" target="_blank" rel="noopener">保存先フォルダを開く</a>`
    : "";
  row.innerHTML = `
    <div class="history-main">
      <strong>${escapeHtml(batch.customer)} / ${escapeHtml(batch.site)} / ${formatYearMonth(batch.yearMonth)}</strong>
      <span class="badge">${escapeHtml(batch.statusLabelText)}</span>
    </div>
    <div class="history-sub">${formatDateTime(batch.timestamp)}　${escapeHtml(batch.device || "")}</div>
    <div class="history-batch-thumbs">${thumbsHtml}</div>
    <div class="history-batch-filenames">${escapeHtml(batch.fileNameSummary)}</div>
    ${folderLinkHtml}
  `;
  return row;
}

async function renderHistory() {
  const allLocalItems = await DB.getAllUploadItems();
  const todayItems = allLocalItems.filter((item) => isToday(item.createdAt));

  const localEl = $("#local-history-list");
  localEl.innerHTML = "";
  const localBatches = groupRecordsIntoBatches(todayItems);
  if (localBatches.length === 0) {
    localEl.innerHTML = "<p>本日の履歴はまだありません。</p>";
  }
  localBatches.forEach((batch) => {
    localEl.appendChild(renderBatchRow(batch));
  });

  // 中断時、実際にアップロード中だった1件は"paused"になるが、
  // まだ順番が来ていなかった（中断でループが止まった）残りの分は"pending"のまま
  // 履歴に残る。ファイルごとに個別の再試行ボタンを出すと複数残った際に
  // 1つずつ押す必要があり手間なので、"completed"以外が1件でもあれば
  // まとめて全数を再試行できるボタンを1つだけ表示する。
  // なお、未完了件数は「本日」の表示絞り込みに関わらず、全期間を対象にする
  // （日をまたいだ未完了ファイルも取りこぼさず再試行できるようにするため）。
  const resumableCount = allLocalItems.filter((i) => i.status !== "completed").length;
  const retryAllBtn = $("#btn-retry-all");
  if (resumableCount > 0) {
    retryAllBtn.textContent = `未完了の${resumableCount}件をまとめて再試行`;
    retryAllBtn.classList.remove("hidden");
    retryAllBtn.disabled = false;
  } else {
    retryAllBtn.classList.add("hidden");
  }

  const sharedEl = $("#shared-history-list");
  sharedEl.innerHTML = "読み込み中...";
  try {
    const shared = await Drive.loadHistory();
    const recentShared = shared.filter((rec) => isWithinDays(recordTimestamp(rec), CONFIG.SHARED_HISTORY_DAYS));
    sharedEl.innerHTML = "";
    const sharedBatches = groupRecordsIntoBatches(recentShared);
    if (sharedBatches.length === 0) {
      sharedEl.innerHTML = "<p>直近1週間の共有履歴はありません。</p>";
    }
    sharedBatches.forEach((batch) => {
      sharedEl.appendChild(renderBatchRow(batch));
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

      // 初回起動などで氏名・メールアドレスが未設定の場合は、設定画面を自動で開いて入力を促す。
      const profile = getUserProfile();
      if (!profile.name && !profile.email) {
        openSettingsSheet();
      }
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
    updateUploadButtonState();
  });

  $("#select-site").addEventListener("change", (e) => {
    if (e.target.value === NEW_VALUE) {
      openModal("site");
      e.target.value = state.selectedSiteId || "";
      return;
    }
    state.selectedSiteId = e.target.value;
    updateUploadButtonState();
  });

  $("#select-yearmonth").addEventListener("change", (e) => {
    if (e.target.value === NEW_VALUE) {
      openModal("yearMonth");
      e.target.value = state.selectedYearMonth || "";
      return;
    }
    state.selectedYearMonth = e.target.value;
    updateUploadButtonState();
  });

  $("#modal-confirm").addEventListener("click", confirmModal);
  $("#modal-cancel").addEventListener("click", closeModal);

  $("#file-input").addEventListener("change", (e) => {
    state.selectedFiles = Array.from(e.target.files || []);
    updateSelectedFilesInfo();
    updateUploadButtonState();
  });

  $("#btn-upload").addEventListener("click", startUpload);

  $("#btn-upload-cancel").addEventListener("click", () => {
    if (state.uploadAbortController) {
      state.uploadAbortController.abort();
    }
    $("#btn-upload-cancel").disabled = true;
  });

  $("#btn-upload-close").addEventListener("click", async () => {
    closeUploadModal();
    await resetSelectionForNextUpload();
  });

  $("#btn-retry-all").addEventListener("click", () => {
    $("#btn-retry-all").disabled = true;
    retryAllUploads();
  });

  $("#btn-settings").addEventListener("click", () => {
    openSettingsSheet();
  });
  $("#btn-settings-close").addEventListener("click", () => {
    $("#screen-settings").classList.remove("open");
  });

  $("#btn-profile-save").addEventListener("click", () => {
    const name = $("#profile-name-input").value.trim();
    const email = $("#profile-email-input").value.trim();
    setUserProfile({ name, email });
    const msgEl = $("#profile-save-message");
    msgEl.textContent = "保存しました。";
    msgEl.classList.remove("hidden");
    setTimeout(() => {
      msgEl.classList.add("hidden");
    }, 2000);
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

  updateUploadButtonState();

  // 補足：Google Identity Services（OAuthトークンモデル）は仕様上、
  // ユーザー操作（クリック等のジェスチャー）を伴わないトークン取得を認めていない。
  // そのため起動直後の完全自動ログインは実現できず、毎回「ログイン」ボタンの
  // タップは必要になる。ただし signIn() 側でまずサイレント取得を試みるため、
  // 有効なセッション・許可が残っていればタップ後に同意画面を経由せず即座に進める。
  showScreen("login");
}

document.addEventListener("DOMContentLoaded", init);
