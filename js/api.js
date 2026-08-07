/**
 * 樹木管理系統 - API 服務模組
 * 
 * 性能優化：
 * 1. 請求結果快取，減少重複 API 調用
 * 2. 請求隊列與防抖動機制
 * 3. 並行請求限制
 * 4. 響應數據壓縮支持
 * 5. 增加快取 TTL 至 60 秒
 * 6. 提高並行請求數至 5
 */

const ApiService = (function() {
  'use strict';
  
  const DEFAULT_TIMEOUT = 15000; // 15 秒超時
  const MAX_RETRIES = 2; // 最大重試次數
  const RETRY_DELAY = 1000; // 重試間隔（毫秒）
  const CACHE_TTL = 60000; // 快取有效期 60 秒（增加至 60 秒）
  const MAX_CONCURRENT = 5; // 最大並行請求數（增加至 5）
  
  let apiEndpoint = null;
  let requestCount = 0;
  let errorCount = 0;
  let cacheHitCount = 0;
  
  // 響應快取
  const responseCache = new Map();
  
  // 請求隊列
  let pendingRequests = [];
  let activeRequests = 0;
  
  // 防抖動定時器
  let debounceTimer = null;
  const DEBOUNCE_DELAY = 300; // 300ms 防抖動
  
  /**
   * 初始化 API 服務
   * @param {string} endpoint - API 端點
   */
  function init(endpoint) {
    if (!endpoint) {
      throw new Error('API 端點未提供');
    }
    apiEndpoint = endpoint;
    console.log('✅ API 服務已初始化:', endpoint);
  }
  
  /**
   * 從快取獲取數據
   * @param {string} key - 快取鍵
   * @returns {any|null}
   */
  function getFromCache(key) {
    const cached = responseCache.get(key);
    if (!cached) return null;
    
    const now = Date.now();
    if (now - cached.timestamp > CACHE_TTL) {
      responseCache.delete(key);
      return null;
    }
    
    cacheHitCount++;
    return cached.data;
  }
  
  /**
   * 設置快取
   * @param {string} key - 快取鍵
   * @param {any} data - 數據
   */
  function setCache(key, data) {
    // 清理過期快取
    const now = Date.now();
    for (const [k, v] of responseCache.entries()) {
      if (now - v.timestamp > CACHE_TTL) {
        responseCache.delete(k);
      }
    }
    
    responseCache.set(key, {
      data: data,
      timestamp: now
    });
  }
  
  /**
   * 帶超時控制的 fetch 請求
   * @param {string} url - 請求 URL
   * @param {object} options - fetch 選項
   * @returns {Promise<Response>}
   */
  function fetchWithTimeout(url, options = {}, timeout = DEFAULT_TIMEOUT) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    return fetch(url, { ...options, signal: controller.signal })
      .then(response => {
        clearTimeout(timeoutId);
        return response;
      })
      .catch(error => {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          throw new Error(`請求超時（${timeout}ms）`);
        }
        throw error;
      });
  }
  
  /**
   * 處理請求隊列
   */
  function processQueue() {
    while (activeRequests < MAX_CONCURRENT && pendingRequests.length > 0) {
      const { resolve, reject, requestFn } = pendingRequests.shift();
      activeRequests++;
      
      requestFn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          activeRequests--;
          processQueue();
        });
    }
  }
  
  /**
   * 將請求加入隊列
   * @param {Function} requestFn - 請求函數
   * @returns {Promise<any>}
   */
  function enqueueRequest(requestFn) {
    return new Promise((resolve, reject) => {
      pendingRequests.push({ resolve, reject, requestFn });
      processQueue();
    });
  }
  
  /**
   * 帶重試機制的 API 請求
   * @param {Function} requestFn - 請求函數
   * @param {number} retries - 剩餘重試次數
   * @returns {Promise<any>}
   */
  async function withRetry(requestFn, retries = MAX_RETRIES) {
    try {
      return await requestFn();
    } catch (error) {
      errorCount++;
      if (retries > 0) {
        console.warn(`⚠️ 請求失敗，${retries}秒後重試... (${MAX_RETRIES - retries + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        return withRetry(requestFn, retries - 1);
      }
      throw error;
    }
  }
  
  /**
   * GET 請求（帶快取和隊列）
   * @param {string} action - API 動作
   * @param {object} params - 查詢參數
   * @returns {Promise<object>}
   */
  async function get(action, params = {}) {
    if (!apiEndpoint) {
      throw new Error('API 服務未初始化');
    }
    
    const queryString = new URLSearchParams(params).toString();
    const cacheKey = `get:${action}:${queryString}`;
    
    // 檢查快取
    const cached = getFromCache(cacheKey);
    if (cached) {
      return cached;
    }
    
    requestCount++;
    const url = `${apiEndpoint}?action=${action}${queryString ? '&' + queryString : ''}`;
    
    return enqueueRequest(() => 
      withRetry(() => 
        fetchWithTimeout(url, {
          method: 'GET'
        })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          return response.json();
        })
        .then(data => {
          // 存入快取
          setCache(cacheKey, data);
          return data;
        })
      )
    );
  }
  
  /**
   * POST 請求（帶隊列）
   * @param {object} payload - 請求數據
   * @returns {Promise<object>}
   */
  async function post(payload) {
    if (!apiEndpoint) {
      throw new Error('API 服務未初始化');
    }
    
    requestCount++;
    
    // POST 請求不清除快取，但會使相關快取失效
    if (payload.type) {
      invalidateCache(payload.type);
    }
    
    return enqueueRequest(() =>
      withRetry(() =>
        fetchWithTimeout(apiEndpoint, {
          method: 'POST',
          body: JSON.stringify(payload)
        })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          return response.json();
        })
      )
    );
  }
  
  /**
   * 使相關快取失效
   * @param {string} type - 操作類型
   */
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
          if (key.startsWith(p)) {
            responseCache.delete(key);
          }
        }
      });
    }
  }
  
  /**
   * 防抖動的批量載入
   * @param {Function} loadFn - 載入函數
   * @returns {Promise<void>}
   */
  function debouncedLoad(loadFn) {
    return new Promise((resolve, reject) => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      
      debounceTimer = setTimeout(() => {
        loadFn().then(resolve).catch(reject);
      }, DEBOUNCE_DELAY);
    });
  }
  
  /**
   * 清除所有快取
   */
  function clearCache() {
    responseCache.clear();
  }
  
  /**
   * 獲取統計信息
   * @returns {object}
   */
  function getStats() {
    return {
      totalRequests: requestCount,
      totalErrors: errorCount,
      cacheHits: cacheHitCount,
      hitRate: requestCount > 0 
        ? (cacheHitCount / (requestCount + cacheHitCount) * 100).toFixed(1) + '%'
        : 'N/A',
      successRate: requestCount > 0 
        ? ((requestCount - errorCount) / requestCount * 100).toFixed(1) + '%'
        : 'N/A',
      queueLength: pendingRequests.length,
      activeRequests: activeRequests,
      cacheSize: responseCache.size
    };
  }
  
  /**
   * 重置統計
   */
  function resetStats() {
    requestCount = 0;
    errorCount = 0;
    cacheHitCount = 0;
  }
  
  // 公開 API
  return {
    init,
    get,
    post,
    getStats,
    resetStats,
    clearCache,
    debouncedLoad
  };
})();

// 匯出模組
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ApiService;
}
