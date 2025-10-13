const CACHE_NAME = 'agentic-notes-cache-v1';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/site.webmanifest',
  '/favicon.svg',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/apple-touch-icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Basic app-shell and static asset caching
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle same-origin GET requests
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // For navigations, serve index.html from cache first (app shell)
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html').then((cached) => cached || fetch(request))
    );
    return;
  }

  // For other requests, use cache-first for core assets, fallback to network
  event.respondWith(
    caches.match(request).then((cached) =>
      cached || fetch(request).then((resp) => {
        const copy = resp.clone();
        // Opportunistically cache static assets
        if (resp.ok && (request.url.endsWith('.css') || request.url.endsWith('.js') || request.url.endsWith('.svg'))) {
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return resp;
      }).catch(() => cached)
    )
  );
});

