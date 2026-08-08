/* 樹木管理系統 - Service Worker (PWA 離線模式) */
const VERSION = 'v1.0.0'; // 🔥 每次更新代碼後，改呢度（例如 v1.0.1）就會自動換新快取
const STATIC_CACHE = 'static-' + VERSION;
const RUNTIME_CACHE = 'runtime-' + VERSION;
const TILE_CACHE = 'tiles-' + VERSION;
const DATA_CACHE = 'data-' + VERSION;
const IMG_CACHE = 'img-' + VERSION;

/* 預先快取：App 外殼（第一次打開後即刻可離線）*/
const PRECACHE = [
  './', './index.html', './t.html',
  './main.css', './config.js', './utils.js', './auth.js',
  './api.js', './app.js', './offline.js',
  './data/trees_data.json', './manifest.webmanifest', './icons/icon.svg'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then(function(c) { return c.addAll(PRECACHE); })
      .then(function() { return self.skipWaiting(); })
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

/* 限制快取數量（防止 tiles/相片食爆手機空間）*/
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
  if (req.method !== 'GET') return; // POST（寫入）唔快取，交俾離線佇列處理

  const url = new URL(req.url);

  /* 1️⃣ 頁面導航：網路優先，離線時用快取頁面 */
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

  /* 2️⃣ 後端 API (Apps Script)：網路優先 + 離線回退快取 */
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

  /* 3️⃣ 地圖瓦片：快取優先（去過嘅地方離線都睇到地圖）*/
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

  /* 4️⃣ 相片：快取優先（睇過嘅相離線都睇到）*/
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

  /* 5️⃣ 其他靜態資源（CDN 庫等）：快取優先 + 背景更新 */
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