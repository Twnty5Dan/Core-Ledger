/* Core Ledger service worker: app shell network-first for pages (so updates arrive), cache-first for everything else;
   fonts, exercise pictures (GitHub, wger, Wikimedia, Fitness Programer) and photography (Unsplash) cached on first use. */
const V = 'core-ledger-v6';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png', './media/kneeling-side-plank.png', './media/suitcase-hold.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const cacheable = u.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname) || /(githubusercontent\.com|wger\.de|wikimedia\.org|fitnessprogramer\.com|images\.unsplash\.com)$/.test(u.hostname);
  if (!cacheable) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(V).then(c => c.put('./index.html', cp)); return res; }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => { if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; })));
});
