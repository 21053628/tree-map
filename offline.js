/**
 * 樹木管理系統 - 離線寫入佇列 (IndexedDB Outbox)
 * v1.0.2 - 修復 const 唔會掛上 window 嘅致命 bug
 */
(function() {
  'use strict';

  // 後備 API 端點（t.html 冇載入 config.js，所以要自帶後備）
  var API_URL = (window.Config && Config.API_ENDPOINT)
    ? Config.API_ENDPOINT
    : 'https://script.google.com/macros/s/AKfycby5Wby6nj8MPOdw5io10CakB877gY8qf3HKeckPz5MVb-to8QxUYfEH3pN_y-6hHvXj/exec';

  var DB_NAME = 'tree-offline';
  var STORE = 'outbox';
  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function(resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function() {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
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
        tx.objectStore(STORE).add({ payload: payload, ts: Date.now() });
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

  var OfflineQueue = { push: push, all: all, remove: remove };

  function pwaToast(msg) {
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
    el._t = setTimeout(function() { el.style.opacity = '0'; }, 2600);
  }

  /* ---------- 上線後自動同步佇列 ---------- */
  async function syncOutbox() {
    if (!navigator.onLine) return;
    var items;
    try { items = await all(); } catch (e) { return; }
    if (!items.length) return;

    var synced = 0;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      try {
        var res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(item.payload)
        });
        var json = await res.json();
        if (json && json.ok) { await remove(item.id); synced++; }
        else if (json && json.error === 'UNAUTHORIZED') {
          if (window.AuthService && window.AuthService.promptAuth) {
            var reOk = await AuthService.promptAuth();
            if (!reOk) break;
          } else { break; }
        }
        else { await remove(item.id); synced++; }
      } catch (e) { break; }
    }

    if (synced > 0) {
      pwaToast('☁️ 已同步 ' + synced + ' 筆離線記錄');
      if (window.ApiService) ApiService.clearCache();
      setTimeout(function() { location.reload(); }, 1200);
    }
  }

  /* ---------- 自動攔截 ApiService.post（index.html 專用）---------- */
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
          pwaToast('📥 離線暫存：有網路時自動上傳');
          return { ok: true, queued: true };
        }
        throw err;
      }
    };
  }

  window.addEventListener('offline', function() { pwaToast('📴 離線模式：可繼續巡查，記錄會暫存'); });
  window.addEventListener('online', function() { pwaToast('🟢 已連線：正在同步…'); syncOutbox(); });
  document.addEventListener('visibilitychange', function() { if (!document.hidden) syncOutbox(); });

  // 🔥 關鍵修正：const 唔會自動掛上 window，要手動暴露！
  window.OfflineQueue = OfflineQueue;
  window.pwaToast = pwaToast;
  window.syncOutbox = syncOutbox;
})();