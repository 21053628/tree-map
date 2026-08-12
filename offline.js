/**
 * 樹木管理系統 - 離線寫入佇列 (IndexedDB Outbox)
 * v1.8.0 - 安靜模式：warmGAS 節流(5分鐘)、同步節流(60秒)、
 *          伺服器 404/5xx 靜默排隊、toast 每 session 一次
 */
(function() {
  'use strict';

  var API_URL = (typeof Config !== 'undefined' && Config.API_ENDPOINT)
    ? Config.API_ENDPOINT
    : 'https://script.google.com/macros/s/AKfycby5Wby6nj8MPOdw5io10CakB877gY8qf3HKeckPz5MVb-to8QxUYfEH3pN_y-6hHvXj/exec';

  var DB_NAME = 'tree-offline';
  var STORE = 'outbox';
  var dbPromise = null;

  var MAX_AGE_DAYS = 30;
  var MAX_RETRY = 5;
  var SYNC_BATCH_SIZE = 10;

  var CACHE_KEY_PREFIX = 'tree_cache_';
  var CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

  // 🔥 [v1.8] 節流時間戳
  var _lastWarm = 0;
  var _lastSyncAttempt = 0;
  var _failToastShown = false;
  var _reloading = false;

  // 🔥 [v1.8] 暖機：5 分鐘一次，失敗完全靜默
  function warmGAS() {
    if (Date.now() - _lastWarm < 5 * 60 * 1000) return;
    _lastWarm = Date.now();
    try {
      fetch(API_URL + '?action=ping', { method: 'GET' }).catch(function(){});
    } catch (e) {}
  }

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
        if (!db.objectStoreNames.contains('snapshot')) {
          db.createObjectStore('snapshot', { keyPath: 'key' });
        }
      };
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error); };
    });
    return dbPromise;
  }

  function push(payload) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).add({ payload: payload, ts: Date.now(), retry: 0 });
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { reject(tx.error); };
      });
    });
  }

  function all() {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = function() { resolve(req.result || []); };
        req.onerror = function() { reject(req.error); };
      });
    });
  }

  function remove(id) {
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function() { resolve(); };
      });
    });
  }

  function incrementRetry(id) {
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        var tx = db.transaction(STORE, 'readwrite');
        var store = tx.objectStore(STORE);
        var req = store.get(id);
        req.onsuccess = function() {
          var item = req.result;
          if (item) { item.retry = (item.retry || 0) + 1; store.put(item); }
          tx.oncomplete = function() { resolve(); };
        };
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

  var OfflineQueue = { push: push, all: all, remove: remove, getQueueCount: getQueueCount, cleanupExpired: cleanupExpired };

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

  // 🔥 [v1.8] 失敗 toast 每 session 只彈一次
  function quietFailToast(msg) {
    if (_failToastShown) return;
    _failToastShown = true;
    pwaToast(msg, 3000);
  }

  function getCurrentToken() {
    try {
      var raw = localStorage.getItem('tree_staff_token');
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (data && data.token && data.until > Date.now()) return data.token;
    } catch (e) {}
    return null;
  }

  function attachToken(payload) {
    if (!payload) payload = {};
    var tk = getCurrentToken();
    if (tk) payload.token = tk;
    return payload;
  }

  function setCache(key, data) {
    try {
      localStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify({ data: data, ts: Date.now() }));
    } catch (e) {}
  }

  function getCache(key) {
    try {
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

  function clearCache(key) {
    if (key) { localStorage.removeItem(CACHE_KEY_PREFIX + key); }
    else {
      Object.keys(localStorage).forEach(function(k) {
        if (k.indexOf(CACHE_KEY_PREFIX) === 0) localStorage.removeItem(k);
      });
    }
  }

  function snapSave(key, data) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction('snapshot', 'readwrite');
        tx.objectStore('snapshot').put({ key: key, data: data, ts: Date.now() });
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { reject(tx.error); };
      });
    });
  }

  function snapLoad(key) {
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        var req = db.transaction('snapshot', 'readonly').objectStore('snapshot').get(key);
        req.onsuccess = function() { resolve(req.result ? req.result.data : null); };
        req.onerror = function() { resolve(null); };
      });
    });
  }

  /* ---------- 同步佇列（v1.8 安靜版）---------- */
  var _syncing = false;
  async function syncOutbox(force) {
    if (!navigator.onLine || _syncing) return;
    // 🔥 [v1.8] 自動觸發節流 60 秒（手動 syncNow 豁免）
    if (!force && Date.now() - _lastSyncAttempt < 60 * 1000) return;
    _lastSyncAttempt = Date.now();
    _syncing = true;

    var items;
    try { items = await all(); await cleanupExpired(); }
    catch (e) { _syncing = false; return; }

    if (!items.length) { _syncing = false; return; }

    console.log('🔄 [Sync] 佇列中有 ' + items.length + ' 筆記錄');

    var synced = 0, failed = 0;
    var batch = items.slice(0, SYNC_BATCH_SIZE);
    var i = 0;
    while (i < batch.length) {
      var item = batch[i];
      var tk = getCurrentToken();
      if (tk) item.payload.token = tk;

      try {
        var res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(item.payload)
        });

        // 🔥 [v1.8] HTTP 4xx/5xx = 伺服器不穩，靜默排隊等陣
        if (!res.ok) {
          console.warn('🔄 [Sync] 伺服器狀態 ' + res.status + '，稍後重試');
          quietFailToast('⏳ 後端不穩，記錄已安全排隊');
          await incrementRetry(item.id);
          break;
        }

        var json = await res.json();
        if (json && json.ok) { await remove(item.id); synced++; i++; }
        else if (json && json.error === 'UNAUTHORIZED') {
          if (typeof AuthService !== 'undefined' && AuthService.promptAuth) {
            var reOk = await AuthService.promptAuth('🔐 登入已過期，請重新驗證以繼續同步');
            if (!reOk) { failed++; break; }
          } else { failed++; break; }
        }
        else {
          console.warn('🔄 [Sync] 業務錯誤:', json && json.error);
          await remove(item.id); failed++; i++;
        }
      } catch (e) {
        // 🔥 [v1.8] 網絡錯誤：靜默重試，唔再刷紅字
        console.warn('🔄 [Sync] 網絡不穩，稍後重試');
        quietFailToast('⏳ 網絡不穩，記錄已安全排隊');
        await incrementRetry(item.id);
        break;
      }
    }

    _syncing = false;

    if (synced > 0) {
      console.log('🔄 [Sync] ✅ 同步 ' + synced + ' 筆');
      pwaToast('☁️ 已同步 ' + synced + ' 筆離線記錄', 3000);
      _failToastShown = false;
      clearCache();
      if (!_reloading) { _reloading = true; setTimeout(function() { location.reload(); }, 1500); }
    }
  }

  async function syncNow() {
    if (!navigator.onLine) { pwaToast('📴 離線中，無法同步'); return 0; }
    pwaToast('⏳ 正在同步…');
    await syncOutbox(true);
    var count = await getQueueCount();
    if (count === 0) pwaToast('✅ 已全部同步');
    return count;
  }

  /* ---------- 攔截 ApiService ---------- */
  if (typeof ApiService !== 'undefined') {
    var origPost = ApiService.post;
    ApiService.post = async function(payload) {
      if (!navigator.onLine) {
        await push(attachToken(payload));
        pwaToast('📥 離線暫存：有網路時自動上傳');
        return { ok: true, queued: true };
      }
      try {
        var result = await origPost(payload);
        if (result && result.ok) clearCache();
        return result;
      } catch (err) {
        if (err instanceof TypeError || !navigator.onLine || err.message === 'TIMEOUT') {
          await push(attachToken(payload));
          pwaToast('📥 網路不穩，已離線暫存');
          return { ok: true, queued: true };
        }
        throw err;
      }
    };

    var origGet = ApiService.get;
    ApiService.get = async function(action) {
      try {
        var result = await origGet(action);
        if (result && result.data) setCache(action, result.data);
        return result;
      } catch (err) {
        if (!navigator.onLine || err.message === 'OFFLINE' || err.message === 'TIMEOUT') {
          var cached = getCache(action);
          if (cached) return { data: cached, offline: true, stale: true };
          return { data: [], offline: true, stale: true };
        }
        throw err;
      }
    };

    ApiService.clearCache = clearCache;
  }

  window.addEventListener('offline', function() { pwaToast('📴 離線模式：可繼續巡查，記錄會暫存'); });
  window.addEventListener('online', function() { warmGAS(); setTimeout(function(){ syncOutbox(true); }, 800); });
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) { warmGAS(); syncOutbox(false); }
  });

  setTimeout(warmGAS, 2000);

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