/* ZenPass Service Worker — v7 (full file sync)
 * Cache-first for static assets, network-first for pages
 * Install event pre-caches critical assets
 */

const CACHE_STATIC = "zenpass-static-v7";
const CACHE_PAGES = "zenpass-pages-v7";
const CACHE_DYNAMIC = "zenpass-dynamic-v7";
const CACHE_IMAGES = "zenpass-images-v7";

const STATIC_ASSETS = [
  "/css/zenpass.css",
  "/api.js",
  "/favicon.png",
  "/manifest.json",
  "/sw.js",
];

const PAGES = [
  "/",
  "/index.html",
  "/login.html",
  "/explore.html",
  "/courses.html",
  "/class-detail.html",
  "/coaches.html",
  "/about.html",
  "/faq.html",
  "/privacy.html",
  "/terms.html",
  "/membership.html",
  "/wallet.html",
  "/my-bookings.html",
  "/notifications.html",
];

// Install: pre-cache critical static assets
self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_STATIC).then(function (cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", function (e) {
  const cacheWhitelist = [
    CACHE_STATIC,
    CACHE_PAGES,
    CACHE_DYNAMIC,
    CACHE_IMAGES,
  ];
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names
          .filter(function (name) {
            return !cacheWhitelist.includes(name);
          })
          .map(function (name) {
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// Fetch: Stale-while-revalidate for most things
self.addEventListener("fetch", function (e) {
  const url = new URL(e.request.url);

  // API calls — network only
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Static assets — cache first
  if (STATIC_ASSETS.includes(url.pathname)) {
    e.respondWith(cacheFirst(e.request, CACHE_STATIC));
    return;
  }

  // Images — cache first
  if (
    url.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|webp)$/)
  ) {
    e.respondWith(cacheFirst(e.request, CACHE_IMAGES));
    return;
  }

  // Pages — network first, fallback to cache
  e.respondWith(networkFirst(e.request, CACHE_PAGES));
});

function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (match) {
      if (match) {
        // Update cache in background
        fetch(request).then(function (response) {
          if (response.ok) cache.put(request, response);
        }).catch(function () {});
        return match;
      }
      return fetch(request).then(function (response) {
        if (response.ok) cache.put(request, response.clone());
        return response;
      }).catch(function () {
        return new Response("Offline", { status: 503 });
      });
    });
  });
}

function networkFirst(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return fetch(request).then(function (response) {
      if (response.ok) cache.put(request, response.clone());
      return response;
    }).catch(function () {
      return cache.match(request).then(function (match) {
        return match || new Response("Offline", { status: 503 });
      });
    });
  });
}

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
