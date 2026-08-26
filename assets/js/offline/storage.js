/** IndexedDB persistence for the offline outbox and snapshots. */
import {
  DB_NAME, STORE, SNAPSHOT_STORE, MAX_AGE_DAYS, CACHE_MAX_AGE
} from './config.js';
import {
  SYNC_TAB_ID, broadcastSyncChange_, genUUID, pwaToast,
  validatePhotoPayloadOffline, auditWrite
} from './utils.js';
import {
  OUTBOX_STATUSES, OUTBOX_LEASE_MS, isOutboxPending, canClaimOutboxItem
} from '../core/outbox-policy.js';

let dbPromise = null;
let syncTrigger = null;
export function setSyncTrigger(trigger) { syncTrigger = trigger; }
  // 相容舊 queue items：讀取時自動補齊缺少的欄位（不會無故丟失）
  function normalize(item) {
    if (!item) return item;
    var now = Date.now();
    var p = item.payload || {};
    // 清理 Phase 2 之前可能已存在於 IndexedDB 的敏感欄位。
    if (p && typeof p === 'object') {
      if ('token' in p) delete p.token;
      if ('csrf_token' in p) delete p.csrf_token;
      if ('password' in p) delete p.password;
    }
    if (!item.client_id) item.client_id = p.client_id || genUUID();
    if (!item.type) item.type = p.type || 'unknown';
    if (item.tree_id === undefined || item.tree_id === null) item.tree_id = (p.tree_id || p.treeId) || null;
    if (item.project_id === undefined || item.project_id === null) item.project_id = (p.project_id || p.prj) || null;
    if (!item.status) item.status = 'queued';
    if (!item.createdAt) item.createdAt = item.ts || now;
    if (!item.updatedAt) item.updatedAt = item.ts || now;
    if (item.syncedAt === undefined) item.syncedAt = null;
    if (item.retry === undefined || item.retry === null) item.retry = 0;
    if (item.lastError === undefined) item.lastError = null;
    if (item.syncingAt === undefined) item.syncingAt = null;
    if (item.syncOwner === undefined) item.syncOwner = null;
    item.status = item.status === OUTBOX_STATUSES.SYNCING
      ? OUTBOX_STATUSES.SYNCING
      : (item.status === OUTBOX_STATUSES.SYNCED
        ? OUTBOX_STATUSES.SYNCED
        : (item.status === OUTBOX_STATUSES.FAILED ? OUTBOX_STATUSES.FAILED : OUTBOX_STATUSES.QUEUED));
    return item;
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
    // 📷 先做圖片限制檢查，避免髒資料進入 IndexedDB 佇列（與後端一致）
    var vErr = validatePhotoPayloadOffline(payload);
    if (vErr) {
      pwaToast('⚠️ ' + vErr, 4000);
      return Promise.reject(new Error(vErr));
    }
    // 🔥 [P0 修復] 寫入前檢查 IndexedDB 儲存配額：若可用空間 < 5MB 則拒絕佇列，避免 QuotaExceededError
    return checkStorageQuota_().then(function(hasQuota) {
      if (!hasQuota) {
        pwaToast('⚠️ 儲存空間不足，無法離線暫存', 5000);
        return Promise.reject(new Error('STORAGE_QUOTA_EXCEEDED'));
      }
      return doPush_(payload);
    });
  }

  // 🔥 [P0 修復] 檢查 IndexedDB 剩餘儲存配額
  function checkStorageQuota_() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate().then(function(est) {
          if (est && est.quota && est.usage !== undefined) {
            var remaining = est.quota - est.usage;
            return remaining >= 5 * 1024 * 1024; // 最少保留 5MB
          }
          return true;
        }).catch(function() { return true; });
      }
    } catch (e) { /* intentionally ignored: optional fallback failure */ }
    return Promise.resolve(true);
  }

  function doPush_(payload) {
    // 強制脫敏：任何呼叫路徑寫入 IndexedDB 前一律移除認證及密碼欄位。
    // 使用淺拷貝避免污染呼叫方原始物件；同步時只從 AuthService / sessionStorage 重新補上最新憑證。
    var src = payload || {};
    var safe = {};
    try {
      Object.keys(src).forEach(function(k) { safe[k] = src[k]; });
    } catch (e) {
      // Object.keys 極端情況下失敗，用 Object.assign 兜底（不污染原物件）
      try { safe = Object.assign({}, src); } catch (e2) { safe = {}; }
    }
    if (safe && typeof safe === 'object') {
      if ('token' in safe) delete safe.token;
      if ('csrf_token' in safe) delete safe.csrf_token;
      if ('password' in safe) delete safe.password;
    }
    payload = safe;
    var now = Date.now();
    // 確保 payload 帶有 client_id（idempotency key），離線／重試都保持同一個 id
    if (!payload.client_id) payload.client_id = genUUID();
    if (!payload.client_created_at) payload.client_created_at = new Date().toISOString();
    auditWrite(payload, 'queue', 'queued');
    return txPromise(STORE, 'readwrite', function(store) {
      store.add({
        payload: payload,
        ts: now,
        client_id: payload.client_id,
        type: payload.type || 'unknown',
        tree_id: (payload.tree_id || payload.treeId) || null,
        project_id: (payload.project_id || payload.prj) || null,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
        syncedAt: null,
        retry: 0,
        lastError: null,
        syncingAt: null,
        syncOwner: null
      });
    }).then(function(result) {
      broadcastSyncChange_('item-queued', null);
      return result;
    });
  }

  function all() {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        // 使用 readwrite，讓舊版本記錄的敏感欄位在讀取時同步清除並持久化。
        var tx = db.transaction(STORE, 'readwrite');
        var store = tx.objectStore(STORE);
        var req = store.getAll();
        req.onsuccess = function() {
          var rawItems = req.result || [];
          var needsCleanup = rawItems.map(function(item) {
            var payload = item && item.payload;
            return !!(payload && typeof payload === 'object'
              && ('token' in payload || 'csrf_token' in payload || 'password' in payload));
          });
          var items = rawItems.map(normalize);
          for (var i = 0; i < rawItems.length; i++) {
            if (needsCleanup[i]) store.put(items[i]);
          }
          tx.oncomplete = function() { resolve(items); };
        };
        req.onerror = function() { reject(req.error); };
        tx.onerror = function() { reject(tx.error); };
        tx.onabort = function() { reject(tx.error); };
      });
    });
  }

  function remove(id) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function() { broadcastSyncChange_('item-removed', id); resolve(); };
        tx.onerror = function() { reject(tx.error); };
      });
    });
  }

  // 讀寫單筆：讀出 → 正規化 → 套用 changes/mutator → 寫回（並更新 updatedAt）
  function updateItem(id, changes, mutator, expectedOwner) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var store = tx.objectStore(STORE);
        var updated = false;
        var req = store.get(id);
        req.onsuccess = function() {
          var item = normalize(req.result);
          if (item && (!expectedOwner || item.syncOwner === expectedOwner)) {
            if (changes) {
              Object.keys(changes).forEach(function(k) { item[k] = changes[k]; });
            }
            if (mutator) mutator(item);
            item.updatedAt = Date.now();
            store.put(item);
            updated = true;
          }
        };
        tx.oncomplete = function() {
          if (updated) broadcastSyncChange_('item-updated', id);
          resolve(updated);
        };
        tx.onerror = function() { reject(tx.error); };
      });
    });
  }

  // 在同一個 readwrite transaction 重新讀取並 claim，防止跨分頁同時送出同一筆。
  function claimItem(id) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var store = tx.objectStore(STORE);
        var claimed = null;
        var now = Date.now();
        var req = store.get(id);
        req.onsuccess = function() {
          var item = normalize(req.result);
          if (!item || !canClaimOutboxItem(item, SYNC_TAB_ID, now, OUTBOX_LEASE_MS)) return;
          item.status = OUTBOX_STATUSES.SYNCING;
          item.syncingAt = now;
          item.syncOwner = SYNC_TAB_ID;
          item.updatedAt = now;
          store.put(item);
          claimed = item;
        };
        tx.oncomplete = function() {
          if (claimed) broadcastSyncChange_('item-claimed', id);
          resolve(claimed);
        };
        tx.onerror = function() { reject(tx.error); };
        tx.onabort = function() { reject(tx.error); };
      });
    });
  }

  function getById(id) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        req.onsuccess = function() { resolve(normalize(req.result || null)); };
        req.onerror = function() { reject(req.error); };
      });
    });
  }

  // 增加重試次數，並記錄最後錯誤（狀態維持 queued，仍可重試）
  function incrementRetry(id, error, expectedOwner) {
    return updateItem(id, null, function(item) {
      item.retry = (item.retry || 0) + 1;
      if (error) item.lastError = String(error);
      item.status = OUTBOX_STATUSES.QUEUED;
      item.syncingAt = null;
      item.syncOwner = null;
    }, expectedOwner);
  }

  function markSyncing(id) {
    return updateItem(id, { status: OUTBOX_STATUSES.SYNCING, syncingAt: Date.now(), syncOwner: SYNC_TAB_ID });
  }
  function markSynced(id) {
    return updateItem(id, { status: OUTBOX_STATUSES.SYNCED, syncedAt: Date.now(), lastError: null, syncingAt: null, syncOwner: null }, null, SYNC_TAB_ID);
  }
  function markFailed(id, error) {
    return updateItem(id, { status: OUTBOX_STATUSES.FAILED, lastError: String(error || '未知錯誤'), syncingAt: null, syncOwner: null }, null, SYNC_TAB_ID);
  }

  function getPendingCount() {
    return all().then(function(items) {
      return items.filter(isOutboxPending).length;
    });
  }

  function getFailedCount() {
    return all().then(function(items) {
      return items.filter(function(it) { return it.status === 'failed'; }).length;
    });
  }

  async function retryOne(id) {
    var item = await getById(id);
    if (!item) return { ok: false, error: '記錄不存在' };
    await updateItem(id, { status: OUTBOX_STATUSES.QUEUED, retry: 0, lastError: null, syncingAt: null, syncOwner: null });
    if (navigator.onLine && syncTrigger) syncTrigger(true);
    return { ok: true };
  }

  async function retryAllFailed() {
    var items = await all();
    var failedItems = items.filter(function(it) { return it.status === 'failed'; });
    for (var i = 0; i < failedItems.length; i++) {
      await updateItem(failedItems[i].id, { status: OUTBOX_STATUSES.QUEUED, retry: 0, lastError: null, syncingAt: null, syncOwner: null });
    }
    if (failedItems.length && navigator.onLine && syncTrigger) syncTrigger(true);
    return failedItems.length;
  }

  // 只清理「已同步(synced)且過期」的記錄；pending/failed 一律保留，不會無故刪除
  function cleanupExpired() {
    var cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    return all().then(function(items) {
      var expired = items.filter(function(it) {
        if (it.status !== 'synced') return false;
        var age = it.syncedAt || it.ts || 0;
        return age < cutoff;
      });
      return Promise.all(expired.map(function(it) { return remove(it.id); }))
        .then(function() { return expired.length; });
    });
  }

  // 全部記錄總數（含 synced/failed），向後相容；「待同步」請用 getPendingCount
  function getQueueCount() {
    return all().then(function(items) { return items.length; });
  }

  var OfflineQueue = {
    push: push,
    all: all,
    remove: remove,
    getById: getById,
    getQueueCount: getQueueCount,
    getPendingCount: getPendingCount,
    getFailedCount: getFailedCount,
    markSyncing: markSyncing,
    markSynced: markSynced,
    markFailed: markFailed,
    retryOne: retryOne,
    retryAllFailed: retryAllFailed,
    cleanupExpired: cleanupExpired
  };
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

function snapRemove(key) {
  return openDB().then(function(db) {
    return new Promise(function(resolve) {
      var tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
      tx.objectStore(SNAPSHOT_STORE).delete(key);
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function() { resolve(); };
    });
  });
}

function snapLoad(key) {
  return openDB().then(function(db) {
    return new Promise(function(resolve) {
      var req = db.transaction(SNAPSHOT_STORE, 'readonly').objectStore(SNAPSHOT_STORE).get(key);
      req.onsuccess = function() {
        var result = req.result;
        if (!result) { resolve(null); return; }
        if (Date.now() - (result.ts || 0) > CACHE_MAX_AGE) {
          try {
            var delTx = db.transaction(SNAPSHOT_STORE, 'readwrite');
            delTx.objectStore(SNAPSHOT_STORE).delete(key);
          } catch (e) { /* intentionally ignored: optional fallback failure */ }
          resolve(null);
          return;
        }
        resolve(result.data);
      };
      req.onerror = function() { resolve(null); };
    });
  });
}
export {
  openDB,
  txPromise,
  push,
  all,
  remove,
  getById,
  updateItem,
  claimItem,
  incrementRetry,
  markSyncing,
  markSynced,
  markFailed,
  getPendingCount,
  getFailedCount,
  retryOne,
  retryAllFailed,
  cleanupExpired,
  getQueueCount,
  snapSave,
  snapLoad,
  snapRemove,
  OfflineQueue
};


