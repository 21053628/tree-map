/**
 * 樹木管理系統 - 離線寫入佇列 (IndexedDB Outbox)
 * v1.6.0 - 完美配合 api.js v2.1：
 *          1. GET/POST 攔截器加入 TIMEOUT 處理（防止 GAS 極端冷啟動導致白屏或寫入失敗）
 *          2. 保留 v1.5.0 嘅 Local-first 快照功能
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

  // 🔥 [v1.5.0] 升級 DB 版本到 3，加入 snapshot store
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function(resolve, reject) {
      var req = indexedDB.open(DB_NAME, 3); // 版本升做 3
      req.onupgradeneeded = function() {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('ts', 'ts', { unique: false });
        }
        // 🔥 [v1.5.0] 新增快照 store
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
        tx.objectStore(STORE).add({ 
          payload: payload, 
          ts: Date.now(),
          retry: 0
        });
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
          if (item) {
            item.retry = (item.retry || 0) + 1;
            store.put(item);
          }
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
        .then(function() { 
          if (expired.length > 0) {
            console.log('🗑️ 已清理 ' + expired.length + ' 筆過期離線記錄');
          }
          return expired.length; 
        });
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
      localStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify({
        data: data,
        ts: Date.now()
      }));
    } catch (e) {
      console.warn('Cache set failed:', e);
    }
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
    } catch (e) {
      return null;
    }
  }

  function clearCache(key) {
    if (key) {
      localStorage.removeItem(CACHE_KEY_PREFIX + key);
    } else {
      Object.keys(localStorage).forEach(function(k) {
        if (k.indexOf(CACHE_KEY_PREFIX) === 0) {
          localStorage.removeItem(k);
        }
      });
    }
  }

  // 🔥 [v1.5.0] 本地快照 API (IndexedDB snapshot store)
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

  /* ---------- 上線後自動同步佇列（v1.4.0 增強版）---------- */
  var _syncing = false;
  async function syncOutbox() {
    if (!navigator.onLine || _syncing) return;
    _syncing = true;
    
    console.log('🔄 [Sync] 開始同步佇列...');
    
    var items;
    try { 
      items = await all(); 
      await cleanupExpired();
    } catch (e) { 
      console.error('🔄 [Sync] 讀取佇列失敗:', e);
      _syncing = false; 
      return; 
    }
    
    if (!items.length) { 
      console.log('🔄 [Sync] 佇列為空，跳過同步');
      _syncing = false; 
      return; 
    }

    console.log('🔄 [Sync] 佇列中有 ' + items.length + ' 筆記錄');

    var synced = 0, failed = 0;
    var batch = items.slice(0, SYNC_BATCH_SIZE);
    
    var i = 0;
    while (i < batch.length) {
      var item = batch[i];
      console.log('🔄 [Sync] 處理第 ' + (i + 1) + '/' + batch.length + ' 筆:', item.payload.type);

      var tk = getCurrentToken();
      if (tk) {
        item.payload.token = tk;
        console.log('🔄 [Sync] 已附加 token');
      } else {
        console.warn('🔄 [Sync] 無有效 token，嘗試繼續...');
      }

      try {
        var res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(item.payload)
        });
        var json = await res.json();
        
        if (json && json.ok) { 
          console.log('🔄 [Sync] ✅ 同步成功');
          await remove(item.id); 
          synced++; 
          i++;
        }
        else if (json && json.error === 'UNAUTHORIZED') {
          console.warn('🔄 [Sync] ⚠️ Token 無效，嘗試重新認證...');
          if (typeof AuthService !== 'undefined' && AuthService.promptAuth) {
            var reOk = await AuthService.promptAuth('🔐 登入已過期，請重新驗證以繼續同步');
            if (!reOk) {
              console.error('🔄 [Sync] ❌ 用戶取消認證');
              failed++;
              pwaToast('❌ 同步已取消：用戶未重新登入', 3000);
              break;
            }
            console.log('🔄 [Sync] ✅ 重新認證成功，重發當前記錄');
            // 唔 i++，下一圈用新 token 重發當前記錄
          } else { 
            console.error('🔄 [Sync] ❌ AuthService 不可用');
            failed++;
            pwaToast('❌ 同步失敗：無法重新認證', 3000);
            break; 
          }
        }
        else { 
          // 🔥 [v1.4.0] 業務邏輯錯誤：顯示具體錯誤信息
          var errMsg = (json && json.error) ? json.error : '未知錯誤';
          console.error('🔄 [Sync] ❌ 業務邏輯錯誤:', errMsg);
          console.error('🔄 [Sync] 完整響應:', json);
          
          pwaToast('❌ 同步失敗：' + errMsg, 4000);
          await remove(item.id); 
          failed++; 
          i++;
        }
      } catch (e) { 
        // 🔥 [v1.4.0] 網絡錯誤：顯示錯誤信息
        console.error('🔄 [Sync] ❌ 網絡錯誤:', e.message || e);
        console.error('🔄 [Sync] 完整錯誤:', e);
        
        pwaToast('❌ 網絡錯誤：' + (e.message || '連線失敗'), 4000);
        
        await incrementRetry(item.id);
        if ((item.retry || 0) >= MAX_RETRY) {
          await remove(item.id);
          console.warn('🔄 [Sync] ⚠️ 重試次數達上限，放棄此記錄');
          pwaToast('⚠️ 放棄 1 筆失敗記錄', 3000);
        }
        break; 
      }
    }

    _syncing = false;

    if (synced > 0) {
      console.log('🔄 [Sync] ✅ 同步完成：成功 ' + synced + ' 筆，失敗 ' + failed + ' 筆');
      pwaToast('☁️ 已同步 ' + synced + ' 筆離線記錄', 3000);
      clearCache();
      setTimeout(function() { location.reload(); }, 1500);
    } else if (failed > 0) {
      console.error('🔄 [Sync] ❌ 同步失敗：成功 ' + synced + ' 筆，失敗 ' + failed + ' 筆');
      if (synced === 0 && failed > 0) {
        // 如果全部失敗，顯示更明確的提示
        pwaToast('❌ 同步完全失敗：請檢查 Console', 4000);
      }
    }
  }

  /* ---------- 手動同步 ---------- */
  async function syncNow() {
    if (!navigator.onLine) {
      pwaToast('📴 離線中，無法同步');
      return 0;
    }
    pwaToast('⏳ 正在同步…');
    await syncOutbox();
    var count = await getQueueCount();
    if (count === 0) pwaToast('✅ 已全部同步');
    return count;
  }

  /* ---------- 自動攔截 ApiService ---------- */
  if (typeof ApiService !== 'undefined') {
    var origPost = ApiService.post;
    ApiService.post = async function(payload) {
      if (!navigator.onLine) {
        console.log('📥 [Offline] 離線模式：push 到佇列');
        await push(attachToken(payload));
        pwaToast('📥 離線暫存：有網路時自動上傳');
        return { ok: true, queued: true };
      }
      try {
        var result = await origPost(payload);
        if (result && result.ok) {
          clearCache();
        }
        return result;
      } catch (err) {
        console.warn('📥 [Offline] 網絡錯誤：push 到佇列', err.message);
        // 🔥 [v1.6.0] 加入 TIMEOUT：萬一 GAS 慢到連 30 秒都等唔到，寫入動作照樣入佇列
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
        if (result && result.data) {
          setCache(action, result.data);
        }
        return result;
      } catch (err) {
        // 🔥 [v1.6.0] 加入 TIMEOUT：就算 api.js 超時，都乖乖用 localStorage 快取顯示地圖
        if (!navigator.onLine || err.message === 'OFFLINE' || err.message === 'TIMEOUT') {
          var cached = getCache(action);
          if (cached) {
            console.log('📴 離線/超時模式：使用快取資料 (' + action + ')');
            return { data: cached, offline: true };
          }
          console.warn('📴 離線/超時模式：無快取，返回空陣列 (' + action + ')');
          return { data: [], offline: true };
        }
        throw err;
      }
    };

    ApiService.clearCache = clearCache;
  }

  window.addEventListener('offline', function() { pwaToast('📴 離線模式：可繼續巡查，記錄會暫存'); });
  window.addEventListener('online', function() { 
    pwaToast('🟢 已連線：正在同步…'); 
    setTimeout(syncOutbox, 800);
  });
  document.addEventListener('visibilitychange', function() { 
    if (!document.hidden) syncOutbox(); 
  });

  // 🔥 [v1.5.0] 暴露全域 API 俾 ES Module 同其他地方用
  window.OfflineQueue = OfflineQueue;
  window.pwaToast = pwaToast;
  window.syncOutbox = syncOutbox;
  window.syncNow = syncNow;
  window.TreeSnapshot = { save: snapSave, load: snapLoad }; // 本地快照 API
  
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    setTimeout(cleanupExpired, 3000);
  }
})();