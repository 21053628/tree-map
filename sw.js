/* 樹木管理系統 - Service Worker (PWA 離線模式) v1.2.4
 * 🔥 配合 app.js v2.54：移除 data/bootstrap.json 預快取
 * 🔥 繼承 v1.2.3 修正：catch 冇快取時改為「直接拋錯」，
 *      徹底消滅 respondWith(undefined) 導致的錯誤
 */
const VERSION = 'v1.2.4'; // 🔥 升級版本，強制清理舊快取
const STATIC_CACHE = 'static-' + VERSION;
const RUNTIME_CACHE = 'runtime-' + VERSION;
const TILE_CACHE = 'tiles-' + VERSION;
const DATA_CACHE = 'data-' + VERSION;
const IMG_CACHE = 'img-' + VERSION;

const TILE_MAX = 800;
const IMG_MAX = 300;
const RUNTIME_MAX = 100;
const DATA_MAX_AGE = 3600000;

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
  // 🔥 已移除 './data/bootstrap.json'
  './icons/icon.svg'
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

function cacheAPIResponse(cache, req, clonedRes) {
  if (clonedRes.type === 'opaque' || clonedRes.status === 0) {
    return cache.put(req, clonedRes).catch(function(){});
  }
  var headers = new Headers(clonedRes.headers);
  headers.set('x-sw-cached-at', String(Date.now()));
  return clonedRes.blob().then(function(blob) {
    var newRes = new Response(blob, {
      status: clonedRes.status,
      statusText: clonedRes.statusText,
      headers: headers
    });
    return cache.put(req, newRes);
  }).catch(function(){});
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
  if (req.method !== 'GET') return; // POST 寫入直達 GAS，絕不攔截

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // 1. 導航請求 (HTML)
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match(req).then(function(cached) {
        var fetchPromise = fetch(req).then(function(res) {
          if (res.ok) {
            var copy = res.clone();
            caches.open(STATIC_CACHE).then(function(c) {
              return cacheAPIResponse(c, req, copy);
            }).catch(function(){});
          }
          return res;
        }).catch(function(err) {
          if (cached) return cached;
          throw err;
        });
        return cached || fetchPromise;
      })
    );
    return;
  }

  // 2. GAS API 請求
  if (url.hostname.indexOf('script.google.com') !== -1) {
    e.respondWith(
      fetch(req).then(function(res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(DATA_CACHE).then(function(c) {
            return cacheAPIResponse(c, req, copy);
          }).catch(function(){});
        }
        return res;
      }).catch(function() {
        return caches.match(req).then(function(cached) {
          if (cached) {
            if (!isCacheFresh(cached, DATA_MAX_AGE)) {
              console.log('⚠️ API 快取已過期，但仍返回以保證 UI 可用');
            }
            return cached;
          }
          return new Response(JSON.stringify({ ok: false, error: 'OFFLINE' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200
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
            var copy = res.clone();
            caches.open(TILE_CACHE).then(function(c) {
              return c.put(req, copy).then(function() {
                return trimCache(TILE_CACHE, TILE_MAX);
              });
            }).catch(function(){});
          }
          return res;
        }).catch(function(err) {
          if (cached) return cached;
          throw err;
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
              var copy = res.clone();
              caches.open(IMG_CACHE).then(function(c) {
                return c.put(normalizedUrl, copy).then(function() {
                  return trimCache(IMG_CACHE, IMG_MAX);
                });
              }).catch(function(){});
            }
            return res;
          }).catch(function(err) {
            throw err;
          });
        });
      })
    );
    return;
  }

  // 5. 其他靜態資源 (JS/CSS/Fonts) - Cache First
  e.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) return cached;
      return fetch(req).then(function(res) {
        if (res.ok || res.type === 'opaque') {
          var copy = res.clone();
          caches.open(RUNTIME_CACHE).then(function(c) {
            return c.put(req, copy).then(function() {
              return trimCache(RUNTIME_CACHE, RUNTIME_MAX);
            });
          }).catch(function(){});
        }
        return res;
      }).catch(function(err) {
        if (cached) return cached;
        throw err;
      });
    })
  );
});