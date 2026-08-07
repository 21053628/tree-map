/**
 * 樹木管理系統 - API 服務模組
 * 
 * 改進：
 * 1. 集中管理 API 請求
 * 2. 加入錯誤處理和重試機制
 * 3. 超時控制
 * 4. 請求狀態追蹤
 */

const ApiService = (function() {
  'use strict';
  
  const DEFAULT_TIMEOUT = 15000; // 15 秒超時
  const MAX_RETRIES = 2; // 最大重試次數
  const RETRY_DELAY = 1000; // 重試間隔（毫秒）
  
  let apiEndpoint = null;
  let requestCount = 0;
  let errorCount = 0;
  
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
   * GET 請求
   * @param {string} action - API 動作
   * @param {object} params - 查詢參數
   * @returns {Promise<object>}
   */
  async function get(action, params = {}) {
    if (!apiEndpoint) {
      throw new Error('API 服務未初始化');
    }
    
    requestCount++;
    const queryString = new URLSearchParams(params).toString();
    const url = `${apiEndpoint}?action=${action}${queryString ? '&' + queryString : ''}`;
    
    return withRetry(() => 
      fetchWithTimeout(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
      })
    );
  }
  
  /**
   * POST 請求
   * @param {object} payload - 請求數據
   * @returns {Promise<object>}
   */
  async function post(payload) {
    if (!apiEndpoint) {
      throw new Error('API 服務未初始化');
    }
    
    requestCount++;
    
    return withRetry(() =>
      fetchWithTimeout(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
      })
    );
  }
  
  /**
   * 獲取統計信息
   * @returns {object}
   */
  function getStats() {
    return {
      totalRequests: requestCount,
      totalErrors: errorCount,
      successRate: requestCount > 0 
        ? ((requestCount - errorCount) / requestCount * 100).toFixed(1) + '%'
        : 'N/A'
    };
  }
  
  /**
   * 重置統計
   */
  function resetStats() {
    requestCount = 0;
    errorCount = 0;
  }
  
  // 公開 API
  return {
    init,
    get,
    post,
    getStats,
    resetStats
  };
})();

// 匯出模組
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ApiService;
}
