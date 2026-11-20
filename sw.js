/* AZUMA menu: service worker.
 * Goal: after the first visit the menu opens offline and instantly,
 * while new prices (js/data.js) still reach guests whenever they are online.
 *
 * Bump VERSION when the shell list or strategies change: on activate every
 * cache that is not CACHE is deleted (dish photos are re-cached on demand).
 */
const VERSION = 'v2';
const CACHE = 'azuma-' + VERSION;

// App shell, relative to the SW location (= site root). Fonts/icons are NOT
// listed on purpose: their names are unknown, runtime caching covers them.
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/intro.js',
  'js/app.js',
  'js/data.js',          // offline fallback for api/data (same window.AZUMA_DATA script)
  'js/data-fallback.js',
  'js/sw-register.js',
  'img/Spicy.svg',
  'img/Extra.svg'
];

const SCOPE = new URL('./', self.location).href;      // e.g. https://host/
const ROOT_URL = SCOPE;                               // cache key for the page
const NAV_TIMEOUT = 4000;   // weak network: show cached page after 4 s
const DATA_TIMEOUT = 3000;  // weak network: show cached prices after 3 s

/* ---------- lifecycle ---------- */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache:'reload' bypasses the HTTP cache so we store fresh copies.
    await Promise.all(SHELL.map(async (u) => {
      const res = await fetch(new Request(u, { cache: 'reload' }));
      if (!res.ok) throw new Error('precache failed: ' + u); // keep old SW
      await cache.put(new URL(u, SCOPE).href, await clean(res));
    }));
    // Activate right away. Safe here: the page never reloads itself, the new
    // files are simply served on the next visit / next request.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('azuma-') && k !== CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim(); // control the already open page too
  })());
});

/* ---------- helpers ---------- */

// Only store complete, same-origin, successful responses.
function cacheable(res) {
  return res && res.ok && res.type === 'basic';
}

// A redirected response (e.g. Vercel cleanUrls: /index.html -> /) must not be
// served to a navigation, so store a non-redirected copy of its body.
async function clean(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), {
    status: res.status, statusText: res.statusText, headers: res.headers
  });
}

// Network-first with timeout. If the network is slow and a cached copy exists,
// the cached copy is returned, but the network request keeps going and
// refreshes the cache for next time. Without a cached copy we wait for the net.
async function networkFirst(event, request, cacheKey, timeoutMs, fallbackKeys) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then((res) => {
    if (cacheable(res)) {
      event.waitUntil(clean(res.clone()).then((c) => cache.put(cacheKey, c)));
    }
    return res;
  });
  event.waitUntil(network.catch(() => {})); // keep SW alive for the refresh

  const fromCache = async () => {
    for (const k of [cacheKey, ...(fallbackKeys || [])]) {
      const hit = await cache.match(k, { ignoreSearch: true });
      if (hit) return hit;
    }
    return undefined;
  };

  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (r) => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => fromCache().then(finish), timeoutMs);

    network.then((res) => { clearTimeout(timer); finish(res); })
      .catch(async () => {            // offline / DNS error
        clearTimeout(timer);
        const hit = await fromCache();
        if (hit) finish(hit);
        else if (!done) { done = true; reject(new TypeError('offline')); }
      });
  });
}

// Stale-while-revalidate: answer from cache instantly, refresh in background.
async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const network = fetch(request).then((res) => {
    if (cacheable(res)) event.waitUntil(cache.put(request, res.clone()));
    return res;
  });
  if (hit) {
    event.waitUntil(network.catch(() => {}));
    return hit;
  }
  return network;
}

// Cache-first: images and fonts never change under the same name.
async function cacheFirst(event, request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (cacheable(res)) event.waitUntil(cache.put(request, res.clone()));
  return res;
}

/* ---------- routing ---------- */

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                 // POST etc.: untouched
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // cross-origin: untouched
  if (!url.href.startsWith(SCOPE)) return;

  const path = url.href.slice(SCOPE.length).split(/[?#]/)[0]; // e.g. "js/app.js"

  // Live menu (prices edited in the admin): network-first like js/data.js; offline or slow ->
  // the last cached api/data, or the precached bundled js/data.js on the very first offline visit.
  if (path === 'api/data') {
    const fresh = new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    event.respondWith(networkFirst(event, fresh, new URL('api/data', SCOPE).href, DATA_TIMEOUT,
      [new URL('js/data.js', SCOPE).href]));
    return;
  }
  // Admin panel and the rest of the serverless API: never intercepted.
  if (path === 'admin' || path.startsWith('admin/') || path.startsWith('admin.') ||
      path.startsWith('api/') || path === 'api') return;

  // Page itself (QR link, #menu/#bar/... are client-side, never reach here).
  const isShellPage = path === '' || path === 'index.html';
  if (req.mode === 'navigate' || isShellPage) {
    // Root/index.html share one cache entry; other pages fall back to it offline.
    const key = isShellPage ? ROOT_URL : url.href.split(/[?#]/)[0];
    event.respondWith(networkFirst(event, req, key, NAV_TIMEOUT,
      [ROOT_URL, new URL('index.html', SCOPE).href]));
    return;
  }

  // Menu data: fresh prices when online, cached menu when offline or slow.
  if (path === 'js/data.js') {
    // no-cache = always revalidate with the server (ETag), never stale HTTP cache.
    const fresh = new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    event.respondWith(networkFirst(event, fresh, new URL('js/data.js', SCOPE).href, DATA_TIMEOUT));
    return;
  }

  if (path.startsWith('img/') || path.startsWith('fonts/')) {
    event.respondWith(cacheFirst(event, req));
    return;
  }

  if (/\.(css|js|webmanifest)$/.test(path)) {
    event.respondWith(staleWhileRevalidate(event, req));
    return;
  }
  // Anything else: default browser behaviour.
});

/* ---------- optional background warm-up of dish photos ----------
 * js/sw-register.js posts {type:'warm', urls:[...]} after load, but only when
 * the guest has not enabled Data Saver and is not on 2G. Photos are fetched
 * one by one (no burst on a weak connection); already cached ones are skipped.
 */
self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || msg.type !== 'warm' || !Array.isArray(msg.urls)) return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const u of msg.urls) {
      const url = new URL(u, SCOPE);
      if (url.origin !== self.location.origin) continue;
      if (await cache.match(url.href)) continue;
      try {
        const res = await fetch(url.href);
        if (cacheable(res)) await cache.put(url.href, res);
      } catch (e) { break; }  // went offline: stop, retry on next visit
    }
  })());
});
