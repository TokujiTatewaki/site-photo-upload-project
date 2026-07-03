// ============================================================
// Service Worker
// アプリ本体（HTML/CSS/JS）のみオフラインキャッシュ対象とする。
// Google APIへの通信（認証・Drive API）はキャッシュせず、常にネットワークへ素通しする。
// ============================================================
const CACHE_NAME = "site-photo-upload-cache-v1";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/config.js",
  "./js/db.js",
  "./js/auth.js",
  "./js/drive.js",
  "./js/compress.js",
  "./js/main.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 同一オリジン（アプリ本体）以外（Google API等）はキャッシュせずそのまま通す
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => cached);
    })
  );
});
