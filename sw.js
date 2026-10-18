// 오프라인 캐시 — 네트워크 우선, 실패하면 캐시. 문제(data/)도 같은 방식이라 새 문제는 바로 반영된다.
const CACHE = 'quiz-world-v1';
const ASSETS = ['./', './index.html', './assets/app.css?v=1', './assets/merge.js?v=1', './assets/app.js?v=1',
  './manifest.webmanifest?v=1', './assets/icon.svg', './assets/icon-192.png', './assets/icon-512.png', './data/index.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-cache' })
    .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); return res; })
    .catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
});
