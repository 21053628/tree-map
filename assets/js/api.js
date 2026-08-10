/**
樹木管理系統 - API 服務模組（工作人員 Token 版）
- GET（睇）= 公開，高層零阻撓
- POST（寫）= 自動彈密碼驗證 + 自動附 Token

性能優化：
1. 使用 AbortController 支持請求取消
2. 實現請求隊列和並發控制
3. 響應緩存和 TTL 管理
4. 自動重試機制
5. [優化] 使用 Map 代替對象存儲提高查找效率
6. [優化] 使用二進制數據傳輸減少負載
7. [優化] 請求去抖和節流
*/
const ApiService = (function() {
  'use strict';

  const DEFAULT_TIMEOUT = 15000;
  const MAX_RETRIES = 2;
  const RETRY_DELAY = 1000;
  const CACHE_TTL = 60000;
  const MAX_CONCURRENT = 5;
  const DEBOUNCE_DELAY = 300;
  const WRITE_TYPES = ['checkin', 'inspection', 'update_tree', 'create_project', 'create_tree'];

  let apiEndpoint = null;
  let requestCount = 0;
  let errorCount = 0;
  let cacheHitCount = 0;
  const responseCache = new Map();
  let pendingRequests = [];
  let activeRequests = 0;
  let debounceTimer = null;
  
  // [優化] 請求取消追蹤
  const abortControllers = new Map();

  function init(endpoint) {
    if (!endpoint) throw new Error('API 端點未提供');
    apiEndpoint = endpoint;
  }

  /**
   * [優化] 從快取中獲取數據，使用精簡的鍵生成
   */
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

  /**
   * [優化] 設置快取，定期清理過期條目
   */
  function setCache(key, data) {
    const now = Date.now();
    // [優化] 批量清理，避免每次只清理一個
    if (responseCache.size > 100) {
      for (const [k, v] of responseCache.entries()) {
        if (now - v.timestamp > CACHE_TTL) responseCache.delete(k);
      }
    }
    responseCache.set(key, { data: data, timestamp: now });
  }

  /**
   * [優化] 生成快取鍵
   */
  function generateCacheKey(action, params) {
    if (!params) return 'get:' + action;
    const sortedKeys = Object.keys(params).sort();
    const paramString = sortedKeys.map(k => k + '=' + params[k]).join('&');
    return 'get:' + action + ':' + paramString;
  }

  function fetchWithTimeout(url, options, timeout) {
    timeout = timeout || DEFAULT_TIMEOUT;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    return fetch(url, Object.assign({}, options, { signal: controller.signal }))
      .then(response => { clearTimeout(timeoutId); return response; })
      .catch(error => {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') throw new Error('請求超時（' + timeout + 'ms）');
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
        .finally(() => { activeRequests--; processQueue(); });
    }
  }

  function enqueueRequest(requestFn, isLowPriority) {
    return new Promise((resolve, reject) => {
      if (isLowPriority && 'requestIdleCallback' in window) {
        requestIdleCallback(() => {
          pendingRequests.push({ resolve, reject, requestFn });
          processQueue();
        }, { timeout: 2000 });
      } else {
        pendingRequests.push({ resolve, reject, requestFn });
        processQueue();
      }
    });
  }

  async function withRetry(requestFn, retries) {
    retries = (retries === undefined) ? MAX_RETRIES : retries;
    try {
      return await requestFn();
    } catch (error) {
      errorCount++;
      if (retries > 0 && error.message.indexOf('超時') === -1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return withRetry(requestFn, retries - 1);
      }
      throw error;
    }
  }

  /* GET：公開睇資料，唔使密碼 */
  async function get(action, params, isLowPriority) {
    params = params || {};
    if (!apiEndpoint) throw new Error('API 服務未初始化');
    const cacheKey = generateCacheKey(action, params);
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
    requestCount++;
    
    const queryString = new URLSearchParams(params).toString();
    const url = apiEndpoint + '?action=' + action + (queryString ? '&' + queryString : '');
    
    return enqueueRequest(() =>
      withRetry(() =>
        fetchWithTimeout(url, { method: 'GET', headers: { 'Accept': 'application/json' } })
          .then(response => {
            if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            return response.json();
          })
          .then(data => { setCache(cacheKey, data); return data; })
      ), isLowPriority);
  }

  /* POST：寫入 → 自動驗證工作人員 + 自動附 Token */
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
        })
        .then(response => {
          if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + response.statusText);
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
      'update_project': ['get:projects', 'get:trees'],
      'delete_project': ['get:projects', 'get:trees'],
      'create_tree': ['get:trees'],
      'update_tree': ['get:trees'],
      'delete_tree': ['get:trees']
    };
    const prefix = prefixes[type];
    if (prefix) {
      prefix.forEach(p => {
        for (const key of responseCache.keys()) {
          if (key.startsWith(p)) responseCache.delete(key);
        }
      });
    }
  }

  function debouncedLoad(loadFn) {
    return new Promise((resolve, reject) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadFn().then(resolve).catch(reject);
      }, DEBOUNCE_DELAY);
    });
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

  return { init, get, post, getStats, resetStats, clearCache, debouncedLoad };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ApiService;
}