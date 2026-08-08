/* 樹木管理系統 - 離線寫入佇列 (IndexedDB Outbox) v1.0.1 */
const OfflineQueue = (function() {
  'use strict';
  const DB_NAME = 'tree-offline';
  const STORE = 'outbox';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function(resolve, reject) {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function() {
        const db = req.result;
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
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).add({ payload: payload, ts: Date.now() });
        tx.oncomplete = resolve;
        tx.onerror = function() { reject(tx.error); };
      });
    });
  }

  function all() {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = function() { resolve(req.result || []); };
        req.onerror = function() { reject(req.error); };
      });
    });
  }

  function remove(id) {
    return openDB().then(function(db) {
      return new Promise(function(resolve) {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = resolve;
      });
    });
  }

  return { push: push, all: all, remove: remove };
})();

function pwaToast(msg) {
  let el = document.getElementById('pwaToast');
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

async function syncOutbox() {
  if (!navigator.onLine) return;
  const items = await OfflineQueue.all();
  if (!items.length) return;

  let synced = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const res = await fetch(Config.API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(item.payload)
      });
      const json = await res.json();
      if (json && json.ok) { await OfflineQueue.remove(item.id); synced++; }
      else if (json && json.error === 'UNAUTHORIZED') {
        const ok = await AuthService.promptAuth();
        if (!ok) break;
      } else { await OfflineQueue.remove(item.id); synced++; }
    } catch (e) { break; }
  }

  if (synced > 0) {
    pwaToast('☁️ 已同步 ' + synced + ' 筆離線記錄');
    if (window.ApiService) ApiService.clearCache();
    setTimeout(function() { location.reload(); }, 1200);
  }
}

/* ---------- 自動攔截 ApiService.post（index.html 用）---------- */
(function() {
  if (typeof ApiService === 'undefined') return;
  const origPost = ApiService.post;

  ApiService.post = async function(payload) {
    if (window.OfflineQueue && !navigator.onLine) {
      await OfflineQueue.push(payload);
      pwaToast('📥 離線暫存：有網路時自動上傳');
      return { ok: true, queued: true };
    }
    try {
      return await origPost(payload);
    } catch (err) {
      /* 🔥 修正：網絡層失敗（Failed to fetch）一律入佇列 */
      if (window.OfflineQueue && (err instanceof TypeError || !navigator.onLine)) {
        await OfflineQueue.push(payload);
        pwaToast('📥 離線暫存：有網路時自動上傳');
        return { ok: true, queued: true };
      }
      throw err;
    }
  };
})();

window.addEventListener('offline', function() { pwaToast('📴 離線模式：可繼續巡查'); });
window.addEventListener('online', function() { pwaToast('🟢 已連線：正在同步…'); syncOutbox(); });
document.addEventListener('visibilitychange', function() { if (!document.hidden) syncOutbox(); });