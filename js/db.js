// ============================================================
// IndexedDB ラッパー
// - uploads: アップロードキュー兼ローカル履歴（写真Blob、進捗、ステータスを保持）
// - masterCache: マスタデータ（顧客名/施工現場/施工年月）のローカルキャッシュ
// ============================================================
const DB_NAME = "site-photo-upload-db";
const DB_VERSION = 1;
const STORE_UPLOADS = "uploads";
const STORE_MASTER = "masterCache";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_UPLOADS)) {
        const store = db.createObjectStore(STORE_UPLOADS, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MASTER)) {
        db.createObjectStore(STORE_MASTER, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
function getDB() {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}

function tx(storeName, mode) {
  return getDB().then(
    (db) => db.transaction(storeName, mode).objectStore(storeName)
  );
}

const DB = {
  // ---- uploads ----
  async addUploadItem(item) {
    const store = await tx(STORE_UPLOADS, "readwrite");
    return new Promise((resolve, reject) => {
      const req = store.add(item);
      req.onsuccess = () => resolve(item);
      req.onerror = () => reject(req.error);
    });
  },

  async updateUploadItem(id, changes) {
    const store = await tx(STORE_UPLOADS, "readwrite");
    return new Promise((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        if (!existing) {
          reject(new Error("update対象のアップロード項目が見つかりません: " + id));
          return;
        }
        const updated = Object.assign({}, existing, changes, {
          updatedAt: new Date().toISOString(),
        });
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve(updated);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  },

  async getUploadItem(id) {
    const store = await tx(STORE_UPLOADS, "readonly");
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async getAllUploadItems() {
    const store = await tx(STORE_UPLOADS, "readonly");
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getResumableItems() {
    const items = await DB.getAllUploadItems();
    return items.filter(
      (i) => i.status === "pending" || i.status === "uploading" || i.status === "paused" || i.status === "failed"
    );
  },

  // 完了後、容量節約のためBlob本体は破棄しメタデータのみ残す
  async dropBlob(id) {
    return DB.updateUploadItem(id, { blob: null });
  },

  // ---- master cache ----
  async getMasterCache() {
    const store = await tx(STORE_MASTER, "readonly");
    return new Promise((resolve, reject) => {
      const req = store.get("latest");
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => reject(req.error);
    });
  },

  async setMasterCache(data) {
    const store = await tx(STORE_MASTER, "readwrite");
    return new Promise((resolve, reject) => {
      const req = store.put({ key: "latest", data, updatedAt: new Date().toISOString() });
      req.onsuccess = () => resolve(data);
      req.onerror = () => reject(req.error);
    });
  },
};

window.DB = DB;
