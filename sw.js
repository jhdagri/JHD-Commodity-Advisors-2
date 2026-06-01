// The Bushel — JHD Commodity Advisors
// Service Worker v1.0
// Caches the app shell for fast load and offline fallback

var CACHE_NAME = 'bushel-v1';
var SHELL_URLS = [
  '/',
  '/index.html'
];

// Install — cache the app shell
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(SHELL_URLS);
    })
  );
  self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// Fetch — network first, fall back to cache for navigation requests
self.addEventListener('fetch', function(e) {
  // Only handle GET requests
  if (e.request.method !== 'GET') return;

  // For navigation requests (page loads) — network first, cache fallback
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(function(resp) {
          // Update cache with fresh response
          var clone = resp.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(e.request, clone);
          });
          return resp;
        })
        .catch(function() {
          // Offline — serve cached index.html
          return caches.match('/index.html');
        })
    );
    return;
  }

  // For Netlify functions and Supabase API calls — network only, no caching
  if (e.request.url.indexOf('supabase.co') > -1 ||
      e.request.url.indexOf('netlify/functions') > -1 ||
      e.request.url.indexOf('resend.com') > -1) {
    return;
  }

  // For everything else — cache first, network fallback
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request);
    })
  );
});
