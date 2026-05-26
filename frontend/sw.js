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

/* ZenPass Service Worker — v4 (enhanced cache strategy) */
const CACHE_STATIC = "zenpass-static-v5";
const CACHE_PAGES = "zenpass-pages-v5";

// Static assets: cache-first (rarely change)
const STATIC_ASSETS = [
  "/css/zenpass.css",
  "/api.js",
  "/favicon.png",
  "/manifest.json",
  "/sw.js",
];

// Pages: network-first (always try to get latest, fallback to cache)
const PAGES = [
  "/",
  "/index.html",
  "/explore.html",
  "/class-detail.html",
  "/my.html",
  "/my-bookings.html",
  "/membership.html",
  "/login.html",
  "/badges.html",
  "/points.html",
  "/coaches.html",
  "/faq.html",
  "/notifications.html",
  "/onboarding.html",
  "/share.html",
  "/waiver.html",
  "/payment.html",
  "/admin.html",
  "/checkin.html",
];

// Offline HTML fallback
const OFFLINE_PAGE = `<!doctype html>
<html lang="zh-HK"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>離線中 — ZenPass</title><style>
body{font-family:"Noto Sans TC",sans-serif;text-align:center;padding:3rem 1rem;background:#f8f9fa;color:#1a1a2e}
h1{font-size:48px;margin-bottom:8px}h2{font-size:20px;margin-bottom:4px}p{font-size:14px;color:#666;margin-bottom:20px}
button{padding:12px 32px;border:none;border-radius:24px;font-size:15px;font-weight:600;cursor:pointer;
background:#ff6b35;color:white;font-family:inherit}
</style></head><body>
<h1>📡</h1><h2>你目前離線中</h2><p>請檢查網絡連線後重新整理頁面</p>
<button onclick="location.reload()">🔄 重新整理</button>
</body></html>`;

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_STATIC).then(function (cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  // Also pre-cache pages in background
  e.waitUntil(
    caches.open(CACHE_PAGES).then(function (cache) {
      return Promise.allSettled(
        PAGES.map(function (url) {
          return fetch(url, { cache: "no-cache" })
            .then(function (r) {
              if (r.ok) cache.put(url, r);
            })
            .catch(function () {});
        })
      );
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) {
            return k !== CACHE_STATIC && k !== CACHE_PAGES;
          })
          .map(function (k) {
            return caches.delete(k);
          })
      );
    })
  );
  // Cache offline page
  e.waitUntil(
    caches.open(CACHE_PAGES).then(function (cache) {
      cache.put("/offline", new Response(OFFLINE_PAGE, {
        status: 200,
        headers: { "Content-Type": "text/html;charset=UTF-8" },
      }));
    })
  );
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;

  // Skip non-origin requests
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // Skip API calls
  if (url.pathname.startsWith("/api/")) return;

  // Determine asset type
  var isPage = url.pathname === "/" || url.pathname.endsWith(".html");
  var isStatic =
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".ico") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".json");

  if (isStatic) {
    // Cache-first for static assets
    e.respondWith(
      caches.match(e.request).then(function (cached) {
        return (
          cached ||
          fetch(e.request).then(function (response) {
            if (response.ok) {
              return caches
                .open(CACHE_STATIC)
                .then(function (cache) {
                  cache.put(e.request, response.clone());
                  return response;
                });
            }
            return response;
          })
        );
      })
    );
  } else if (isPage) {
    // Network-first for HTML pages, fallback to cache then offline
    e.respondWith(
      fetch(e.request)
        .then(function (response) {
          if (response.ok) {
            var cloned = response.clone();
            caches.open(CACHE_PAGES).then(function (cache) {
              cache.put(e.request, cloned);
            });
          }
          return response;
        })
        .catch(function () {
          return caches.match(e.request).then(function (cached) {
            return cached || caches.match("/offline");
          });
        })
    );
  }
  // Default: network-only for other requests
});
