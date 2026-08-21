/**
 * 樹木管理系統 - 離線寫入佇列 (IndexedDB Outbox)
 * v2.0.0 - Phase 1：outbox 資料結構升級（可追蹤、不會無故消失）
 *   - 每筆記錄加入 client_id/uuid、type、tree_id、project_id、status、時間戳、lastError
 *   - MAX_RETRY 超過後不再丟棄，改為 status='failed' 並保留
 *   - 新增 helpers：getPendingCount/getFailedCount/markSyncing/markSynced/markFailed/retryOne/retryAllFailed
 *   - 相容舊 queue items（讀取時自動補齊欄位）
 *   - cleanupExpired 只清理已同步(synced)且過期記錄，不再刪除 pending/failed
 *   - 保留既有：修正 IndexedDB 交易 Promise 包裝、逐筆同步、warmGAS no-cors、finally 重置 _syncing
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

  // [Phase6] 本地審計記錄（若有載入 audit-log.js）
  function auditWrite(payload, action, status, error) {
    if (typeof window === 'undefined' || !window.AuditLog) return;
    var p = payload || {};
    try {
      window.AuditLog.log({
        action: action,
        type: p.type || null,
        tree_id: p.tree_id || p.treeId || null,
        project_id: p.project_id || p.prj || null,
        staff: p.staff || null,
        status: status,
        error: error || null
      });
    } catch (e) {}
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

  // 產生 UUID（idempotency key）。優先 crypto.randomUUID，非安全環境 fallback。
  function genUUID() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = (c === 'x') ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  }

  // 相容舊 queue items：讀取時自動補齊缺少的欄位（不會無故丟失）
  function normalize(item) {
    if (!item) return item;
    var now = Date.now();
    var p = item.payload || {};
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
    payload = payload || {};
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
        lastError: null
      });
    });
  }

  function all() {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var store = tx.objectStore(STORE);
        var req = store.getAll();
        req.onsuccess = function() {
          var items = (req.result || []).map(normalize);
          resolve(items);
        };
        req.onerror = function() { reject(req.error); };
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

  // 讀寫單筆：讀出 → 正規化 → 套用 changes/mutator → 寫回（並更新 updatedAt）
  function updateItem(id, changes, mutator) {
    return openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        var store = tx.objectStore(STORE);
        var req = store.get(id);
        req.onsuccess = function() {
          var item = normalize(req.result);
          if (item) {
            if (changes) {
              Object.keys(changes).forEach(function(k) { item[k] = changes[k]; });
            }
            if (mutator) mutator(item);
            item.updatedAt = Date.now();
            store.put(item);
          }
        };
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function() { reject(tx.error); };
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
  function incrementRetry(id, error) {
    return updateItem(id, null, function(item) {
      item.retry = (item.retry || 0) + 1;
      if (error) item.lastError = String(error);
      item.status = 'queued';
    });
  }

  function markSyncing(id) { return updateItem(id, { status: 'syncing' }); }
  function markSynced(id)  { return updateItem(id, { status: 'synced', syncedAt: Date.now(), lastError: null }); }
  function markFailed(id, error) { return updateItem(id, { status: 'failed', lastError: String(error || '未知錯誤') }); }

  function getPendingCount() {
    return all().then(function(items) {
      return items.filter(function(it) {
        return it.status === 'queued' || it.status === 'syncing';
      }).length;
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
    await updateItem(id, { status: 'queued', retry: 0, lastError: null });
    if (navigator.onLine) syncOutbox(true);
    return { ok: true };
  }

  async function retryAllFailed() {
    var items = await all();
    var failedItems = items.filter(function(it) { return it.status === 'failed'; });
    for (var i = 0; i < failedItems.length; i++) {
      await updateItem(failedItems[i].id, { status: 'queued', retry: 0, lastError: null });
    }
    if (failedItems.length && navigator.onLine) syncOutbox(true);
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
  var _syncPromise = null;

  // 所有入口共用同一個 Promise，避免 online、visibilitychange、輪詢及手動按鈕
  // 同時啟動多條同步連線。同步仍維持佇列順序，確保 inspection/photo 依賴不被打亂。
  function syncOutbox(force) {
    if (!navigator.onLine) return Promise.resolve(0);
    if (_syncPromise) return _syncPromise;
    if (!force && Date.now() - _lastSyncAttempt < 60 * 1000) return Promise.resolve(0);

    _syncPromise = runSyncOutbox(force).finally(function() {
      _syncPromise = null;
    });
    return _syncPromise;
  }

  async function runSyncOutbox(force) {
    if (!navigator.onLine || _syncing) return 0;
    if (!force && Date.now() - _lastSyncAttempt < 60 * 1000) return 0;
    _lastSyncAttempt = Date.now();
    _syncing = true;

    try {
      // 過期記錄清理已由背景排程處理；不要在前景同步熱路徑掃描整個 outbox。
      var items = await all();
      // 只處理「待同步」記錄（queued/syncing）；synced/failed 不會自動重送
      var pending = items.filter(function(it) {
        return it.status === 'queued' || it.status === 'syncing';
      });
      if (!pending.length) return;

      console.log('🔄 [Sync] 待同步 ' + pending.length + ' 筆（總共 ' + items.length + ' 筆）');

      var synced = 0;
      var failed = 0;
      var batch = pending.slice(0, SYNC_BATCH_SIZE);

      for (var i = 0; i < batch.length; i++) {
        var item = batch[i];

        // 若 retry 超過上限：改為 status='failed' 並保留，等待用戶手動重試／匯出（不再丟棄）
        if (item.retry >= MAX_RETRY) {
          console.warn('🔄 [Sync] 記錄超過重試上限，標記為 failed（保留）:', item.id);
          await markFailed(item.id, '超過重試上限(' + MAX_RETRY + '次)');
          auditWrite(item.payload, 'sync', 'failed', '超過重試上限(' + MAX_RETRY + '次)');
          failed++;
          continue;
        }

        // 不在送出前額外開 IndexedDB 交易標記 syncing。
        // 請求失敗會保留 queued；頁面中斷時由 queued 狀態安全重試。
        var tk = getCurrentToken();
        if (tk) item.payload.token = tk;
        if (typeof AuthService !== 'undefined' && AuthService.getCsrfToken) {
          var csrfTk = AuthService.getCsrfToken();
          if (csrfTk) item.payload.csrf_token = csrfTk;
        }

        try {
          var res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(item.payload)
          });

          var json;
          try {
            if (typeof ApiService !== 'undefined' && ApiService.parseResponse) {
              // 無論 HTTP 狀態為何都先交給共用 parser，保留 404/403/HTML 的完整原因。
              json = await ApiService.parseResponse(res, 'POST offline sync');
            } else {
              var responseBody = await res.text();
              try {
                json = responseBody ? JSON.parse(responseBody) : null;
              } catch (parseError) {
                throw new Error('同步回應不是有效 JSON，請確認 GAS 使用正式 /exec 部署網址。');
              }
              if (!res.ok) throw new Error('HTTP ' + res.status);
            }
          } catch (responseError) {
            var responseStatus = responseError.status || res.status;
            var permanentApiError = responseError.noRetry ||
              responseStatus === 401 || responseStatus === 403 || responseStatus === 404;
            var responseMessage = responseError.message || ('HTTP ' + responseStatus);

            if (permanentApiError) {
              console.error('🔄 [Sync] API 部署或權限錯誤，停止自動重試:', responseMessage);
              await markFailed(item.id, responseMessage);
              auditWrite(item.payload, 'sync', 'failed', responseMessage);
              failed++;
              continue;
            }

            console.warn('🔄 [Sync] 伺服器狀態/格式錯誤，稍後重試:', responseMessage);
            quietFailToast('⏳ 後端不穩，記錄已安全排隊');
            await incrementRetry(item.id, responseMessage);
            auditWrite(item.payload, 'sync', 'retry', responseMessage);
            failed++;
            continue;
          }
          if (json && (json.ok || json.duplicate === true)) {
            // 成功／後端回報重複（同一 client_id 已處理）：都視為成功
            if (json.duplicate === true) {
              console.log('🔄 [Sync] 後端回報重複（client_id 已處理），視為成功:', item.id);
            }
            await markSynced(item.id);
            auditWrite(item.payload, 'sync', 'synced');
            synced++;
          } else if (json && (json.error === 'UNAUTHORIZED' || json.error === 'CSRF_TOKEN_INVALID')) {
            // 登入／CSRF 過期：清除舊狀態、重新驗證後重試同一筆
            auditWrite(item.payload, 'sync', 'unauthorized', json.error);
            await updateItem(item.id, { status: 'queued', lastError: '登入已過期' });
              if (typeof AuthService !== 'undefined' &&
                  (AuthService.reauthenticate || AuthService.promptAuth)) {
                // 與前景 ApiService 共用重新登入 promise，避免同步流程
                // logout()/promptAuth() 互相競爭並清除剛取得的新 token。
                var reOk = AuthService.reauthenticate
                  ? await AuthService.reauthenticate('🔐 登入已過期，請重新輸入工作人員密碼以繼續同步')
                  : await AuthService.promptAuth('🔐 登入已過期，請重新輸入工作人員密碼以繼續同步');
                if (reOk) {
                  // 重新驗證成功，下一輪會重新注入 token 和 CSRF token。
                  i--;
                  continue;
                }
              }
            failed++;
            continue;
          } else {
            // 業務錯誤：記錄錯誤並保留重試（但會受 MAX_RETRY 限制）
            console.warn('🔄 [Sync] 業務錯誤（保留重試）:', json && json.error);
            await incrementRetry(item.id, (json && json.error) || '業務錯誤');
            auditWrite(item.payload, 'sync', 'error', (json && json.error) || '業務錯誤');
            failed++;
            continue;
          }
        } catch (err) {
          // 網路錯誤
          console.warn('🔄 [Sync] 網絡不穩，稍後重試');
          quietFailToast('⏳ 網絡不穩，記錄已安全排隊');
          await incrementRetry(item.id, (err && err.message) || '網絡不穩');
          auditWrite(item.payload, 'sync', 'retry', (err && err.message) || '網絡不穩');
          failed++;
          continue;
        }
      }

      console.log('🔄 [Sync] 完成：成功 ' + synced + ' 筆，失敗 ' + failed + ' 筆');

      if (synced > 0) {
        pwaToast('☁️ 已同步 ' + synced + ' 筆離線記錄', 3000);
        _failToastShown = false;
        // 背景同步完成後不要強制重新載入，避免瀏覽期間被中斷。
        // 使用者可繼續操作；資料會在下一次正常讀取時更新。
        clearCache();
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
    var count = await getPendingCount();
    if (count === 0) pwaToast('✅ 已全部同步');
    return count;
  }

  // 寫入 outbox 前移除 token + csrf_token，確保敏感憑證不會明文殘留在 IndexedDB
  // （同步時 syncOutbox 會從 AuthService 重新補上兩者）
  function stripToken(payload) {
    if (payload && typeof payload === 'object') {
      if ('token' in payload) delete payload.token;
      if ('csrf_token' in payload) delete payload.csrf_token;
    }
    return payload;
  }

  // ========== 攔截 ApiService ==========
  if (typeof ApiService !== 'undefined') {
    var origPost = ApiService.post;
    ApiService.post = async function(payload) {
      if (!navigator.onLine) {
        // 🔐 不將 token 預先寫入 IndexedDB outbox，同步時先補（見 syncOutbox）
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
          // 🔐 不將 token 預先寫入 IndexedDB outbox，同步時先補（見 syncOutbox）
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
    // 暖機與同步並行啟動；不再固定等待 800ms，避免恢復連線後白等近一秒。
    warmGAS();
    setTimeout(function() { syncOutbox(true); }, 0);
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