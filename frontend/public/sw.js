/* IREME service worker: lets the app install, start offline and keep working without the network.
   - App shell and static files: cached on first use, updated in the background (stale-while-revalidate).
   - Pages (navigation): network first, falling back to the cached app shell when offline.
   - /api/ calls, weather and map tiles are NOT cached here (always live); the app handles their absence itself.
   Bump CACHE when you want every device to drop old files. */
const CACHE = 'ireme-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/nisr_insights.json', '/icons/icon-192.png', '/icons/icon-512.png', '/ireme-logo.jpg', '/crop-scan-background.png', '/sign-videos/sign-idle-placeholder.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // weather, map tiles, boundaries: network only
  if (url.pathname.startsWith('/api/')) return;               // backend calls: network only
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/index.html', copy)); return res; }).catch(() => caches.match('/index.html')));
    return;
  }
  if (req.headers.has('range')) return;                       // let video streaming go straight to the network
  event.respondWith(caches.match(req).then((hit) => {
    const fresh = fetch(req).then((res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => hit);
    return hit || fresh;
  }));
});
