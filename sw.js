/* 樹木管理系統 - Service Worker (PWA 離線模式) v1.3.0
 * 🔥 穩定性強化：
 *   1. 補齊完整預快取（vendor 地圖函式庫 + 全部 ES modules + icons）
 *   2. 導航離線 fallback：網路失敗絕不拋錯，改回退 cached index.html
 *   3. 快取清理精準化（用「前綴 + 完整版本」比對，不再用 indexOf）
 *   4. install 記錄預快取結果，方便排查漏檔
 *   5. 升版號強制清除舊快取
 *   6. Phase 5：抽出快取處理函數，並加入 isApiRequest 預留公司 server 遷移
 */
const VERSION = 'v2.9.3'; // 🔥 [修復] NFC/搜尋定位 marker._map 輪詢：locate.js(moveend+120ms×15+1.6s安全網) + trees.js silent重開(100ms×10)
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
  './assets/js/modules/sync-panel.js',
  './assets/js/modules/audit-log.js',
  // 樣式
  './assets/css/tokens.css',
  './assets/css/base.css',
  './assets/css/layout.css',
  './assets/css/map.css',
  './assets/css/ui.css',
  './assets/css/responsive.css',
  './assets/css/dark.css',
  './assets/css/filters.css',
  './assets/css/gis.css',
  './assets/css/performance.css',
  // 自家全域腳本
  './assets/js/config.js',
  './assets/js/utils.js',
  './assets/js/api.js',
  './assets/js/auth.js',
  './assets/js/app.js',
  // 共用核心 [Phase0/4]
  './assets/js/core/utils.js',
  './assets/js/core/event-bus.js',
  './assets/js/core/coord-lazy.js',
  // ES Modules（app.js 靜態 import）
  './assets/js/modules/state.js',
  './assets/js/modules/ui-state.js',
  './assets/js/modules/dom.js',
  './assets/js/modules/map.js',
  './assets/js/modules/search.js',
  './assets/js/modules/species.js',
  './assets/js/modules/trees.js',
  './assets/js/modules/filters.js',
  './assets/js/modules/projects.js',
  './assets/js/modules/locate.js',
  './assets/js/modules/lots.js',
  './assets/js/modules/forms.js',
  './assets/js/modules/draw.js',
  './assets/js/modules/geolocate.js',
  './assets/js/modules/loader.js',
  // 頁面邏輯 [Phase5]
  './assets/js/pages/nfc.js',
  './assets/js/pages/t.js',
  './assets/js/pages/tree-detail/td-utils.js',
  './assets/js/pages/tree-detail/td-photos.js',
  './assets/js/pages/tree-detail/td-logs.js',
  // 自托管第三方函式庫（地圖核心，離線必需）
  './assets/vendor/leaflet.css',
  './assets/vendor/leaflet.js',
  './assets/vendor/leaflet.markercluster.js',
  './assets/vendor/MarkerCluster.css',
  './assets/vendor/MarkerCluster.Default.css',
  './assets/vendor/proj4.js',
  './assets/vendor/purify.min.js',
  // 資料
  './data/trees_data.json',
  // Icons
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(STATIC_CACHE)
      .then(function(cache) {
        return Promise.all(PRECACHE.map(function(url) {
          return cache.add(url).catch(function(err) {
            console.warn('⚠️ 預快取跳過:', url, err.message);
            return { url: url, failed: true };
          });
        }));
      })
      .then(function(results) {
        var failed = results.filter(function(r) { return r && r.failed; });
        if (failed.length) {
          console.warn('🔴 預快取完成，但有 ' + failed.length + ' 個失敗:', failed.map(function(r) { return r.url; }));
        } else {
          console.log('✅ 預快取完成，共 ' + PRECACHE.length + ' 個檔案');
        }
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function(e) {
  var CACHE_PREFIXES = ['static-', 'runtime-', 'tiles-', 'data-', 'img-'];
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.map(function(k) {
          var keep = CACHE_PREFIXES.some(function(p) { return k.indexOf(p + VERSION) === 0; });
          if (!keep) return caches.delete(k);
        })
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

// 🔥 可中止的 fetch：弱網下不會長時間停滯，超時即刻回退快取
function fetchWithTimeout(req, timeout) {
  return new Promise(function(resolve, reject) {
    var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var signal = controller ? controller.signal : null;
    var timer = setTimeout(function() {
      if (controller) controller.abort();
      reject(new Error('TIMEOUT'));
    }, timeout);
    var opts = {};
    if (signal) opts.signal = signal;
    fetch(req, opts).then(function(res) {
      clearTimeout(timer);
      resolve(res);
    }).catch(function(err) {
      clearTimeout(timer);
      reject(err);
    });
  });
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
  // 驗證消息來源，僅允許同源消息
  if (e.origin !== self.location.origin) {
    console.warn('[SW] 拒絕非同源消息:', e.origin);
    return;
  }
  if (e.data && e.data.type === 'REGISTER_BG_SYNC') {
    if ('sync' in self.registration) {
      self.registration.sync.register('sync-outbox').catch(function() {});
    }
  }
});

/* ===== 請求類型判斷（集中管理，方便日後遷移後端） ===== */
function isApiRequest(url) {
  // 1. 現有 Google Apps Script 後端
  if (url.hostname.indexOf('script.google.com') !== -1) return true;
  // 2. 預留：未來公司 server 嘅 API 路徑（same-origin 遷移用）
  if (url.pathname.indexOf('/api/') !== -1) return true;
  return false;
}

function isTileRequest(url) {
  return url.hostname.indexOf('geodata.gov.hk') !== -1 ||
         url.hostname.indexOf('tile.openstreetmap.org') !== -1 ||
         url.hostname.indexOf('arcgisonline.com') !== -1 ||
         url.hostname.indexOf('opentopomap.org') !== -1;
}

function isImageRequest(url) {
  return url.hostname.indexOf('googleusercontent.com') !== -1 ||
         url.hostname.indexOf('drive.google.com') !== -1 ||
         url.hostname.indexOf('drive.usercontent.google.com') !== -1;
}

function handleNavigation(req) {
  return fetch(req).then(function(res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(STATIC_CACHE).then(function(c) {
        return cacheAPIResponse(c, req, copy);
      }).catch(function(){});
    }
    return res;
  }).catch(function() {
    // 🔥 關鍵修正：網路失敗 → 先回退 exact cached，再回退 index.html，絕不拋錯
    return caches.match(req).then(function(cached) {
      return cached || caches.match('./index.html').then(function(shell) {
        return shell || Response.error();
      });
    });
  });
}

function handleApi(req) {
  return fetchWithTimeout(req, 12000).then(function(res) {
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
  });
}

function handleTiles(req) {
  return caches.match(req).then(function(cached) {
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
    });
  });
}

function handleImages(req) {
  var normalizedUrl = normalizeImgUrl(req.url);

  return caches.match(normalizedUrl).then(function(cached) {
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
  });
}

function handleStatic(req) {
  return caches.match(req).then(function(cached) {
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
    });
  });
}

self.addEventListener('fetch', function(e) {
  var req = e.request;
  if (req.method !== 'GET') return; // POST 寫入直達 GAS，絕不攔截

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // 1. 導航請求 (HTML) - Network-First + 離線 fallback
  if (req.mode === 'navigate') {
    e.respondWith(handleNavigation(req));
    return;
  }

  // 2. API 請求 - Network-First（認 GAS + 未來 /api/）
  if (isApiRequest(url)) {
    e.respondWith(handleApi(req));
    return;
  }

  // 3. 地圖 Tiles - Cache First
  if (isTileRequest(url)) {
    e.respondWith(handleTiles(req));
    return;
  }

  // 4. 圖片 (Google Drive / Usercontent) - Cache First
  if (isImageRequest(url)) {
    e.respondWith(handleImages(req));
    return;
  }

  // 5. 其他靜態資源 (JS/CSS/Fonts) - Cache First
  e.respondWith(handleStatic(req));
});
