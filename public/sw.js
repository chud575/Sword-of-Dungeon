// Offline cache for the home-screen web app. Registered by main.js ONLY in a production build served over http(s),
// never by the dev server and never inside the Capacitor app.
//
// The build writes precache.json (vite.config.js): every emitted file except source maps, plus a version hash of
// that list. Install caches all of it under that version; activate drops every older version, so a new build
// replaces the cache in one step rather than mixing old and new hashed files.
const PREFIX = 'fargoal-';

async function readManifest() {
  const res = await fetch('./precache.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('precache.json ' + res.status);
  return res.json();
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const m = await readManifest();
    const cache = await caches.open(PREFIX + m.version);
    await cache.addAll(['./', ...m.files.map((f) => './' + f)]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    let keep = null;
    try { keep = PREFIX + (await readManifest()).version; } catch { /* offline: keep everything */ }
    if (keep) for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== keep) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // the page: the network when there is one (a new build), the cached shell when there is not
    event.respondWith(fetch(req).catch(async () => (await caches.match('./', { ignoreSearch: true })) || (await caches.match(req, { ignoreSearch: true })) || Response.error()));
    return;
  }
  // hashed assets never change under one name: the cache first
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
