/* ZenPass v2 Service Worker — app shell (v3)
 * 導航：network-first（離線 fallback 去 app shell）
 * 靜態資源：cache-first
 * /api/：永不快取（確保資料即時）
 */
const CACHE = "zenpass-v2-shell-v4";
const ASSETS = [
  "/",
  "/index.html",
  "/explore.html",
  "/offline.html",
  "/assets/v2.css",
  "/assets/api.js",
  "/assets/holidays.js",
  "/assets/sport-icons.js",
  "/manifest.json",
  "/icons/icon-96.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-192-maskable.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon-180.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // 永不快取 API

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() =>
        caches.match(req).then((r) => r || caches.match("/offline.html")),
      ),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (r) =>
        r ||
        fetch(req)
          .then((res) => {
            if (res && res.ok && res.type === "basic") {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => r),
    ),
  );
});
