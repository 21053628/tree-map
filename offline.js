/**
 * 樹木管理系統 - 離線寫入佇列 (IndexedDB Outbox)
 * v1.9.0 - 改進版：
 *   - 修正 IndexedDB 交易 Promise 包裝
 *   - 同步流程改為逐筆處理，失敗不阻塞後續
 *   - 加入重試上限（MAX_RETRY），超過即丟棄並通知
 *   - 快取鍵加入參數序列化，避免不同參數互相覆蓋
 *   - warmGAS 使用 no-cors 模式，避免 CORS 錯誤
 *   - 使用 finally 確保 _syncing 狀態正確重置
 *   - 其他程式碼品質與可讀性提升
 */
(function() {
  'use strict';

  // ========== 設定 ==========
  // 🔥 [Phase1] 統一由 Config.API_ENDPOINT 管理，移除硬編碼 fallback
  var API_URL = (typeof Config !== 'undefined' && Config.API_ENDPOINT)
    ? Config.API_ENDPOINT
    : '';

  var DB_NAME = 'tree-offline';
  var STORE = 'outbox';
  var SNAPSHOT_STORE = 'snapshot';
  var dbPromise = null;

  var MAX_AGE_DAYS = 30;
  var MAX_RETRY = 5;
  var SYNC_BATCH_SIZE = 10;

  var CACHE_KEY_PREFIX = 'tree_cache_';
  var CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

  // 節流時間戳
  var _lastWarm = 0;
  var _lastSyncAttempt = 0;
  var _failToastShown = false;
  var _reloading = false;

  // ========== 工具函式 ==========
  function pwaToast(msg, duration) {
    var el = document.getElementById('pwaToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pwaToast';
      el.style.cssText = 'position:fixed;left:50%;bottom:80px;transform:translateX(-50%);background:#263238;color:#fff;padding:10px 18px;border-radius:20px;font-size:14px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,.3);opacity:0;transition:opacity .3s;pointer-events:none;white-space:nowrap;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(function() { el.style.opacity = '0'; }, duration || 2600);
  }

  function quietFailToast(msg) {
    if (_failToastShown) return;
    _failToastShown = true;
    pwaToast(msg, 3000);
  }

  function getCurrentToken() {
    var TOKEN_KEY = (typeof Config !== 'undefined' && Config.AUTH && Config.AUTH.STORAGE_KEY)
      ? Config.AUTH.STORAGE_KEY
      : 'tree_staff_token';
    try {
      // token 改放 sessionStorage（與 AuthService 一致，XSS 洩漏面較小）
      var raw = window.sessionStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (data && data.token && data.until > Date.now()) return data.token;
    } catch (e) {}
    return null;
  }

  // ========== IndexedDB 操作（Promise 化） ==========
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function(resolve, reject) {
      var req = indexedDB.open(DB_NAME, 3);
      req.onupgradeneeded = function() {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('ts', 'ts', { unique: false });
        }
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
          db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error); };
    });
    return dbPromise;
  }

  // 通用交易包裝
  function txPromise(storeName, mode, callback) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(storeName, mode);
        var store = tx.objectStore(storeName);
        var result = callback(store, tx);
        tx.oncomplete = function() { resolve(result); };
        tx.onerror = function() { reject(tx.error); };
        tx.onabort = function() { reject(tx.error); };
      });
    });
  }

  function push(payload) {
    return txPromise(STORE, 'readwrite', function(store) {
      store.add({ payload: payload, ts: Date.now(), retry: 0 });
    });
  }

  function all() {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var store = tx.objectStore(STORE);
        var req = store.getAll();
        req.onsuccess = function() { resolve(req.result || []); };
        req.onerror = function() { reject(req.error); };
        // 不需要等待 tx.oncomplete，因為 getAll 已完成
      });
    });
  }

  function remove(id) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { reject(tx.error); };
      });
    });
  }

  function incrementRetry(id) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var store = tx.objectStore(STORE);
        var req = store.get(id);
        req.onsuccess = function() {
          var item = req.result;
          if (item) {
            item.retry = (item.retry || 0) + 1;
            store.put(item);
          }
        };
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { reject(tx.error); };
      });
    });
  }

  function cleanupExpired() {
    var cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    return all().then(function(items) {
      var expired = items.filter(function(it) { return it.ts < cutoff; });
      return Promise.all(expired.map(function(it) { return remove(it.id); }))
        .then(function() { return expired.length; });
    });
  }

  function getQueueCount() {
    return all().then(function(items) { return items.length; });
  }

  var OfflineQueue = {
    push: push,
    all: all,
    remove: remove,
    getQueueCount: getQueueCount,
    cleanupExpired: cleanupExpired
  };

  // ========== 快取（localStorage） ==========
  function buildCacheKey(action, params) {
    return action + (params ? '?' + JSON.stringify(params) : '');
  }

  function setCache(action, params, data) {
    try {
      var key = buildCacheKey(action, params);
      localStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify({ data: data, ts: Date.now() }));
    } catch (e) {}
  }

  function getCache(action, params) {
    try {
      var key = buildCacheKey(action, params);
      var raw = localStorage.getItem(CACHE_KEY_PREFIX + key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts > CACHE_MAX_AGE) {
        localStorage.removeItem(CACHE_KEY_PREFIX + key);
        return null;
      }
      return parsed.data;
    } catch (e) { return null; }
  }

  function clearCache(action) {
    if (action) {
      // 清除該 action 的所有快取（因為可能有多種 params）
      Object.keys(localStorage).forEach(function(k) {
        if (k.indexOf(CACHE_KEY_PREFIX + action) === 0) localStorage.removeItem(k);
      });
    } else {
      Object.keys(localStorage).forEach(function(k) {
        if (k.indexOf(CACHE_KEY_PREFIX) === 0) localStorage.removeItem(k);
      });
    }
  }

  // ========== 快照（IndexedDB snapshot store） ==========
  function snapSave(key, data) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
        tx.objectStore(SNAPSHOT_STORE).put({ key: key, data: data, ts: Date.now() });
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { reject(tx.error); };
      });
    });
  }

  function snapLoad(key) {
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        var req = db.transaction(SNAPSHOT_STORE, 'readonly').objectStore(SNAPSHOT_STORE).get(key);
        req.onsuccess = function() { resolve(req.result ? req.result.data : null); };
        req.onerror = function() { resolve(null); };
      });
    });
  }

  // ========== 暖機與同步 ==========
  function warmGAS() {
    if (Date.now() - _lastWarm < 5 * 60 * 1000) return;
    _lastWarm = Date.now();
    try {
      // 使用 no-cors 避免 CORS 錯誤，僅用於喚醒連線
      fetch(API_URL + '?action=ping', { method: 'GET', mode: 'no-cors' }).catch(function(){});
    } catch (e) {}
  }

  var _syncing = false;
  async function syncOutbox(force) {
    if (!navigator.onLine || _syncing) return;
    if (!force && Date.now() - _lastSyncAttempt < 60 * 1000) return;
    _lastSyncAttempt = Date.now();
    _syncing = true;

    try {
      await cleanupExpired();
      var items = await all();
      if (!items.length) return;

      console.log('🔄 [Sync] 佇列中有 ' + items.length + ' 筆記錄');

      var synced = 0;
      var failed = 0;
      var batch = items.slice(0, SYNC_BATCH_SIZE);

      for (var i = 0; i < batch.length; i++) {
        var item = batch[i];
        // 若 retry 超過上限，丟棄並記錄
        if (item.retry >= MAX_RETRY) {
          console.warn('🔄 [Sync] 記錄超過重試上限，丟棄:', item.id);
          await remove(item.id);
          failed++;
          continue;
        }

        // 附加最新 token
        var tk = getCurrentToken();
        if (tk) item.payload.token = tk;

        try {
          var res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(item.payload)
          });

          if (!res.ok) {
            console.warn('🔄 [Sync] 伺服器狀態 ' + res.status + '，稍後重試');
            quietFailToast('⏳ 後端不穩，記錄已安全排隊');
            await incrementRetry(item.id);
            failed++;
            continue; // 繼續處理下一筆，不阻塞
          }

          var json = await res.json();
          if (json && json.ok) {
            await remove(item.id);
            synced++;
          } else if (json && json.error === 'UNAUTHORIZED') {
            if (typeof AuthService !== 'undefined' && AuthService.promptAuth) {
              var reOk = await AuthService.promptAuth('🔐 登入已過期，請重新驗證以繼續同步');
              if (reOk) {
                // 重新驗證成功，重試同一筆（不增加 retry）
                i--; // 重試本筆
                continue;
              } else {
                failed++;
                continue;
              }
            } else {
              failed++;
              continue;
            }
          } else {
            // 業務錯誤：記錄錯誤並保留重試（但會受 MAX_RETRY 限制）
            console.warn('🔄 [Sync] 業務錯誤（保留重試）:', json && json.error);
            await incrementRetry(item.id);
            failed++;
            continue;
          }
        } catch (err) {
          // 網路錯誤
          console.warn('🔄 [Sync] 網絡不穩，稍後重試');
          quietFailToast('⏳ 網絡不穩，記錄已安全排隊');
          await incrementRetry(item.id);
          failed++;
          continue;
        }
      }

      console.log('🔄 [Sync] 完成：成功 ' + synced + ' 筆，失敗 ' + failed + ' 筆');

      if (synced > 0) {
        pwaToast('☁️ 已同步 ' + synced + ' 筆離線記錄', 3000);
        _failToastShown = false;
        clearCache();
        if (!_reloading) {
          _reloading = true;
          setTimeout(function() { location.reload(); }, 1500);
        }
      }
    } catch (err) {
      console.error('🔄 [Sync] 同步流程發生錯誤:', err);
    } finally {
      _syncing = false;
    }
  }

  async function syncNow() {
    if (!navigator.onLine) {
      pwaToast('📴 離線中，無法同步');
      return 0;
    }
    pwaToast('⏳ 正在同步…');
    await syncOutbox(true);
    var count = await getQueueCount();
    if (count === 0) pwaToast('✅ 已全部同步');
    return count;
  }

  // 寫入 outbox 前移除 token，確保敏感憑證唔會明文殘留喺 IndexedDB
  function stripToken(payload) {
    if (payload && typeof payload === 'object' && 'token' in payload) {
      delete payload.token;
    }
    return payload;
  }

  // ========== 攔截 ApiService ==========
  if (typeof ApiService !== 'undefined') {
    var origPost = ApiService.post;
    ApiService.post = async function(payload) {
      if (!navigator.onLine) {
        // 🔐 唔將 token 預先寫入 IndexedDB outbox，同步時先補（見 syncOutbox）
        await push(stripToken(payload));
        pwaToast('📥 離線暫存：有網路時自動上傳');
        return { ok: true, queued: true };
      }
      try {
        var result = await origPost(payload);
        if (result && result.ok) clearCache();
        return result;
      } catch (err) {
        // 檢查是否為網路錯誤或伺服器錯誤（5xx）
        var isNetworkError = (err instanceof TypeError) || !navigator.onLine || err.message === 'TIMEOUT';
        var isServerError = (err && err.status && err.status >= 500);
        if (isNetworkError || isServerError) {
          // 🔐 唔將 token 預先寫入 IndexedDB outbox，同步時先補（見 syncOutbox）
          await push(stripToken(payload));
          pwaToast('📥 網路不穩，已離線暫存');
          return { ok: true, queued: true };
        }
        throw err;
      }
    };

    var origGet = ApiService.get;
    ApiService.get = async function(action, params) {
      try {
        var result = await origGet(action, params);
        if (result && result.data) setCache(action, params, result.data);
        return result;
      } catch (err) {
        if (!navigator.onLine || err.message === 'OFFLINE' || err.message === 'TIMEOUT') {
          var cached = getCache(action, params);
          if (cached) return { data: cached, offline: true, stale: true };
          return { data: [], offline: true, stale: true };
        }
        throw err;
      }
    };

    ApiService.clearCache = clearCache;
  }

  // ========== 事件監聽 ==========
  window.addEventListener('offline', function() {
    pwaToast('📴 離線模式：可繼續巡查，記錄會暫存');
  });

  window.addEventListener('online', function() {
    warmGAS();
    setTimeout(function() { syncOutbox(true); }, 800);
  });

  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
      warmGAS();
      syncOutbox(false);
    }
  });

  setTimeout(warmGAS, 2000);

  // ========== 全域暴露 ==========
  window.OfflineQueue = OfflineQueue;
  window.pwaToast = pwaToast;
  window.syncOutbox = syncOutbox;
  window.syncNow = syncNow;
  window.warmGAS = warmGAS;
  window.TreeSnapshot = { save: snapSave, load: snapLoad };

  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    setTimeout(cleanupExpired, 3000);
  }
})();