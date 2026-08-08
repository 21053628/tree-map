/* 樹木管理系統 - Service Worker (PWA 離線模式) */
const VERSION = 'v1.0.1'; // 🔥 升咗版本，自動清舊快取
const STATIC_CACHE = 'static-' + VERSION;
const RUNTIME_CACHE = 'runtime-' + VERSION;
const TILE_CACHE = 'tiles-' + VERSION;
const DATA_CACHE = 'data-' + VERSION;
const IMG_CACHE = 'img-' + VERSION;

/* 🔥 修正：路徑要配合你 GitHub 仓库結構（JS 喺 assets/js/）*/
const PRECACHE = [
  './',
  './index.html',
  './t.html',
  './manifest.webmanifest',
  './offline.js',
  './assets/css/main.css',
  './assets/js/config.js',
  './assets/js/utils.js',
  './assets/js/api.js',
  './assets/js/auth.js',
  './assets/js/app.js',
  './data/trees_data.json',
  './icons/icon.svg'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      /* 🔥 修正：逐個快取，任何一個 404 都唔會搞死成個安裝 */
      return Promise.all(PRECACHE.map(function(url) {
        return cache.add(url).catch(function() {
          console.warn('⚠️ 預快取跳過:', url);
        });
      }));
    }).then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k.indexOf(VERSION) === -1; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

function trimCache(cacheName, maxItems) {
  return caches.open(cacheName).then(function(cache) {
    return cache.keys().then(function(keys) {
      if (keys.length > maxItems) {
        return cache.delete(keys[0]).then(function() { return trimCache(cacheName, maxItems); });
      }
    });
  });
}

self.addEventListener('fetch', function(e) {
  const req = e.request;
  if (req.method !== 'GET') return; // POST 唔快取，交俾離線佇列

  const url = new URL(req.url);

  /* 1️⃣ 頁面導航：網路優先，離線用快取 */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function(res) {
        const copy = res.clone();
        caches.open(STATIC_CACHE).then(function(c) { c.put(url.pathname, copy); });
        return res;
      }).catch(function() {
        return caches.match(url.pathname)
          .then(function(r) { return r || caches.match('./index.html'); });
      })
    );
    return;
  }

  /* 2️⃣ 後端 API：網路優先 + 離線回退 */
  if (url.hostname.indexOf('script.google.com') !== -1) {
    e.respondWith(
      fetch(req).then(function(res) {
        if (res.ok) {
          const copy = res.clone();
          caches.open(DATA_CACHE).then(function(c) { c.put(req, copy); });
        }
        return res;
      }).catch(function() {
        return caches.match(req).then(function(cached) {
          return cached || new Response(JSON.stringify({ ok: false, error: 'OFFLINE' }),
            { headers: { 'Content-Type': 'application/json' } });
        });
      })
    );
    return;
  }

  /* 3️⃣ 地圖瓦片：快取優先 */
  if (url.hostname.indexOf('geodata.gov.hk') !== -1 ||
      url.hostname.indexOf('tile.openstreetmap.org') !== -1 ||
      url.hostname.indexOf('arcgisonline.com') !== -1 ||
      url.hostname.indexOf('opentopomap.org') !== -1) {
    e.respondWith(
      caches.match(req).then(function(cached) {
        if (cached) return cached;
        return fetch(req).then(function(res) {
          if (res.ok) {
            const copy = res.clone();
            caches.open(TILE_CACHE).then(function(c) {
              c.put(req, copy); trimCache(TILE_CACHE, 600);
            });
          }
          return res;
        });
      })
    );
    return;
  }

  /* 4️⃣ 相片：快取優先 */
  if (url.hostname.indexOf('googleusercontent.com') !== -1 ||
      url.hostname.indexOf('drive.google.com') !== -1) {
    e.respondWith(
      caches.match(req).then(function(cached) {
        if (cached) return cached;
        return fetch(req).then(function(res) {
          if (res.ok) {
            const copy = res.clone();
            caches.open(IMG_CACHE).then(function(c) {
              c.put(req, copy); trimCache(IMG_CACHE, 200);
            });
          }
          return res;
        });
      })
    );
    return;
  }

  /* 5️⃣ 其他靜態資源 */
  e.respondWith(
    caches.match(req).then(function(cached) {
      const network = fetch(req).then(function(res) {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then(function(c) { c.put(req, copy); });
        }
        return res;
      }).catch(function() { return cached; });
      return cached || network;
    })
  );
});