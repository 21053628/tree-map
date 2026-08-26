/** ApiService adapters for offline writes, reads and local cache fallback. */
import { ApiService } from '../api.js';
import { push } from './storage.js';
import { clearCache, clearCacheForType, setCache, getCache } from './cache.js';
import { pwaToast, notifySwInvalidateOffline_ } from './utils.js';
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
  if (ApiService) {
    var origPost = ApiService.post;
    var origClearCache = ApiService.clearCache; // 🔥 保留原 ApiService.clearCache（清理 responseCache Map）
    ApiService.post = async function(payload, options) {
      if (!navigator.onLine) {
        // 🔐 不將 token 預先寫入 IndexedDB outbox，同步時先補（見 syncOutbox）
        await push(stripToken(payload));
        pwaToast('📥 離線暫存：有網路時自動上傳');
        return { ok: true, queued: true };
      }
      try {
        var result = await origPost(payload, options);
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
        try{ var _bp = params && (params.nocache==='1'||params.bust==='1'); if(_bp && result && Array.isArray(result.data) && result.data.length===0) console.warn('[OfflineGet] bypass returned 0 for '+action+' '+JSON.stringify(params)); }catch(e){ /* intentionally ignored: optional fallback failure */ }
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
export { stripToken };
