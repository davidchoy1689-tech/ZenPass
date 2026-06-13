// ZenPass 禪流 — Service Worker (Push Notifications)
// 管理瀏覽器推送通知，即使用戶不在網站上都能收到通知

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', function(event) {
  var data = {};
  try {
    data = event.data.json();
  } catch(e) {
    data = { title: 'ZenPass', body: event.data.text() };
  }

  var options = {
    body: data.body || '',
    icon: data.icon || '/favicon.png',
    badge: '/favicon.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/my.html'
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'ZenPass 禪流', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = event.notification.data?.url || '/my.html';
  event.waitUntil(
    clients.openWindow(url)
  );
});
