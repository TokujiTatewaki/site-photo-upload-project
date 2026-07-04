// ============================================================
// IndexedDB ラッパー
// - uploads: アップロードキュー兼ローカル履歴のメタデータ（写真Blobは含まない）
// - uploadBlobs: 写真Blob本体（uploadsとは別ストアに分離）
// - masterCache: マスタデータ（顧客名/施工現場/施工年月）のローカルキャッシュ
//
// 補足：以前はuploadsストアの1レコードにBlobも一緒に保存していたが、
// 「IndexedDBから取り出したBlobを、進捗更新のたびに同じレコードへ
// 再度put()し直す」実装だったため、iOS Safari特有の
// "Error preparing Blob/File data to be stored in object store" という
// 不具合（IndexedDBから読み出したBlobの再保存に失敗する既知の挙動）を誘発し、
// 中断からの再試行時に画面が無反応になったりエラーになったりする原因となっていた。
// Blobを別ストアに分離し、Blobは追加時に一度だけ書き込み、以降は読み出し専用にすることで
// この再保存（roundtrip）を無くし、不具合を回避する。
// ============================================================
const DB_NAME = "site-photo-upload-db";
const DB_VERSION = 2;
const STORE_UPLOADS = "uploads";
const STORE_BLOBS = "uploadBlobs";
const STORE_MASTER = "masterCache";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      const upgradeTx = event.target.transaction;

      let uploadsStore;
      if (!db.objectStoreNames.contains(STORE_UPLOADS)) {
        uploadsStore = db.createObjectStore(STORE_UPLOADS, { keyPath: "id" });
        uploadsStore.createIndex("status", "status", { unique: false });
        uploadsStore.createIndex("createdAt", "createdAt", { unique: false });
      } else {
        uploadsStore = upgradeTx.objectStore(STORE_UPLOADS);
      }

      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(STORE_MASTER)) {
        db.createObjectStore(STORE_MASTER, { keyPath: "key" });
      }

      // v1（旧バージョン）ではuploadsレコードにBlobを直接保存していたため、
      // 新設のuploadBlobsストアへ移行し、uploadsレコードからはBlobを取り除く。
      if (event.oldVersion < 2) {
        const blobsStore = upgradeTx.objectStore(STORE_BLOBS);
        const cursorReq = uploadsStore.openCursor();
        cursorReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          const record = cursor.value;
          if (record.blob) {
            blobsStore.put({ id: record.id, blob: record.blob });
            const rest = Object.assign({}, record);
            delete rest.blob;
            cursor.update(rest);
          }
          cursor.continue();
        };
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
  // ---- uploads（メタデータ） ----
  async addUploadItem(item) {
    const rest = Object.assign({}, item);
    const blob = rest.blob;
    delete rest.blob;

    const metaStore = await tx(STORE_UPLOADS, "readwrite");
    await new Promise((resolve, reject) => {
      const req = metaStore.add(rest);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    if (blob) {
      const blobStore = await tx(STORE_BLOBS, "readwrite");
      await new Promise((resolve, reject) => {
        const req = blobStore.put({ id: item.id, blob });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
    return item;
  },

  // 注意：changesにblobを含めないこと（Blobは別ストアで管理し、ここでは触らない）
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

  async getUploadItemBlob(id) {
    const store = await tx(STORE_BLOBS, "readonly");
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => reject(req.error);
    });
  },

  async getUploadItem(id) {
    const store = await tx(STORE_UPLOADS, "readonly");
    const meta = await new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    if (!meta) return null;
    const blob = await DB.getUploadItemBlob(id);
    return Object.assign({}, meta, { blob });
  },

  // 履歴一覧表示用。表示にBlobは不要なため、メタデータのみ返す（軽量化のため）
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

  // 再試行用。実際にアップロードし直すためBlobが必要なので、ここでのみ付与する
  async getResumableItems() {
    const all = await DB.getAllUploadItems();
    const resumable = all.filter(
      (i) => i.status === "pending" || i.status === "uploading" || i.status === "paused" || i.status === "failed"
    );
    return Promise.all(
      resumable.map(async (item) => {
        const blob = await DB.getUploadItemBlob(item.id);
        return Object.assign({}, item, { blob });
      })
    );
  },

  // 完了後、容量節約のためBlob本体を削除する（uploadBlobsストアからのみ削除。メタデータには触れない）
  async dropBlob(id) {
    const store = await tx(STORE_BLOBS, "readwrite");
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
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
