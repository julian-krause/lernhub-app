// Service Worker der iPhone-App: Die Hülle (Seite, Skripte, Styles, Symbole) kommt aus dem Netz und fällt auf den
// Cache zurück, wenn der Mac nicht erreichbar ist. Dann startet die App trotzdem und sagt, was fehlt.
// API, Ereignisse, Merkblätter und Klänge gehen immer ans Netz und werden nie zwischengespeichert.
const CACHE = 'lernhub-huelle-1';
const HUELLE = ['/', '/m/app.js', '/m/mobil.css', '/bs.css', '/js/md.js', '/js/bilder.js', '/js/util.js', '/js/regeln.js', '/icon-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(HUELLE)).catch(() => { }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (/^\/(api|datei|klaenge)\//.test(u.pathname) || u.pathname === '/manifest.webmanifest') return;
  const schluessel = u.pathname === '/' || u.pathname === '/index.html' ? '/' : u.pathname;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const k = r.clone(); caches.open(CACHE).then((c) => c.put(schluessel, k)).catch(() => { }); }
    return r;
  }).catch(() => caches.match(schluessel).then((r) => r || new Response('Offline', { status: 503 }))));
});
