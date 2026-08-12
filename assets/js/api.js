/**
 * 樹木管理系統 - API 服務模組（極致性能優化版 v2.2）
 * 
 * 🚀 v2.2 優化重點：
 * 1. [智能超時] 背景刷新 (bootstrap) 只等 10 秒，失敗即放棄，絕不阻塞用戶操作
 * 2. [取消超時重試] 超時代表伺服器異常，重試只會引發雪崩，改為直接報錯
 * 3. [優先級插隊] 用戶交互請求 (如點擊樹木) 自動插隊，背景請求排最後
 * 4. [LRU 快取] 維持記憶體穩定
 */
const ApiService = (function() {
  'use strict';

  // 🔥 [v2.2] 智能超時設定
  const DEFAULT_TIMEOUT = 15000;     // 15秒：用戶交互請求 (如 get tree)
  const BACKGROUND_TIMEOUT = 10000;  // 10秒：背景刷新 (bootstrap)，失敗即放棄
  const POST_TIMEOUT = 20000;        // 20秒：寫入請求 (需要確保成功)
  
  const MAX_RETRIES = 1;             // 減少重試，避免雪崩
  const RETRY_DELAY = 1000;
  const CACHE_TTL = 60000;           // 1 分鐘快取
  const MAX_CONCURRENT = 5;          // 最大並發數
  const MAX_CACHE_SIZE = 100;        // LRU 快取上限
  
  const WRITE_TYPES = ['checkin', 'inspection', 'update_tree', 'create_project', 'create_tree', 'create_aerial'];

  let apiEndpoint = null;
  let requestCount = 0;
  let errorCount = 0;
  let cacheHitCount = 0;
  const responseCache = new Map();
  let pendingRequests = [];
  let activeRequests = 0;

  function init(endpoint) {
    if (!endpoint) throw new Error('API 端點未提供');
    apiEndpoint = endpoint;
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

  function processQueue() {
    while (activeRequests < MAX_CONCURRENT && pendingRequests.length > 0) {
      const item = pendingRequests.shift();
      activeRequests++;
      item.requestFn()
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => { 
          activeRequests--; 
          processQueue(); 
        });
    }
  }

  // 🔥 [v2.2] 優先級插隊：高優先級 unshift (排前面)，低優先級 push (排後面)
  function enqueueRequest(requestFn, isLowPriority) {
    return new Promise((resolve, reject) => {
      const item = { resolve, reject, requestFn };
      if (isLowPriority) {
        pendingRequests.push(item); 
      } else {
        pendingRequests.unshift(item); // 用戶交互請求插隊！
      }
      processQueue();
    });
  }

  // 🔥 [v2.2] 取消 TIMEOUT 重試：超時代表伺服器有問題，再試只會拖死隊列
  async function withRetry(requestFn, retries, attempt = 1) {
    retries = (retries === undefined) ? MAX_RETRIES : retries;
    try {
      return await requestFn();
    } catch (error) {
      errorCount++;
      // 離線、超時 直接放棄，唔再傻等
      if (retries > 0 && error.message !== 'OFFLINE' && error.message !== 'TIMEOUT') {
        const delay = RETRY_DELAY * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        return withRetry(requestFn, retries - 1, attempt + 1);
      }
      throw error;
    }
  }

  /* GET：公開睇資料 */
  async function get(action, params, isLowPriority) {
    params = params || {};
    if (!apiEndpoint) throw new Error('API 服務未初始化');
    
    const queryString = new URLSearchParams(params).toString();
    const cacheKey = 'get:' + action + ':' + queryString;
    
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
    
    requestCount++;
    const url = apiEndpoint + '?action=' + action + (queryString ? '&' + queryString : '');
    
    // 🔥 [v2.2] 智能超時：bootstrap 背景刷新只等 10 秒，失敗即放棄
    const isBackground = (action === 'bootstrap');
    const timeout = isBackground ? BACKGROUND_TIMEOUT : DEFAULT_TIMEOUT;
    const priority = isBackground ? true : isLowPriority; // 背景刷新強制低優先級
    
    return enqueueRequest(() =>
      withRetry(() =>
        fetchWithTimeout(url, { method: 'GET', headers: { 'Accept': 'application/json' } }, timeout)
          .then(response => {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
          })
          .then(data => { 
            setCache(cacheKey, data); 
            return data; 
          })
      ), priority);
  }

  /* POST：寫入 */
  async function post(payload) {
    if (!apiEndpoint) throw new Error('API 服務未初始化');
    requestCount++;

    if (WRITE_TYPES.indexOf(payload.type) !== -1 && typeof AuthService !== 'undefined') {
      const ok = await AuthService.promptAuth();
      if (!ok) return { ok: false, error: '未登入，操作已取消' };
      const token = AuthService.getToken();
      if (token) payload.token = token;
    }

    if (payload.type) invalidateCache(payload.type);

    return enqueueRequest(() =>
      withRetry(() =>
        fetchWithTimeout(apiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        }, POST_TIMEOUT)
        .then(response => {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        })
        .then(data => {
          if (data && data.ok === false && data.error === 'UNAUTHORIZED') {
            if (typeof AuthService !== 'undefined') AuthService.logout();
            data.error = '未登入或登入已過期，請再試一次並輸入工作人員密碼';
          }
          return data;
        })
      ), false); // POST 永遠高優先級
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

  return { init, get, post, getStats, resetStats, clearCache };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ApiService;
}