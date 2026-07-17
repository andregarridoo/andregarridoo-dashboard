/* sw.js — Athlete OS PWA shell (D038). Network-first runtime cache.
   Shell version bumps ONLY when this file's logic changes — never per dashboard release. */
const CACHE = 'athlete-os-shell-v1';
const PRECACHE = ['./athlete-dashboard.html', './manifest.json',
                  './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Rule 1: same-origin GET only. Everything else — including EVERY call to
  // icu-relay.andregarridoo.workers.dev — is NOT intercepted (browser default).
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Rule 2: network-first, cache on success, cached fallback offline.
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then(hit =>
        hit || (e.request.mode === 'navigate' ? caches.match('./athlete-dashboard.html') : Response.error())
      )
    )
  );
});
