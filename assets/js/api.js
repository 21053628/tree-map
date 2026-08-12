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
  const BACKGROUND_TIMEOUT = 30000;  // 🔥 [v2.4] 30秒：UI 唔會被阻塞（三段式已秒開），俾足時間等 GAS 冷啟動
  const POST_TIMEOUT = 20000;        // 20秒：寫入請求 (需要確保成功)
  
  const MAX_RETRIES = 1;             // 只重試 1 次 (針對偶發網路波動)
  const RETRY_DELAY = 800;
  const CACHE_TTL = 60000;           // 1 分鐘記憶體快取
  const MAX_CONCURRENT_POST = 3;     // POST 最大並發數
  const MAX_CACHE_SIZE = 100;        // LRU 快取上限
  
  const WRITE_TYPES = ['checkin', 'inspection', 'update_tree', 'create_project', 'create_tree', 'create_aerial'];

  let apiEndpoint = null;
  let requestCount = 0;
  let errorCount = 0;
  let cacheHitCount = 0;
  const responseCache = new Map();
  
  // POST 專用隊列 (GET 唔使用)
  let pendingPosts = [];
  let activePosts = 0;

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

  // 🔥 [v2.3] 只有 POST 先至排隊，避免寫入衝突
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
      // 離線、超時 直接放棄，唔再傻等
      if (retries > 0 && error.message !== 'OFFLINE' && error.message !== 'TIMEOUT') {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
        return withRetry(requestFn, retries - 1, attempt + 1);
      }
      throw error;
    }
  }

  /* GET：公開睇資料 (🔥 v2.3: 直接發送，絕對唔排隊！) */
  async function get(action, params) {
    params = params || {};
    if (!apiEndpoint) throw new Error('API 服務未初始化');
    
    const queryString = new URLSearchParams(params).toString();
    const cacheKey = 'get:' + action + ':' + queryString;
    
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
    
    requestCount++;
    const url = apiEndpoint + '?action=' + action + (queryString ? '&' + queryString : '');
    
    // 🔥 [v2.3] 3秒極速放棄：bootstrap 只等 3 秒，超時即刻交俾 offline.js 用本地快取
    const isBackground = (action === 'bootstrap');
    const timeout = isBackground ? BACKGROUND_TIMEOUT : DEFAULT_TIMEOUT;
    
    // 直接 fetch，唔使經 enqueueRequest
    return withRetry(() =>
      fetchWithTimeout(url, { method: 'GET' }, timeout)
        .then(response => {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        })
        .then(data => { 
          setCache(cacheKey, data); 
          return data; 
        })
    );
  }

  /* POST：寫入 (保持排隊，確保寫入順序同並發控制) */
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

    return enqueuePost(() =>
      withRetry(() =>
        fetchWithTimeout(apiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
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
      )
    );
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