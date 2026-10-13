// Service worker: caches the app shell and hashed assets so the game starts
// fast and survives a flaky connection. API calls always go to the network:
// merchant data, missions and rewards must come from the server.
const CACHE = 'edw-v4';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/images/')) return;
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/api/images/') || url.pathname.startsWith('/icons/')) {
    // immutable: cache first
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(event.request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }
  if (url.pathname.startsWith('/models/') || url.pathname.startsWith('/img/')) {
    // large 3D models: serve the cached copy at once and refresh it in the background
    event.respondWith(
      caches.open(CACHE).then((c) =>
        c.match(event.request).then((hit) => {
          const fresh = fetch(event.request)
            .then((res) => {
              if (res.ok) c.put(event.request, res.clone());
              return res;
            })
            .catch(() => hit);
          return hit || fresh;
        }),
      ),
    );
    return;
  }
  if (event.request.mode === 'navigate') {
    // network first so new deployments show up; fall back to the cached shell offline
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
  }
});
