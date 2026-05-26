// ZenPass — Service Worker (退役)
// Service Worker 曾經用嚟 cache 頁面，但令到更新唔識 refresh
// 而家只係 self-unregister，所有請求直接去 server
self.addEventListener("install", function () {
  self.skipWaiting();
});
self.addEventListener("activate", function (e) {
  self.registration.unregister();
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return caches.delete(k); }));
    })
  );
});
self.addEventListener("fetch", function (e) {
  e.respondWith(fetch(e.request));
});
