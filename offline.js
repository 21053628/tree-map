/**
 * 樹木管理系統 - 離線寫入佇列 (IndexedDB Outbox)
 * v1.1.0 - 加入過期清理 + 重試上限 + 手動同步 + 統計 API
 */
(function() {
  'use strict';

  var API_URL = (window.Config && Config.API_ENDPOINT)
    ? Config.API_ENDPOINT
    : 'https://script.google.com/macros/s/AKfycby5Wby6nj8MPOdw5io10CakB877gY8qf3HKeckPz5MVb-to8QxUYfEH3pN_y-6hHvXj/exec';

  var DB_NAME = 'tree-offline';
  var STORE = 'outbox';
  var dbPromise = null;

  // 🔥 離線佇列配置
  var MAX_AGE_DAYS = 30;        // 超過 30 日嘅記錄自動清理
  var MAX_RETRY = 5;            // 同一筆記錄最多重試 5 次
  var SYNC_BATCH_SIZE = 10;     // 每次最多同步 10 筆（避免觸發 Google Apps Script 限流）

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function(resolve, reject) {
      var req = indexedDB.open(DB_NAME, 2); // 升版本以便加新欄位
      req.onupgradeneeded = function() {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('ts', 'ts', { unique: false });
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

  // 🔥 更新重試次數
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

  // 🔥 清理過期記錄（超過 MAX_AGE_DAYS）
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

  // 🔥 統計佇列數量（供 UI 顯示）
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

  /* ---------- 上線後自動同步佇列（改善版）---------- */
  var _syncing = false;
  async function syncOutbox() {
    if (!navigator.onLine || _syncing) return;
    _syncing = true;
    
    var items;
    try { 
      items = await all(); 
      await cleanupExpired(); // 順便清理過期
    } catch (e) { _syncing = false; return; }
    
    if (!items.length) { _syncing = false; return; }

    var synced = 0, failed = 0;
    var batch = items.slice(0, SYNC_BATCH_SIZE); // 只處理前 N 筆
    
    for (var i = 0; i < batch.length; i++) {
      var item = batch[i];
      try {
        var res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(item.payload)
        });
        var json = await res.json();
        
        if (json && json.ok) { 
          await remove(item.id); 
          synced++; 
        }
        else if (json && json.error === 'UNAUTHORIZED') {
          // Token 過期：嘗試重新認證
          if (window.AuthService && window.AuthService.promptAuth) {
            var reOk = await AuthService.promptAuth('🔐 登入已過期，請重新驗證以繼續同步');
            if (!reOk) {
              failed++;
              break; // 用戶取消就停止
            }
          } else { 
            failed++;
            break; 
          }
        }
        else { 
          // 業務邏輯錯誤（如資料重複）：移除避免永久卡住
          await remove(item.id); 
          failed++; 
        }
      } catch (e) { 
        // 網絡錯誤：遞增重試次數
        await incrementRetry(item.id);
        if ((item.retry || 0) >= MAX_RETRY) {
          await remove(item.id); // 重試太多次就放棄
          pwaToast('⚠️ 放棄 1 筆失敗記錄');
        }
        break; 
      }
    }

    _syncing = false;

    if (synced > 0) {
      pwaToast('☁️ 已同步 ' + synced + ' 筆離線記錄', 3000);
      if (window.ApiService && window.ApiService.clearCache) ApiService.clearCache();
      setTimeout(function() { location.reload(); }, 1500);
    } else if (failed > 0) {
      pwaToast('⚠️ 部分記錄同步失敗', 3000);
    }
  }

  /* ---------- 手動同步（供開發 / UI 呼叫） ---------- */
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

  /* ---------- 自動攔截 ApiService.post ---------- */
  if (typeof ApiService !== 'undefined') {
    var origPost = ApiService.post;
    ApiService.post = async function(payload) {
      if (!navigator.onLine) {
        await push(payload);
        pwaToast('📥 離線暫存：有網路時自動上傳');
        return { ok: true, queued: true };
      }
      try {
        return await origPost(payload);
      } catch (err) {
        if (err instanceof TypeError || !navigator.onLine) {
          await push(payload);
          pwaToast('📥 網路不穩，已離線暫存');
          return { ok: true, queued: true };
        }
        throw err;
      }
    };
  }

  window.addEventListener('offline', function() { pwaToast('📴 離線模式：可繼續巡查，記錄會暫存'); });
  window.addEventListener('online', function() { 
    pwaToast('🟢 已連線：正在同步…'); 
    setTimeout(syncOutbox, 800); // 等網絡穩定先
  });
  document.addEventListener('visibilitychange', function() { 
    if (!document.hidden) syncOutbox(); 
  });

  // 🔥 暴露 API
  window.OfflineQueue = OfflineQueue;
  window.pwaToast = pwaToast;
  window.syncOutbox = syncOutbox;
  window.syncNow = syncNow;
  
  // 啟動時清理過期記錄
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    setTimeout(cleanupExpired, 3000);
  }
})();