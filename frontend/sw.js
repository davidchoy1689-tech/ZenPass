

// Push notification support
self.addEventListener("push", function(e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch(e) {}
  self.registration.showNotification(data.title || "ZenPass 禪流", {
    body: data.body || "你有新的課程提醒！",
    icon: "/favicon.png",
    badge: "/favicon.png",
    data: { url: data.url || "/" }
  });
});

self.addEventListener("notificationclick", function(e) {
  e.notification.close();
  var url = e.notification.data && e.notification.data.url ? e.notification.data.url : "/";
  clients.openWindow(url);
});

/* ZenPass Service Worker — v2 (auto-path) */
const CACHE = 'zenpass-v2';

self.addEventListener('install', function(e) {
  self.skipWaiting();
  // Minimal install - cache will be populated on first visit
});

self.addEventListener('activate', function(e) {
  // Clean up old caches
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
          .map(function(k) { return caches.delete(k); })
      );
    })
  );
});

self.addEventListener('fetch', function(e) {
  // Only cache same-origin GET requests
  if (e.request.method !== 'GET' || !e.request.url.startsWith(location.origin)) {
    return;
  }
  // Skip API calls
  if (e.request.url.includes('/api/')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).then(function(response) {
        return caches.open(CACHE).then(function(cache) {
          if (response.ok) cache.put(e.request, response.clone());
          return response;
        });
      });
    })
  );
});
