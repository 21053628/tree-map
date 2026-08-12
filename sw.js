/* 樹木管理系統 - Service Worker (PWA 離線模式) v1.2.0
 * 🚀 極速透明版：移除靜態資源 blob 轉換，完全配合 api.js v2.3 嘅 3秒放棄策略
 */
const VERSION = 'v1.2.0'; // 🔥 升級版本，強制清理舊緩存
const STATIC_CACHE = 'static-' + VERSION;
const RUNTIME_CACHE = 'runtime-' + VERSION;
const TILE_CACHE = 'tiles-' + VERSION;
const DATA_CACHE = 'data-' + VERSION;
const IMG_CACHE = 'img-' + VERSION;

const TILE_MAX = 800;
const IMG_MAX = 300;
const RUNTIME_MAX = 100;
const DATA_MAX_AGE = 3600000; // 1 小時

// 🔥 補全 Pre-cache 列表，確保首次加載 0 延遲
const PRECACHE = [
  './',
  './index.html',
  './t.html',
  './nfc.html',
  './manifest.webmanifest',
  './offline.js',
  './assets/css/main.css',
  './assets/js/config.js',
  './assets/js/utils.js',
  './assets/js/api.js',
  './assets/js/auth.js',
  './assets/js/app.js',
  './data/trees_data.json',
  './data/bootstrap.json', // 🔥 新增：靜態數據快照
  './icons/icon.svg',
  './icons/icon-180.png'  // 🔥 新增：iOS 圖標
];

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

function normalizeImgUrl(url) {
  if (!url) return url;
  return url.replace(/=[wsh]\d+(-c)?$/g, '');
}

/* ---------- 🔥 優化版：只針對 API JSON 使用 blob 轉換 ---------- */
function cacheAPIResponse(cache, req, res) {
  if (res.type === 'opaque' || res.status === 0) {
    return cache.put(req, res.clone());
  }
  var copy = res.clone();
  var headers = new Headers(copy.headers);
  headers.set('x-sw-cached-at', String(Date.now()));
  // JSON 體積細，blob 轉換好快，可以接受
  return copy.blob().then(function(blob) {
    var newRes = new Response(blob, {
      status: copy.status,
      statusText: copy.statusText,
      headers: headers
    });
    return cache.put(req, newRes);
  });
}

function isCacheFresh(res, maxAge) {
  if (!res) return false;
  var cachedAt = res.headers.get('x-sw-cached-at');
  if (!cachedAt) return true;
  return (Date.now() - parseInt(cachedAt, 10)) < maxAge;
}

self.addEventListener('sync', function(e) {
  if (e.tag === 'sync-outbox') {
    e.waitUntil(
      self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) {
          client.postMessage({ type: 'SYNC_OUTBOX' });
        });
      })
    );
  }
});

self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'REGISTER_BG_SYNC') {
    if ('sync' in self.registration) {
      self.registration.sync.register('sync-outbox').catch(function() {});
    }
  }
});

self.addEventListener('fetch', function(e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // 1. 導航請求 (HTML) - Stale-While-Revalidate
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match(req).then(function(cached) {
        var fetchPromise = fetch(req).then(function(res) {
          if (res.ok) {
            caches.open(STATIC_CACHE).then(function(c) { c.put(req, res.clone()); });
          }
          return res;
        }).catch(function() { return cached; });
        return cached || fetchPromise;
      })
    );
    return;
  }

  // 2. GAS API 請求 - Network First + Cache Fallback (完全信任 api.js 嘅 AbortController)
  if (url.hostname.indexOf('script.google.com') !== -1) {
    e.respondWith(
      fetch(req).then(function(res) {
        if (res.ok) {
          caches.open(DATA_CACHE).then(function(c) { 
            cacheAPIResponse(c, req, res); 
          });
        }
        return res;
      }).catch(function(err) {
        // 🔥 當 api.js 觸發 3秒 Abort 時，會進入呢度
        return caches.match(req).then(function(cached) {
          if (cached) {
            // 🔥 移除「過期就唔俾」嘅死板邏輯，有 Cache 就即刻返回，保證 UI 絕不卡頓
            if (!isCacheFresh(cached, DATA_MAX_AGE)) {
              console.log('⚠️ API 快取已過期，但仍返回以保證 UI 可用');
            }
            return cached;
          }
          // 如果完全冇 Cache，返回 OFFLINE JSON 俾 api.js 處理
          return new Response(JSON.stringify({ 
            ok: false, 
            error: 'OFFLINE' 
          }), { 
            headers: { 'Content-Type': 'application/json' },
            status: 200 // 返回 200 俾 api.js 解析 JSON，而唔係拋出 HTTP error
          });
        });
      })
    );
    return;
  }

  // 3. 地圖 Tiles - Cache First
  if (url.hostname.indexOf('geodata.gov.hk') !== -1 ||
      url.hostname.indexOf('tile.openstreetmap.org') !== -1 ||
      url.hostname.indexOf('arcgisonline.com') !== -1 ||
      url.hostname.indexOf('opentopomap.org') !== -1) {
    e.respondWith(
      caches.match(req).then(function(cached) {
        if (cached) return cached;
        return fetch(req).then(function(res) {
          if (res.ok) {
            caches.open(TILE_CACHE).then(function(c) {
              c.put(req, res.clone()); // 🔥 直接 put，唔用 blob 轉換
              trimCache(TILE_CACHE, TILE_MAX);
            });
          }
          return res;
        });
      })
    );
    return;
  }

  // 4. 圖片 (Google Drive / Usercontent) - Cache First
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
              caches.open(IMG_CACHE).then(function(c) {
                c.put(normalizedUrl, res.clone()); // 🔥 直接 put
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

  // 5. 其他靜態資源 (JS/CSS/Fonts) - Cache First (靠 SW 版本控制更新)
  e.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) return cached;
      return fetch(req).then(function(res) {
        if (res.ok || res.type === 'opaque') {
          caches.open(RUNTIME_CACHE).then(function(c) { 
            c.put(req, res.clone()); // 🔥 移除 blob 轉換，極大提升性能！
            trimCache(RUNTIME_CACHE, RUNTIME_MAX);
          });
        }
        return res;
      });
    })
  );
});