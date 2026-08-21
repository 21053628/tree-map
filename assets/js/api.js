/**
 * 樹木管理系統 - API 服務模組（極致性能優化版 v2.3 - 極速無阻塞版）
 * 
 * 🚀 v2.3 終極優化：
 * 1. [GET 不排隊] GET 請求直接並發，徹底移除隊列延遲
 * 2. [3秒極速放棄] 背景刷新 (bootstrap) 只等 3 秒，超時果斷放棄，秒切本地快取
 * 3. [寫入才排隊] 只有 POST 寫入請求才使用隊列，確保數據不衝突
 */
const ApiService = (function() {
  'use strict';

  // 🔥 [v2.3] 極限超時設定
  const DEFAULT_TIMEOUT = 8000;      // 8秒：用戶交互請求 (如 get tree details)
  const BACKGROUND_TIMEOUT = 30000;  // 🔥 30秒：預留足夠時間等 GAS 冷啟動（bootstrap 背景刷新，不阻塞 UI）
  const POST_TIMEOUT = 20000;        // 20秒：寫入請求 (需要確保成功)
  
  const MAX_RETRIES = 1;             // 只重試 1 次 (針對偶發網路波動)
  const RETRY_DELAY = 800;
  const CACHE_TTL = 60000;           // 1 分鐘記憶體快取
  const MAX_CONCURRENT_POST = 3;     // POST 最大並發數
  const MAX_CACHE_SIZE = 100;        // LRU 快取上限
  
  const WRITE_TYPES = ['checkin', 'inspection', 'inspection_photo', 'update_tree', 'create_project', 'create_tree', 'create_aerial', 'update_project', 'delete_project', 'delete_tree'];

  let apiEndpoint = null;
  let requestCount = 0;
  let errorCount = 0;
  let cacheHitCount = 0;
  const responseCache = new Map();
  
  // POST 專用隊列 (GET 不使用)
  let pendingPosts = [];
  let activePosts = 0;

  function init(endpoint) {
    if (!endpoint) throw new Error('API 端點未提供');
    apiEndpoint = endpoint;
  }

  // 產生 idempotency 資料：client_id（UUID，含非安全環境 fallback）+ client_created_at（ISO 時間）
  function newClientMeta() {
    var id = '';
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        id = window.crypto.randomUUID();
      }
    } catch (e) {}
    if (!id) {
      id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0;
        var v = (c === 'x') ? r : ((r & 0x3) | 0x8);
        return v.toString(16);
      });
    }
    return { client_id: id, client_created_at: new Date().toISOString() };
  }

  // [Phase6] 本地審計記錄（若有載入 audit-log.js）
  function auditWrite(payload, status, error) {
    if (typeof window === 'undefined' || !window.AuditLog) return;
    try {
      window.AuditLog.log({
        action: 'write',
        type: payload.type || null,
        tree_id: payload.tree_id || payload.treeId || null,
        project_id: payload.project_id || payload.prj || null,
        staff: payload.staff || null,
        status: status,
        error: error || null
      });
    } catch (e) {}
  }

  function getFromCache(key) {
    const cached = responseCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      responseCache.delete(key);
      return null;
    }
    cacheHitCount++;
    return cached.data;
  }

  function setCache(key, data) {
    if (responseCache.size >= MAX_CACHE_SIZE) {
      const firstKey = responseCache.keys().next().value;
      responseCache.delete(firstKey);
    }
    responseCache.set(key, { data: data, timestamp: Date.now() });
  }

  function fetchWithTimeout(url, options, timeout) {
    if (!navigator.onLine) {
      return Promise.reject(new Error('OFFLINE'));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    return fetch(url, Object.assign({}, options, { signal: controller.signal }))
      .then(response => { 
        clearTimeout(timeoutId); 
        return response; 
      })
      .catch(error => {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') throw new Error('TIMEOUT');
        throw error;
      });
  }

  /**
   * 安全解析 GAS 回應。
   * GAS 部署失效、權限不足或網址錯誤時，Google 可能回傳 HTML；
   * 先讀取文字再 JSON.parse，避免直接 response.json() 產生
   * `Unexpected token '<'`，並提供可操作的錯誤資訊。
   */
  function createApiResponseError(response, body, context, parseError) {
    const status = response && response.status;
    const isHtml = /^\s*</.test(body || '') || /text\/html/i.test(
      response && response.headers ? response.headers.get('content-type') || '' : ''
    );
    let message;

    if (status === 404) {
      message = 'GAS API 回應 HTTP 404：找不到部署端點。請確認使用仍存在的正式 /exec 網址。';
    } else if (status === 401 || status === 403) {
      message = 'GAS API 回應 HTTP ' + status + '：沒有存取權限。請確認部署的「誰有權限存取」設定為「所有人」。';
    } else if (status >= 500) {
      message = 'GAS API 回應 HTTP ' + status + '：伺服器暫時無法使用，請稍後再試。';
    } else if (isHtml) {
      message = 'GAS API 回傳 HTML 而非 JSON：部署網址可能已失效，或存取權限要求登入。請確認使用正式 /exec 網址及「所有人」存取權限。';
    } else if (parseError) {
      message = 'GAS API 回傳的資料不是有效 JSON。請檢查 doGet/doPost 是否使用 ContentService 回傳 JSON。';
    } else {
      message = 'GAS API 回應格式錯誤。';
    }

    const error = new Error(message);
    error.name = 'ApiResponseError';
    error.code = status === 404 ? 'API_NOT_FOUND'
      : (status === 401 || status === 403) ? 'API_FORBIDDEN'
      : (status >= 500) ? 'API_SERVER_ERROR'
      : isHtml ? 'API_HTML_RESPONSE' : 'API_INVALID_JSON';
    error.status = status || 0;
    error.context = context || '';
    error.isHtml = isHtml;
    error.noRetry = error.code === 'API_NOT_FOUND' ||
      error.code === 'API_FORBIDDEN' ||
      error.code === 'API_HTML_RESPONSE' ||
      error.code === 'API_INVALID_JSON';
    error.bodyPreview = String(body || '').slice(0, 200);
    return error;
  }

  async function parseApiResponse(response, context) {
    const body = await response.text();
    let data = null;

    try {
      data = body ? JSON.parse(body) : null;
    } catch (parseError) {
      throw createApiResponseError(response, body, context, parseError);
    }

    if (!response.ok) {
      const error = createApiResponseError(response, body, context);
      if (data && typeof data === 'object' && data.error) {
        error.backendError = data.error;
      }
      throw error;
    }

    if (data === null || typeof data !== 'object') {
      throw createApiResponseError(response, body, context);
    }

    return data;
  }

  // 🔥 [v2.3] 只有 POST 才排隊，避免寫入衝突
  function processPostQueue() {
    while (activePosts < MAX_CONCURRENT_POST && pendingPosts.length > 0) {
      const item = pendingPosts.shift();
      activePosts++;
      item.requestFn()
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => { 
          activePosts--; 
          processPostQueue(); 
        });
    }
  }

  function enqueuePost(requestFn) {
    return new Promise((resolve, reject) => {
      pendingPosts.push({ resolve, reject, requestFn });
      processPostQueue();
    });
  }

  async function withRetry(requestFn, retries, attempt = 1) {
    retries = (retries === undefined) ? MAX_RETRIES : retries;
    try {
      return await requestFn();
    } catch (error) {
      errorCount++;
      // 離線、超時及部署/格式錯誤直接放棄，不再空等
      if (retries > 0 && !error.noRetry &&
          error.message !== 'OFFLINE' && error.message !== 'TIMEOUT') {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
        return withRetry(requestFn, retries - 1, attempt + 1);
      }
      throw error;
    }
  }

  /* GET：公開查看資料 (🔥 v2.3: 直接發送，絕對不排隊！) */
  async function get(action, params) {
    params = params || {};
    if (!apiEndpoint) throw new Error('API 服務未初始化');
    
    const queryString = new URLSearchParams(params).toString();
    const cacheKey = 'get:' + action + ':' + queryString;
    
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
    
    requestCount++;
    const url = apiEndpoint + '?action=' + action + (queryString ? '&' + queryString : '');
    
    // 🔥 bootstrap 背景刷新用較長超時；超時後由 offline.js 回退本地快取
    const isBackground = (action === 'bootstrap');
    const timeout = isBackground ? BACKGROUND_TIMEOUT : DEFAULT_TIMEOUT;
    
    // 直接 fetch，不需經 enqueueRequest
    return withRetry(() =>
      fetchWithTimeout(url, { method: 'GET' }, timeout)
        .then(response => parseApiResponse(response, 'GET ' + action))
        .then(data => { 
          setCache(cacheKey, data); 
          return data; 
        })
    );
  }

  function isAuthFailure(data) {
    return !!(data && data.ok === false &&
      (data.error === 'UNAUTHORIZED' || data.error === 'CSRF_TOKEN_INVALID'));
  }

  async function applyAuth(payload, forcePrompt) {
    if (typeof AuthService === 'undefined') return true;

    if (forcePrompt && AuthService.logout) {
      AuthService.logout();
    }

    const ok = await AuthService.promptAuth(forcePrompt
      ? '🔐 登入狀態已失效，請重新輸入工作人員密碼：'
      : undefined);
    if (!ok) return false;

    const token = AuthService.getToken();
    const csrf = AuthService.getCsrfToken();
    if (!token || !csrf) return false;

    payload.token = token;
    payload.csrf_token = csrf;
    return true;
  }

  /* POST：寫入 (保持排隊，確保寫入順序同並發控制) */
  async function post(payload) {
    if (!apiEndpoint) throw new Error('API 服務未初始化');
    requestCount++;

    // 不直接修改呼叫端的 payload，避免重試時保留失效認證資料。
    payload = Object.assign({}, payload);
    var isWrite = WRITE_TYPES.indexOf(payload.type) !== -1;

    if (isWrite && typeof AuthService !== 'undefined') {
      const ok = await applyAuth(payload, false);
      if (!ok) return { ok: false, error: '未登入，操作已取消' };
    }

    // 🔐 Idempotency：寫入 payload 一律帶 client_id + client_created_at（重試時不變）
    if (isWrite) {
      if (!payload.client_id) {
        var meta = newClientMeta();
        payload.client_id = meta.client_id;
        payload.client_created_at = meta.client_created_at;
      } else if (!payload.client_created_at) {
        payload.client_created_at = new Date().toISOString();
      }
      console.log('🆔 [Idempotency] 寫入 ' + payload.type + ' client_id=' + payload.client_id + '（後端未支援 dedupe 時僅供追蹤）');
      auditWrite(payload, 'attempt');
    }

    if (payload.type) invalidateCache(payload.type);

    return enqueuePost(async () => {
      const send = () => withRetry(() =>
        fetchWithTimeout(apiEndpoint, {
          method: 'POST',
          // 🔥 [CORS 修正] 只保留 Content-Type（text/plain 為簡單請求）。
          // 認證資料放在 body，避免 Apps Script 觸發 OPTIONS preflight。
          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },
          body: JSON.stringify(payload)
        }, POST_TIMEOUT)
          .then(response => parseApiResponse(response, 'POST ' + (payload.type || 'request')))
      );

      let data = await send();
      let authRetried = false;

      // ScriptCache 可能在前端 session 仍有效時已清除 token；
      // 收到認證失效時強制重新登入，並以同一 client_id 重送一次。
      if (isWrite && isAuthFailure(data) &&
          !authRetried && typeof AuthService !== 'undefined' && navigator.onLine) {
        authRetried = true;
        const reauthenticated = await applyAuth(payload, true);
        if (reauthenticated) {
          data = await send();
        }
      }

      if (data && data.duplicate === true) {
        // 後端回報重複：這筆 client_id 早已成功處理，視為成功（避免重複 alert 失敗）
        data.ok = true;
      }

      if (isAuthFailure(data)) {
        if (typeof AuthService !== 'undefined') AuthService.logout();
        data.error = '未登入或登入已過期，請再試一次並輸入工作人員密碼';
      }

      if (isWrite) {
        auditWrite(payload, (data && data.ok) ? 'success' : 'error',
          (data && data.ok) ? null : (data && data.error));
      }
      return data;
    });
  }

  function invalidateCache(type) {
    const prefixes = {
      'create_project': ['get:projects'],
      'update_project': ['get:projects', 'get:trees', 'get:bootstrap'],
      'delete_project': ['get:projects', 'get:trees', 'get:bootstrap'],
      'create_tree': ['get:trees', 'get:bootstrap'],
      'update_tree': ['get:trees', 'get:bootstrap'],
      'delete_tree': ['get:trees', 'get:bootstrap'],
      'create_aerial': ['get:aerials']
    };
    const prefixList = prefixes[type];
    if (prefixList) {
      for (const key of responseCache.keys()) {
        if (prefixList.some(p => key.startsWith(p))) {
          responseCache.delete(key);
        }
      }
    }
  }

  function clearCache() { responseCache.clear(); }

  function getStats() {
    return {
      totalRequests: requestCount,
      totalErrors: errorCount,
      cacheHits: cacheHitCount,
      hitRate: requestCount > 0
        ? (cacheHitCount / (requestCount + cacheHitCount) * 100).toFixed(1) + '%'
        : 'N/A'
    };
  }

  function resetStats() { requestCount = 0; errorCount = 0; cacheHitCount = 0; }

  return {
    init,
    get,
    post,
    getStats,
    resetStats,
    clearCache,
    newClientMeta,
    parseResponse: parseApiResponse
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ApiService;
}