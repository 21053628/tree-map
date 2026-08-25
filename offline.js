/**
 * 樹木管理系統 - 離線寫入佇列 (IndexedDB Outbox)
 * v1.0.0-beta - 統一版本號（正式發佈前整合）
 * 歷史：v2.0.0 - Phase 1：outbox 資料結構升級（可追蹤、不會無故消失）
 *   - 每筆記錄加入 client_id/uuid、type、tree_id、project_id、status、時間戳、lastError
 *   - MAX_RETRY 超過後不再丟棄，改為 status='failed' 並保留
 *   - 新增 helpers：getPendingCount/getFailedCount/markSyncing/markSynced/markFailed/retryOne/retryAllFailed
 *   - 相容舊 queue items（讀取時自動補齊欄位）
 *   - cleanupExpired 只清理已同步(synced)且過期記錄，不再刪除 pending/failed
 *   - 保留既有：修正 IndexedDB 交易 Promise 包裝、逐筆同步、warmGAS no-cors、finally 重置 _syncing
 */
import { ApiService } from './assets/js/api.js';
import { Config } from './assets/js/config.js';
import { CacheManager } from './assets/js/core/cache-manager.js';
import { ErrorCodes } from './assets/js/core/error-codes.js';
import { AuditLog } from './assets/js/modules/audit-log.js';

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
  var BATCH_DELAY_MS = 250;
  var MAX_DRAIN_BATCHES = 100;

  var CACHE_KEY_PREFIX = 'tree_cache_';
  // 統一來源：CachePolicy.snapshot.ttl（24h），未載入時回退
  var CACHE_MAX_AGE = (function(){ try{ if(typeof CachePolicy!=='undefined'&&CachePolicy.POLICY&&CachePolicy.POLICY.snapshot) return CachePolicy.POLICY.snapshot.ttl; }catch(e){} return 24*60*60*1000; })();
  function notifySwInvalidateOffline_(type, payload){
    try{
      if (typeof CacheManager !== 'undefined' && CacheManager.notifySwInvalidate) { CacheManager.notifySwInvalidate(type, payload); return; }
      if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type:'INVALIDATE_DATA_CACHE', invalidateType:type, payload:payload||null });
      }
    }catch(e){}
  }

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
      el.className = 'offline-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(el._t);
    el._t = setTimeout(function() { el.classList.remove('is-visible'); }, duration || 2600);
  }

  function quietFailToast(msg) {
    if (_failToastShown) return;
    _failToastShown = true;
    pwaToast(msg, 3000);
  }

  // [Phase6] 本地審計記錄（若有載入 audit-log.js）
  function auditWrite(payload, action, status, error) {
    if (typeof window === 'undefined' || !AuditLog) return;
    var p = payload || {};
    try {
      AuditLog.log({
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
    // 🔥 [P0 修復] 先試 sessionStorage（安全優先），若無效則 fallback 至 localStorage（跨分頁持久）
    // 避免用戶關閉分頁後離線佇列因 token 遺失而永鎖。
    try {
      var raw = window.sessionStorage.getItem(TOKEN_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && data.token && data.until > Date.now()) return data.token;
      }
    } catch (e) {}
    try {
      var rawLs = window.localStorage.getItem(TOKEN_KEY);
      if (rawLs) {
        var dataLs = JSON.parse(rawLs);
        if (dataLs && dataLs.token && dataLs.until > Date.now()) return dataLs.token;
      }
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

  // 📷 離線圖片限制（與 Config.UPLOAD / GAS 一致）
  function getUploadLimitsOffline(){
    var up = (typeof Config !== 'undefined' && Config.UPLOAD) ? Config.UPLOAD : null;
    return {
      allowed: (up && up.ALLOWED_MIMES) || ['image/jpeg','image/png','image/webp'],
      maxBytes: (up && up.MAX_BYTES) || 10*1024*1024,
      maxCount: (up && up.MAX_COUNT) || 10,
      singleB64: 15*1024*1024
    };
  }
  function estimateDecodedBytesOffline(clean){
    var s = String(clean||'').replace(/\s/g,'');
    if(!s) return 0;
    var pad=0; if(s.slice(-2)==='==') pad=2; else if(s.slice(-1)==='=') pad=1;
    return Math.floor(s.length*3/4)-pad;
  }
  function detectMimeFromBytesOffline(bytes){
    if(!bytes || bytes.length<4) return '';
    if(bytes[0]===0xFF && bytes[1]===0xD8 && bytes[2]===0xFF) return 'image/jpeg';
    if(bytes[0]===0x89 && bytes[1]===0x50 && bytes[2]===0x4E && bytes[3]===0x47) return 'image/png';
    if(bytes.length>=12 && bytes[0]===0x52 && bytes[1]===0x49 && bytes[2]===0x46 && bytes[3]===0x46 && bytes[8]===0x57 && bytes[9]===0x45 && bytes[10]===0x42 && bytes[11]===0x50) return 'image/webp';
    return '';
  }
  function validatePhotoPayloadOffline(payload){
    var p = payload || {};
    var b64 = p.photo_base64;
    if(b64===undefined || b64===null || b64==='') return null;
    var arr = Array.isArray(b64) ? b64 : [b64];
    var lim = getUploadLimitsOffline();
    var nonEmpty = arr.filter(function(v){ return String(v||'').trim()!==''; });
    if(nonEmpty.length>lim.maxCount || arr.length>lim.maxCount) return '相片數量不可超過 '+lim.maxCount+' 張（目前 '+arr.length+' 張）';
    for(var i=0;i<arr.length;i++){
      var raw = String(arr[i]||''); if(!raw.trim()) continue;
      if(raw.length>lim.singleB64) return '單張相片過大，請壓縮後再上傳';
      var comma = raw.indexOf(',');
      var prefix=''; var clean=raw;
      if(raw.slice(0,5)==='data:' && comma!==-1){ prefix=raw.slice(0,comma); clean=raw.slice(comma+1); }
      var declared='';
      if(prefix){ var m=prefix.match(/^data:([^;]+);base64$/i); declared=m?String(m[1]).toLowerCase().trim():''; if(declared && lim.allowed.indexOf(declared)===-1) return '不支援的圖片格式：'+declared; }
      clean=String(clean||'').replace(/\s/g,'');
      if(!clean) return '相片資料空白';
      if(!/^[A-Za-z0-9+/=]+$/.test(clean)) return '相片 base64 格式不正確';
      var est=estimateDecodedBytesOffline(clean);
      if(est>lim.maxBytes) return '單張相片過大（'+(est/1024/1024).toFixed(1)+'MB），上限 '+Math.round(lim.maxBytes/1024/1024)+'MB';
      try{
        var bin = atob(clean.slice(0, 32));
        var bytes=[]; for(var k=0;k<bin.length;k++) bytes.push(bin.charCodeAt(k));
        var sniffed=detectMimeFromBytesOffline(bytes);
        if(declared && sniffed && declared!==sniffed) return '圖片 MIME 與內容不符（聲明 '+declared+' 實際 '+sniffed+'）';
        var eff=sniffed||declared;
        if(!eff) {
          // 無前綴且頭部不足以判斷：若能 decode 則放行由後端最終校驗，否則報格式不明
          if(nonEmpty.length===arr.length && !prefix) continue;
          return '無法識別圖片格式（僅支援 '+lim.allowed.join(', ')+'）';
        }
        if(lim.allowed.indexOf(eff)===-1) return '不支援的圖片格式：'+eff;
      }catch(e){ return '相片 base64 解碼失敗'; }
    }
    return null;
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
    } catch (e) {}
    return Promise.resolve(true);
  }

  function doPush_(payload) {
    // 強制脫敏：任何呼叫路徑寫入 IndexedDB 前一律移除 token / csrf_token
    // 使用淺拷貝避免污染呼叫方原始物件；同步時 syncOutbox 會從 AuthService / sessionStorage 重新補上最新憑證
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
  // 🔥 [Bugfix] key 用排序後嘅 params 建構，與 ApiService memory cache（api.js）一致，
  // 避免 URLSearchParams/JSON.stringify 因 params 順序唔同而 cache miss 或重複存儲
  function buildCacheKey(action, params) {
    if (!params) return action;
    var keys = Object.keys(params).sort();
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      var v = params[keys[i]];
      parts.push(keys[i] + '=' + encodeURIComponent(v === undefined || v === null ? '' : String(v)));
    }
    return action + '?' + parts.join('&');
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
      // 🔥 [Bugfix] 用「action + '?'」做分隔，避免 prefix 誤殺（如 'trees' 誤匹配 'treeshot'）
      const exactKey = CACHE_KEY_PREFIX + action;
      const paramPrefix = CACHE_KEY_PREFIX + action + '?';
      Object.keys(localStorage).forEach(function(k) {
        if (k === exactKey || k.indexOf(paramPrefix) === 0) localStorage.removeItem(k);
      });
    } else {
      Object.keys(localStorage).forEach(function(k) {
        if (k.indexOf(CACHE_KEY_PREFIX) === 0) localStorage.removeItem(k);
      });
    }
  }

  // 🔥 [Bugfix] 寫入成功後精準失效 localStorage 快取（對應 ApiService.invalidateCache 的 prefix 邏輯），
  // 不再無差別清空全部離線快取。
  function clearCacheForType(type) {
    var prefixes = [];
    if (type === 'inspection' || type === 'inspection_photo' || type === 'checkin') {
      prefixes = ['inspections', 'trees', 'bootstrap'];
    } else if (type === 'create_project' || type === 'update_project' || type === 'delete_project') {
      prefixes = ['projects', 'trees', 'bootstrap'];
    } else if (type === 'create_tree' || type === 'update_tree' || type === 'delete_tree') {
      prefixes = ['trees', 'bootstrap'];
    } else if (type === 'create_aerial') {
      prefixes = ['aerials'];
    } else if (type) {
      prefixes = [type];
    }
    prefixes.forEach(function(prefix) { clearCache(prefix); });
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

  function snapRemove(key){
    return openDB().then(function(db){
      return new Promise(function(resolve){
        var tx=db.transaction(SNAPSHOT_STORE,'readwrite');
        tx.objectStore(SNAPSHOT_STORE).delete(key);
        tx.oncomplete=function(){resolve();};
        tx.onerror=function(){resolve();};
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
          // 🔥 [v2.5 修復] 快照 TTL 過期檢查：超過 CACHE_MAX_AGE (預設 24h) 嘅快照視為無效，
          // 強制下次從伺服器重新載入，避免已刪樹木因快照無限期有效而永遠唔消失。
          if (Date.now() - (result.ts || 0) > CACHE_MAX_AGE) {
            // 非同步刪除過期快照，唔阻塞 resolve
            try {
              var delTx = db.transaction(SNAPSHOT_STORE, 'readwrite');
              delTx.objectStore(SNAPSHOT_STORE).delete(key);
              delTx.oncomplete = function(){};
              delTx.onerror = function(){};
            } catch(e) {}
            resolve(null);
            return;
          }
          resolve(result.data);
        };
        req.onerror = function() { resolve(null); };
      });
    });
  }

  // ========== 暖機與同步 ==========
  function warmGAS() {
    // 🔥 [Bugfix] 未配置 API 端點時直接跳過，避免 fetch('?action=ping') 打到錯誤 URL
    if (!API_URL) return;
    if (Date.now() - _lastWarm < 5 * 60 * 1000) return;
    _lastWarm = Date.now();
    try {
      // 🔥 [Bugfix] 改回 cors 模式：no-cors 在部分瀏覽器可能被 network layer 攔截或快取，
      // 未必能真正觸發 GAS 冷啟動。cors 模式即使被 GAS CORS 拒絕，請求仍會到達伺服器達到暖機效果。
      // 回應一律忽略（catch 吞掉），不影響主流程。
      fetch(API_URL + '?action=ping', { method: 'GET', mode: 'cors', cache: 'no-store' }).catch(function(){});
    } catch (e) {}
  }

  var _syncing = false;
  var _syncPromise = null;

  // 所有入口共用同一個 Promise，避免 online、visibilitychange、輪詢及手動按鈕
  // 同時啟動多條同步連線。同步仍維持佇列順序，確保 inspection/photo 依賴不被打亂。
  function syncOutbox(force) {
    if (!navigator.onLine) return Promise.resolve(0);
    if (_syncPromise) return _syncPromise;
    // 🔥 [Bugfix] 節流時間從 60s 縮短至 15s，確保用戶從離線恢復連線後能更快觸發同步重試
    if (!force && Date.now() - _lastSyncAttempt < 15 * 1000) return Promise.resolve(0);

    _syncPromise = runSyncOutbox(force).finally(function() {
      _syncPromise = null;
    });
    return _syncPromise;
  }

  // 可选延时：批次间让出主线程并避免 GAS 限流
  function delay_(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  // 单批次逐笔同步（保持顺序，不并发），返回 {synced, failed, networkStreak, shouldBreak}
  async function processBatch_(batch){
    var synced = 0;
    var failed = 0;
    var networkStreak = 0;
    var shouldBreak = false;
    var reauthCount = 0; // 🔥 限制每批次重新認證重試次數，避免無限循環
    for (var i = 0; i < batch.length; i++) {
      var item = batch[i];
      if (!navigator.onLine) { shouldBreak = true; break; }
      if (item.retry >= MAX_RETRY) {
        console.warn('[Sync] 记录超过重试上限，标记为 failed（保留）:', item.id);
        await markFailed(item.id, '超过重试上限(' + MAX_RETRY + '次)');
        auditWrite(item.payload, 'sync', 'failed', '超过重试上限(' + MAX_RETRY + '次)');
        failed++;
        networkStreak = 0;
        continue;
      }
      var photoErr = validatePhotoPayloadOffline(item.payload);
      if (photoErr) {
        console.warn('[Sync] 相片校验失败，标记 failed:', photoErr);
        await markFailed(item.id, photoErr);
        auditWrite(item.payload, 'sync', 'failed', photoErr);
        pwaToast('⚠️ 离线记录相片校验失败：' + photoErr, 4000);
        failed++;
        networkStreak = 0;
        continue;
      }
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
            json = await ApiService.parseResponse(res, 'POST offline sync');
          } else {
            var responseBody = await res.text();
            try { json = responseBody ? JSON.parse(responseBody) : null; } catch (parseError) {
              throw new Error('同步回应不是有效 JSON，请确认 GAS 使用正式 /exec 部署网址。');
            }
            if (!res.ok) throw new Error('HTTP ' + res.status);
          }
        } catch (responseError) {
          var responseStatus = responseError.status || res.status;
          var permanentApiError = responseError.noRetry || responseStatus === 401 || responseStatus === 403 || responseStatus === 404;
          var responseMessage = responseError.message || ('HTTP ' + responseStatus);
          if (permanentApiError) {
            console.error('[Sync] API 部署或权限错误，停止自动重试:', responseMessage);
            await markFailed(item.id, responseMessage);
            auditWrite(item.payload, 'sync', 'failed', responseMessage);
            failed++;
            networkStreak = 0;
            continue;
          }
          console.warn('[Sync] 服务器状态/格式错误，稍后重试:', responseMessage);
          quietFailToast('⏳ 后端不稳，记录已安全排队');
          await incrementRetry(item.id, responseMessage);
          auditWrite(item.payload, 'sync', 'retry', responseMessage);
          failed++;
          networkStreak++;
          if (networkStreak >= 3) { shouldBreak = true; }
          continue;
        }
        if (json && (json.ok || json.duplicate === true)) {
          if (json.duplicate === true) console.log('[Sync] 后端回报重复（client_id 已处理），视为成功:', item.id);
          // 🔥 [P0 修復] CSRF 旋轉：同步成功後更新前端 CSRF Token
          if (json.csrf_token && typeof AuthService !== 'undefined' && AuthService.setCsrfToken) {
            AuthService.setCsrfToken(json.csrf_token);
          }
          await markSynced(item.id);
          auditWrite(item.payload, 'sync', 'synced');
          synced++;
          networkStreak = 0;
        } else if (json && (function(j){var c=String(j.error_code||j.error||''); return c==='UNAUTHORIZED'||c==='CSRF_INVALID'||c==='CSRF_TOKEN_INVALID'||c==='AUTH_FAILED'; })(json)) {
          auditWrite(item.payload, 'sync', 'unauthorized', json.error);
          // 🔥 [P0 修復] 先檢查 AuthService 嘅 CSRF token 是否已被平行請求旋轉咗
          // （另一個寫入成功後已更新 token，唔需要重新登入）
          var csrfRetried = false;
          if (typeof AuthService !== 'undefined' && AuthService.getCsrfToken) {
            var newCsrf = AuthService.getCsrfToken();
            if (newCsrf && newCsrf !== item.payload.csrf_token) {
              item.payload.csrf_token = newCsrf;
              // 更新 token（可能都更新咗）
              if (typeof AuthService.getToken === 'function') {
                var newToken = AuthService.getToken();
                if (newToken) item.payload.token = newToken;
              }
              csrfRetried = true;
              // 直接重試，唔打斷流程
              i--; networkStreak = 0; continue;
            }
          }
          if (!csrfRetried) {
            await updateItem(item.id, { status: 'queued', lastError: '登入已过期' });
            if (typeof AuthService !== 'undefined' && (AuthService.reauthenticate || AuthService.promptAuth)) {
              var reOk = AuthService.reauthenticate ? await AuthService.reauthenticate('登入已过期，请重新输入工作人员密码以继续同步') : await AuthService.promptAuth('登入已过期，请重新输入工作人员密码以继续同步');
              if (reOk) { reauthCount++; if (reauthCount >= 2) { shouldBreak = true; break; } i--; networkStreak = 0; continue; }
            }
            failed++;
            networkStreak = 0;
            shouldBreak = true;
            break;
          }
        } else {
          var bizCode = json && String(json.error_code || json.error || 'UNKNOWN');
          var noRetryCodes = {VALIDATION_FAILED:true, CONFLICT:true, INVALID_LOCATION:true, INVALID_REQUEST:true, INVALID_JSON:true, UNSUPPORTED_OPERATION:true, UPLOAD_FAILED:true};
          var bizMsg = (typeof ErrorCodes !== 'undefined' && ErrorCodes.messageForResponse) ? ErrorCodes.messageForResponse(json, bizCode) : bizCode;
          if(noRetryCodes[bizCode]){
            console.warn('[Sync] 永久性业务错误，直接标记 failed:', bizCode);
            await markFailed(item.id, bizCode + ':' + bizMsg);
            auditWrite(item.payload, 'sync', 'failed', bizCode);
          } else {
            console.warn('[Sync] 业务错误（保留重试）:', bizCode);
            await incrementRetry(item.id, bizCode);
            auditWrite(item.payload, 'sync', 'error', bizCode);
          }
          failed++;
          networkStreak = 0;
          continue;
        }
      } catch (err) {
        console.warn('[Sync] 网络不稳，稍后重试');
        quietFailToast('⏳ 网络不稳，记录已安全排队');
        await incrementRetry(item.id, (err && err.message) || '网络不稳');
        auditWrite(item.payload, 'sync', 'retry', (err && err.message) || '网络不稳');
        failed++;
        networkStreak++;
        if (networkStreak >= 3) { shouldBreak = true; break; }
        continue;
      }
    }
    return { synced: synced, failed: failed, networkStreak: networkStreak, shouldBreak: shouldBreak };
  }

  async function runSyncOutbox(force) {
    if (!navigator.onLine || _syncing) return 0;
    // 🔥 [Bugfix] 與 syncOutbox 節流一致（15s）：避免外層已放行但內層 60s 檢查把請求擋住，
    // 導致從離線恢復連線後 60 秒內無法重試同步
    if (!force && Date.now() - _lastSyncAttempt < 15 * 1000) return 0;
    _lastSyncAttempt = Date.now();
    _syncing = true;
    var totalSynced = 0;
    var totalFailed = 0;
    var batchCount = 0;
    try {
      while (navigator.onLine && batchCount < MAX_DRAIN_BATCHES) {
        var items = await all();
        var pending = items.filter(function(it) { return it.status === 'queued' || it.status === 'syncing'; });
        if (!pending.length) break;
        if (batchCount > 0) {
          await delay_(BATCH_DELAY_MS);
          if (!navigator.onLine) break;
        }
        console.log('[Sync] 待同步 ' + pending.length + ' 筆（總共 ' + items.length + ' 筆）' + (batchCount ? ' - 第' + (batchCount+1) + '批' : ''));
        var batch = pending.slice(0, SYNC_BATCH_SIZE);
        var result = await processBatch_(batch);
        totalSynced += result.synced;
        totalFailed += result.failed;
        batchCount++;
        if (result.shouldBreak) {
          console.warn('[Sync] 連續網路失敗或登入過期，暫停本輪 drain，待下次觸發');
          break;
        }
        if (result.synced === 0 && result.failed === 0) break;
      }
      console.log('[Sync] 完成：成功 ' + totalSynced + ' 筆，失敗 ' + totalFailed + ' 筆' + (batchCount ? '（共' + batchCount + '批）' : ''));
      if (totalSynced > 0) {
        var remain = await getPendingCount();
        if (remain === 0) pwaToast('✅ 已全部同步 (' + totalSynced + '筆)', 3000);
        else pwaToast('☁️ 已同步 ' + totalSynced + ' 筆，剩餘 ' + remain + ' 筆，繼續同步中…', 3000);
        _failToastShown = false;
        clearCache();
        notifySwInvalidateOffline_('sync', null);
        try { if(typeof ApiService!=='undefined' && ApiService.clearCache) ApiService.clearCache(); } catch(e) {}
      } else if (totalFailed > 0 && batchCount > 0) {
        pwaToast('⏳ 部分記錄暫時無法同步，已保留重試', 3000);
      }
      return totalSynced;
    } catch (err) {
      console.error('[Sync] 同步流程發生錯誤:', err);
      return totalSynced;
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
    if (!payload || typeof payload !== 'object') return payload;
    const copy = Object.assign({}, payload);
    if ('token' in copy) delete copy.token;
    if ('csrf_token' in copy) delete copy.csrf_token;
    return copy;
  }

  // ========== 攔截 ApiService ==========
  if (typeof ApiService !== 'undefined') {
    var origPost = ApiService.post;
    var origClearCache = ApiService.clearCache; // 🔥 保留原 ApiService.clearCache（清理 responseCache Map）
    ApiService.post = async function(payload) {
      if (!navigator.onLine) {
        // 🔐 不將 token 預先寫入 IndexedDB outbox，同步時先補（見 syncOutbox）
        await push(stripToken(payload));
        pwaToast('📥 離線暫存：有網路時自動上傳');
        return { ok: true, queued: true };
      }
      try {
        var result = await origPost(payload);
        if (result && result.ok) { clearCacheForType(payload.type || 'post'); notifySwInvalidateOffline_(payload.type||'post', payload); }
        return result;
      } catch (err) {
        // 檢查是否為網路錯誤或伺服器錯誤（5xx）
        var isNetworkError = (err instanceof TypeError) || !navigator.onLine || err.message === 'TIMEOUT' || (err.status === 0);
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
        // 🔥 [P1 修復] shallow clone params，避免修改 origGet 內的 params 影響呼叫方（api.js 會 trim params.project）
        var paramsClone = params ? Object.assign({}, params) : params;
        var result = await origGet(action, paramsClone);
        // nocache/bust: never persist bypass result as snapshot, and warn
        try{ var _bp = params && (params.nocache==='1'||params.bust==='1'); if(_bp && result && Array.isArray(result.data) && result.data.length===0) console.warn('[OfflineGet] bypass returned 0 for '+action+' '+JSON.stringify(params)); }catch(e){}
        // 🔥 [Bugfix] bypass 請求的成功結果一律不寫入 localStorage 快取，
        // 避免「強制刷新」資料反而污染離線快取（cache key 雖不同但佔空間且語義錯誤）
        if (result && result.data && !(params && (params.nocache==='1'||params.bust==='1'))) setCache(action, params, result.data);
        return result;
      } catch (err) {
        // v3.0: SW 離線無快取時回 503 {error:'OFFLINE'}，此處一併視為離線回退
        var isOfflineErr = !navigator.onLine
          || err.message === 'OFFLINE' || err.message === 'TIMEOUT'
          || (err && err.status === 503)
          || (err && err.backendError === 'OFFLINE')
          || (err && typeof err.code === 'string' && err.code.indexOf('API_') === 0 && !navigator.onLine);
        if (isOfflineErr) {
          var cached = getCache(action, params);
          if (cached) return { data: cached, offline: true, stale: true };
          return { data: [], offline: true, stale: true };
        }
        throw err;
      }
    };

    ApiService.clearCache = function (action) {
      // 🔥 先清理記憶體快取（responseCache Map），再清理 localStorage
      if (typeof origClearCache === 'function') origClearCache(action);
      clearCache(action);
    };
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

  // ========== ESM 導出 ==========
  export const TreeSnapshot = { save: snapSave, load: snapLoad, remove: snapRemove };
  export { OfflineQueue, pwaToast, syncOutbox, syncNow, warmGAS };

  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    setTimeout(cleanupExpired, 3000);
  }

  // 🔥 向後相容橋接：tree-detail 頁 module 消費端（inspection-controller.js / loader.js / species.js）仍經 globalThis 讀取；待 Phase 8 消費者 import 化後移除
  try {
    if (typeof globalThis !== 'undefined') {
      globalThis.OfflineQueue = OfflineQueue;
      globalThis.pwaToast = pwaToast;
      globalThis.syncOutbox = syncOutbox;
      globalThis.syncNow = syncNow;
      globalThis.warmGAS = warmGAS;
      globalThis.TreeSnapshot = TreeSnapshot;
    }
  } catch (e) {}