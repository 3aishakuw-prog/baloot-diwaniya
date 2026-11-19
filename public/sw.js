// offline cache for بلوت الديوانية (build e88401af)
const CACHE = 'baloot-e88401af';
const SHELL = ["/","/index.html","/css/app.css?v=e88401af","/manifest.webmanifest","/icons/icon-192.png","/icons/icon-512.png","/shared/engine.js?v=e88401af","/shared/bot.js?v=e88401af","/shared/host.js?v=e88401af","/js/cards.js?v=e88401af","/js/sound.js?v=e88401af","/js/net.js?v=e88401af","/js/ui.js?v=e88401af","/js/table.js?v=e88401af","/js/app.js?v=e88401af"];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
const put = (req, res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; };
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.startsWith('/api/') || url.pathname === '/ws') return;
    if (req.mode === 'navigate') {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        // open instantly from cache (the free server may be asleep) and refresh in the background
        e.respondWith(caches.match('/index.html').then((hit) => {
          const net = fetch(req).then((r) => put('/index.html', r)).catch(() => hit);
          return hit || net;
        }));
      } else {
        e.respondWith(fetch(req).then((r) => put(req, r)).catch(() => caches.match(req)));
      }
      return;
    }
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => put(req, r))));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => put(req, r)).catch(() => hit)));
  }
});
