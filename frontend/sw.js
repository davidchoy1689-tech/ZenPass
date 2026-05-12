// Push notification support
self.addEventListener("push", function (e) {
  var data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch (e) {}
  self.registration.showNotification(data.title || "ZenPass 禪流", {
    body: data.body || "你有新的課程提醒！",
    icon: "/favicon.png",
    badge: "/favicon.png",
    data: { url: data.url || "/" },
  });
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url =
    e.notification.data && e.notification.data.url
      ? e.notification.data.url
      : "/";
  clients.openWindow(url);
});

/* ZenPass Service Worker — v3 (pre-cache + offline) */
const CACHE = "zenpass-v3";
const PRECACHE = [
  "/",
  "/index.html",
  "/api.js",
  "/courses.html",
  "/explore.html",
  "/class-detail.html",
  "/my.html",
  "/my-bookings.html",
  "/membership.html",
  "/login.html",
  "/badges.html",
  "/points.html",
  "/favicon.png",
  "/manifest.json"
];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(PRECACHE);
    })
  );
});

self.addEventListener("activate", function (e) {
  // Clean up old caches
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) {
            return k !== CACHE;
          })
          .map(function (k) {
            return caches.delete(k);
          }),
      );
    }),
  );
});

self.addEventListener("fetch", function (e) {
  // Only cache same-origin GET requests
  if (
    e.request.method !== "GET" ||
    !e.request.url.startsWith(location.origin)
  ) {
    return;
  }
  // Skip API calls
  if (e.request.url.includes("/api/")) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return (
        cached ||
        fetch(e.request)
          .then(function (response) {
            return caches.open(CACHE).then(function (cache) {
              if (response.ok) cache.put(e.request, response.clone());
              return response;
            });
          })
          .catch(function () {
            // Offline: return a minimal fallback
            return new Response(
              "<html><body style='text-align:center;padding:2rem;font-family:sans-serif'><h1>📡</h1><h2>離線中</h2><p>請連線後重新整理</p></body></html>",
              {
                status: 200,
                statusText: "OK",
                headers: { "Content-Type": "text/html;charset=UTF-8" }
              }
            );
          })
      );
    }),
  );
});
