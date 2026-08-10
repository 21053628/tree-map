/* 樹木管理系統 - Service Worker (PWA 離線模式) v1.1.0
 * 新增：快取過期檢查、Background Sync、圖片 URL 統一化、Storage 監控
 */
const VERSION = 'v1.1.0';
const STATIC_CACHE = 'static-' + VERSION;
const RUNTIME_CACHE = 'runtime-' + VERSION;
const TILE_CACHE = 'tiles-' + VERSION;
const DATA_CACHE = 'data-' + VERSION;
const IMG_CACHE = 'img-' + VERSION;

// 🔥 快取配置
const TILE_MAX = 800;        // 地圖瓦片上限
const IMG_MAX = 300;         // 圖片上限
const RUNTIME_MAX = 100;     // 其他靜態資源上限
const DATA_MAX_AGE = 3600000; // 1 小時（API 快取過期時間）

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

/* ---------- 安裝階段 ---------- */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then(function(cache) {
        return Promise.all(PRECACHE.map(function(url) {
          return cache.add(url).catch(function(err) {
            console.warn('⚠️ 預快取跳過:', url, err.message);
          });
        }));
      })
      .then(function() { return self.skipWaiting(); })
  );
});

/* ---------- 啟用階段：清理舊快取 ---------- */
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k.indexOf(VERSION) === -1; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { 
      return self.clients.claim(); 
    })
  );
});

/* ---------- 工具：限制快取數量 ---------- */
function trimCache(cacheName, maxItems) {
  return caches.open(cacheName).then(function(cache) {
    return cache.keys().then(function(keys) {
      if (keys.length > maxItems) {
        return cache.delete(keys[0]).then(function() { 
          return trimCache(cacheName, maxItems); 
        });
      }
    });
  });
}

/* ---------- 🔥 工具：圖片 URL 統一化（去除 w1200/w600 參數）---------- */
function normalizeImgUrl(url) {
  if (!url) return url;
  // 移除 googleusercontent 嘅尺寸參數：=w1200, =w600, =s1200-c
  return url.replace(/=[wsh]\d+(-c)?$/g, '');
}

/* ---------- 🔥 工具：加 meta 資料（timestamp）---------- */
function cacheWithMeta(cache, req, res) {
  var copy = res.clone();
  var headers = new Headers(copy.headers);
  headers.set('x-sw-cached-at', String(Date.now()));
  var bodyPromise = copy.blob();
  return bodyPromise.then(function(blob) {
    var newRes = new Response(blob, {
      status: copy.status,
      statusText: copy.statusText,
      headers: headers
    });
    return cache.put(req, newRes);
  });
}

/* ---------- 🔥 工具：檢查快取是否過期 ---------- */
function isCacheFresh(res, maxAge) {
  if (!res) return false;
  var cachedAt = res.headers.get('x-sw-cached-at');
  if (!cachedAt) return true; // 無 timestamp 就當新
  return (Date.now() - parseInt(cachedAt, 10)) < maxAge;
}

/* ---------- 🔥 Background Sync API 註冊 ---------- */
self.addEventListener('sync', function(e) {
  if (e.tag === 'sync-outbox') {
    e.waitUntil(
      // 通知所有 client 觸發 syncOutbox
      self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'SYNC_OUTBOX' });
        });
      })
    );
  }
});

/* ---------- 訊息監聽：由 client 請求觸發 Background Sync ---------- */
self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'REGISTER_BG_SYNC') {
    if ('sync' in self.registration) {
      self.registration.sync.register('sync-outbox').catch(function() {
        // Background Sync 唔支援就唔理
      });
    }
  }
});

/* ---------- Fetch 攔截 ---------- */
self.addEventListener('fetch', function(e) {
  var req = e.request;
  if (req.method !== 'GET') return; // POST 唔快取

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* 1️⃣ 頁面導航：Stale-while-revalidate（即刻顯示 + 背景更新）*/
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match(req).then(function(cached) {
        var fetchPromise = fetch(req).then(function(res) {
          if (res.ok) {
            var copy = res.clone();
            caches.open(STATIC_CACHE).then(function(c) { 
              cacheWithMeta(c, req, copy); 
            });
          }
          return res;
        }).catch(function() { return cached; });
        return cached || fetchPromise;
      })
    );
    return;
  }

  /* 2️⃣ 後端 API：Network-first + 快取過期檢查 */
  if (url.hostname.indexOf('script.google.com') !== -1) {
    e.respondWith(
      fetch(req).then(function(res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(DATA_CACHE).then(function(c) { 
            cacheWithMeta(c, req, copy); 
          });
        }
        return res;
      }).catch(function() {
        return caches.match(req).then(function(cached) {
          // 🔥 檢查快取是否過期（超過 1 小時就標記為舊資料）
          if (cached && !isCacheFresh(cached, DATA_MAX_AGE)) {
            console.log('⚠️ API 快取已過期，返回 OFFLINE 提示');
            return new Response(JSON.stringify({ 
              ok: false, 
              error: 'OFFLINE', 
              stale: true  // 標記係過期快取
            }), { 
              headers: { 'Content-Type': 'application/json' },
              status: 200
            });
          }
          return cached || new Response(JSON.stringify({ 
            ok: false, 
            error: 'OFFLINE' 
          }), { 
            headers: { 'Content-Type': 'application/json' } 
          });
        });
      })
    );
    return;
  }

  /* 3️⃣ 地圖瓦片：Cache-first + Stale-while-revalidate */
  if (url.hostname.indexOf('geodata.gov.hk') !== -1 ||
      url.hostname.indexOf('tile.openstreetmap.org') !== -1 ||
      url.hostname.indexOf('arcgisonline.com') !== -1 ||
      url.hostname.indexOf('opentopomap.org') !== -1) {
    e.respondWith(
      caches.match(req).then(function(cached) {
        var fetchPromise = fetch(req).then(function(res) {
          if (res.ok) {
            var copy = res.clone();
            caches.open(TILE_CACHE).then(function(c) {
              cacheWithMeta(c, req, copy);
              trimCache(TILE_CACHE, TILE_MAX);
            });
          }
          return res;
        }).catch(function() { return cached; });
        return cached || fetchPromise;
      })
    );
    return;
  }

  /* 4️⃣ 相片：Cache-first + URL 統一化 */
  if (url.hostname.indexOf('googleusercontent.com') !== -1 ||
      url.hostname.indexOf('drive.google.com') !== -1 ||
      url.hostname.indexOf('drive.usercontent.google.com') !== -1) {
    
    var normalizedUrl = normalizeImgUrl(req.url);
    
    e.respondWith(
      caches.match(normalizedUrl).then(function(cached) {
        if (cached) return cached;
        return caches.match(req).then(function(cached2) {
          if (cached2) return cached2;
          return fetch(req).then(function(res) {
            if (res.ok) {
              var copy = res.clone();
              caches.open(IMG_CACHE).then(function(c) {
                c.put(normalizedUrl, copy);
                trimCache(IMG_CACHE, IMG_MAX);
              });
            }
            return res;
          });
        });
      })
    );
    return;
  }

  /* 5️⃣ 其他靜態資源：Stale-while-revalidate */
  e.respondWith(
    caches.match(req).then(function(cached) {
      var fetchPromise = fetch(req).then(function(res) {
        if (res.ok || res.type === 'opaque') {
          var copy = res.clone();
          caches.open(RUNTIME_CACHE).then(function(c) { 
            cacheWithMeta(c, req, copy);
            trimCache(RUNTIME_CACHE, RUNTIME_MAX);
          });
        }
        return res;
      }).catch(function() { return cached; });
      return cached || fetchPromise;
    })
  );
});