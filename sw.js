/* 樹木管理系統 - Service Worker (PWA 離線模式) v1.1.1
 * 修正：cacheWithMeta 處理 opaque response
 */
const VERSION = 'v1.1.3';
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

/* ---------- 🔥 修正版 cacheWithMeta ---------- */
function cacheWithMeta(cache, req, res) {
  // 跳過 opaque response（CORS 失敗或跨域資源）
  if (res.type === 'opaque' || res.status === 0) {
    return cache.put(req, res.clone());
  }
  
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
          if (cached && !isCacheFresh(cached, DATA_MAX_AGE)) {
            console.log('⚠️ API 快取已過期');
            return new Response(JSON.stringify({ 
              ok: false, 
              error: 'OFFLINE', 
              stale: true
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