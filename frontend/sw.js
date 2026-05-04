/* ZenPass Service Worker — v1.0 */
const CACHE = 'zenpass-v1';
const PRECACHE = [
    '/ZenPass/',
    '/ZenPass/index.html',
    '/ZenPass/explore.html',
    '/ZenPass/class-detail.html',
    '/ZenPass/membership.html',
    '/ZenPass/my.html',
    '/ZenPass/my-bookings.html',
    '/ZenPass/my-membership.html',
    '/ZenPass/payment.html',
    '/ZenPass/coach-dashboard.html',
    '/ZenPass/coach-apply.html',
    '/ZenPass/checkin.html',
    '/ZenPass/register-coach.html',
    '/ZenPass/buy-credits.html',
    '/ZenPass/demo-setup.html',
    '/ZenPass/auto-login.html',
    '/ZenPass/add-demo-class.html',
    '/ZenPass/admin.html',
    '/ZenPass/rate.html',
    '/ZenPass/api.js',
    '/ZenPass/courses.json',
    '/ZenPass/manifest.json',
    '/ZenPass/icons/icon-192.png',
    '/ZenPass/icons/icon-512.png',
    '/ZenPass/assets/payme-qr.jpg',
    '/ZenPass/assets/fps-qr.png'
];

self.addEventListener('install', function(e) {
    e.waitUntil(
        caches.open(CACHE).then(function(cache) {
            return cache.addAll(PRECACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', function(e) {
    e.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(
                keys.filter(function(k) { return k !== CACHE; })
                    .map(function(k) { return caches.delete(k); })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', function(e) {
    // Network-first for dynamic content, cache-first for static
    var url = e.request.url;

    // For courses.json — network first, fallback to cache
    if (url.indexOf('courses.json') > -1) {
        e.respondWith(
            fetch(e.request).then(function(resp) {
                return caches.open(CACHE).then(function(cache) {
                    cache.put(e.request, resp.clone());
                    return resp;
                });
            }).catch(function() {
                return caches.match(e.request);
            })
        );
        return;
    }

    // For all other assets — cache-first
    e.respondWith(
        caches.match(e.request).then(function(cached) {
            return cached || fetch(e.request).then(function(resp) {
                return caches.open(CACHE).then(function(cache) {
                    if (resp && resp.status === 200) cache.put(e.request, resp.clone());
                    return resp;
                });
            });
        })
    );
});
