// Offline app shell. Stale-while-revalidate for same-origin GET; API calls (other origin) are never cached.
const CACHE = 'strokuni-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/m3.css', 'css/app.css', 'fonts/material-symbols-rounded.woff2',
  'icons/icon.svg', 'icons/icon-192.png',
  'js/main.js', 'js/router.js', 'js/ui.js', 'js/time.js', 'js/store.js', 'js/native.js', 'js/speech.js', 'js/meds.js',
  'js/srs.js', 'js/plan.js', 'js/sync.js', 'js/ai.js',
  'js/views/lio.js', 'js/views/practice.js', 'js/views/family.js', 'js/views/onboarding.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const network = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => cached);
    return cached || network;
  }));
});
