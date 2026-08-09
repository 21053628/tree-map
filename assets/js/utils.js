/**
 * 樹木管理系統 - 自定義錯誤類別
 * 
 * 統一錯誤處理機制：
 * 1. 定義標準化的錯誤類型
 * 2. 提供結構化的錯誤資訊
 * 3. 支援錯誤追蹤和日誌記錄
 */

/**
 * 基礎應用錯誤類別
 */
export class AppError extends Error {
  constructor(message, code = 'UNKNOWN_ERROR', details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    
    // 保留堆疊追蹤
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}

/**
 * API 相關錯誤
 */
export class ApiError extends AppError {
  constructor(message, statusCode = null, endpoint = null, details = {}) {
    super(message, 'API_ERROR', {
      statusCode,
      endpoint,
      ...details
    });
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
  }
}

/**
 * 認證相關錯誤
 */
export class AuthError extends AppError {
  constructor(message, code = 'AUTH_ERROR', details = {}) {
    super(message, code, details);
    this.name = 'AuthError';
  }
}

/**
 * 驗證錯誤
 */
export class ValidationError extends AppError {
  constructor(message, field = null, details = {}) {
    super(message, 'VALIDATION_ERROR', {
      field,
      ...details
    });
    this.name = 'ValidationError';
    this.field = field;
  }
}

/**
 * 網路錯誤
 */
export class NetworkError extends AppError {
  constructor(message, isTimeout = false, details = {}) {
    super(message, isTimeout ? 'TIMEOUT_ERROR' : 'NETWORK_ERROR', {
      isTimeout,
      ...details
    });
    this.name = 'NetworkError';
    this.isTimeout = isTimeout;
  }
}

/**
 * 快取錯誤
 */
export class CacheError extends AppError {
  constructor(message, cacheKey = null, details = {}) {
    super(message, 'CACHE_ERROR', {
      cacheKey,
      ...details
    });
    this.name = 'CacheError';
    this.cacheKey = cacheKey;
  }
}

/**
 * 配置錯誤
 */
export class ConfigError extends AppError {
  constructor(message, configKey = null, details = {}) {
    super(message, 'CONFIG_ERROR', {
      configKey,
      ...details
    });
    this.name = 'ConfigError';
    this.configKey = configKey;
  }
}

/**
 * 統一錯誤處理器
 */
export class ErrorHandler {
  static handlers = new Map();

  /**
   * 註冊錯誤處理器
   * @param {string} errorCode - 錯誤代碼
   * @param {Function} handler - 處理函數
   */
  static register(errorCode, handler) {
    this.handlers.set(errorCode, handler);
  }

  /**
   * 處理錯誤
   * @param {Error|AppError} error - 錯誤對象
   * @param {Object} context - 額外上下文資訊
   * @returns {Promise<void>}
   */
  static async handle(error, context = {}) {
    console.error('[ErrorHandler]', error);

    // 記錄錯誤到日誌服務（可擴展）
    if (context.logToServer !== false) {
      await this.logToServer(error, context);
    }

    // 尋找對應的處理器
    const errorCode = error.code || 'UNKNOWN_ERROR';
    const handler = this.handlers.get(errorCode) || this.handlers.get('UNKNOWN_ERROR');

    if (handler) {
      try {
        return await handler(error, context);
      } catch (handlerError) {
        console.error('[ErrorHandler] 處理器失敗:', handlerError);
      }
    }

    // 預設處理：顯示使用者友善訊息
    return this.showUserFriendlyMessage(error);
  }

  /**
   * 記錄錯誤到伺服器（可實作）
   */
  static async logToServer(error, context) {
    // TODO: 實作伺服器端錯誤日誌記錄
    console.log('[ErrorLog]', {
      error: error.toJSON?.() || { message: error.message, stack: error.stack },
      context,
      userAgent: navigator?.userAgent,
      url: window?.location?.href
    });
  }

  /**
   * 顯示使用者友善的錯誤訊息
   */
  static showUserFriendlyMessage(error) {
    const messages = {
      'API_ERROR': '伺服器連線失敗，請檢查網路後再試',
      'AUTH_ERROR': '登入已過期，請重新登入',
      'VALIDATION_ERROR': '資料格式不正確，請檢查輸入',
      'TIMEOUT_ERROR': '請求超時，請檢查網路連線',
      'NETWORK_ERROR': '網路連線失敗，請檢查網路設定',
      'CACHE_ERROR': '快取異常，請重新整理頁面',
      'CONFIG_ERROR': '系統配置錯誤，請聯絡管理員'
    };

    const userMessage = messages[error.code] || '發生未知錯誤，請稍後再試';
    
    // 可在這裡整合 UI 通知系統
    if (typeof window !== 'undefined' && window.alert) {
      // 避免頻繁彈窗，改用 console 或自定義通知
      console.warn('[UserMessage]', userMessage);
    }

    return {
      success: false,
      message: userMessage,
      technicalDetails: error.message
    };
  }
}

/**
 * 非同步函數包裝器，自動捕獲錯誤
 * @param {Function} fn - 非同步函數
 * @param {Object} options - 選項
 * @returns {Function}
 */
export function wrapAsync(fn, options = {}) {
  return async function(...args) {
    try {
      return await fn.apply(this, args);
    } catch (error) {
      if (options.handleError !== false) {
        return await ErrorHandler.handle(error, options.context || {});
      }
      throw error;
    }
  };
}

const CoordUtils = (function() {
  'use strict';
  
  // LRU 快取配置
  const MAX_CACHE_SIZE = 2000; // 增加快取大小至 2000，減少重複計算
  const coordCache = new Map();
  const cacheOrder = []; // 維護插入順序用於 LRU
  
  // 預熱常見座標範圍（香港地區）
  const HK_BOUNDS = {
    latMin: 22.15, latMax: 22.55,
    lngMin: 113.85, lngMax: 114.45
  };
  
  // 預熱常用轉換結果
  let isPreheated = false;
  
  // 延遲加載的 proj4 轉換器（性能優化）
  let proj4Transform = null;
  
  /**
   * 初始化 proj4 轉換器（延遲加載）
   */
  function initProj4() {
    if (!proj4Transform && window.proj4) {
      proj4Transform = proj4(Config.PROJECTIONS.WGS84, Config.PROJECTIONS.HK80);
    }
    return proj4Transform;
  }
  
  /**
   * 預熱常用座標轉換
   */
  function preheatCache() {
    if (isPreheated) return;
    
    // 預熱香港主要地標座標
    const landmarks = [
      { lat: 22.2783, lng: 114.1748 }, // 維多利亞公園
      { lat: 22.2952, lng: 114.1722 }, // 銅鑼灣
      { lat: 22.3167, lng: 114.1833 }, // 尖沙咀
      { lat: 22.3500, lng: 114.1833 }, // 紅磡
      { lat: 22.4000, lng: 114.2000 }  // 沙田
    ];
    
    for (let i = 0; i < landmarks.length; i++) {
      toHK80(landmarks[i].lat, landmarks[i].lng);
    }
    
    isPreheated = true;
  }
  
  /**
   * 從快取中獲取並更新訪問順序
   * @param {string} key - 快取鍵
   * @returns {any|null}
   */
  function getFromCache(key) {
    if (!coordCache.has(key)) return null;
    
    // 更新訪問順序（移到末尾）
    const idx = cacheOrder.indexOf(key);
    if (idx > -1) {
      cacheOrder.splice(idx, 1);
      cacheOrder.push(key);
    }
    
    return coordCache.get(key);
  }
  
  /**
   * 設置快取並維護 LRU 順序
   * @param {string} key - 快取鍵
   * @param {any} value - 快取值
   */
  function setCache(key, value) {
    // 如果已存在，先移除舊的順序記錄
    if (coordCache.has(key)) {
      const idx = cacheOrder.indexOf(key);
      if (idx > -1) cacheOrder.splice(idx, 1);
    }
    
    // 如果達到上限，移除最久未使用的條目
    while (coordCache.size >= MAX_CACHE_SIZE && cacheOrder.length > 0) {
      const oldestKey = cacheOrder.shift();
      coordCache.delete(oldestKey);
    }
    
    coordCache.set(key, value);
    cacheOrder.push(key);
  }
  
  /**
   * WGS84 轉 HK80 座標（優化版）
   * @param {number} lat - 緯度
   * @param {number} lng - 經度
   * @returns {{N: number, E: number}|null} HK80 座標
   */
  function toHK80(lat, lng) {
    if (!window.proj4 || !lat || !lng) {
      console.warn('⚠️ proj4 未載入或座標無效');
      return null;
    }
    
    // 快速驗證是否在香港範圍內
    if (lat < HK_BOUNDS.latMin - 0.1 || lat > HK_BOUNDS.latMax + 0.1 ||
        lng < HK_BOUNDS.lngMin - 0.1 || lng > HK_BOUNDS.lngMax + 0.1) {
      console.warn('⚠️ 座標可能不在香港範圍');
    }
    
    const key = `wgs2hk:${lat.toFixed(6)},${lng.toFixed(6)}`;
    const cached = getFromCache(key);
    if (cached) return cached;
    
    try {
      // 使用預初始化的轉換器，避免重複創建
      const transform = initProj4();
      const result = transform.forward([parseFloat(lng), parseFloat(lat)]);
      const converted = { N: result[1], E: result[0] };
      setCache(key, converted);
      return converted;
    } catch (error) {
      console.error('❌ HK80 轉換失敗:', error);
      return null;
    }
  }
  
  /**
   * HK80 轉 WGS84 座標（優化版）
   * @param {number|string} N - 北距
   * @param {number|string} E - 東距
   * @returns {{lat: number, lng: number}|null} WGS84 座標
   */
  function toWGS84(N, E) {
    if (!window.proj4) {
      console.warn('⚠️ proj4 未載入');
      return null;
    }
    
    const key = `hk2wgs:${N},${E}`;
    const cached = getFromCache(key);
    if (cached) return cached;
    
    try {
      // 使用預初始化的反向轉換器，避免重複創建
      if (!proj4Transform) {
        initProj4();
      }
      const result = proj4Transform.inverse([parseFloat(E), parseFloat(N)]);
      const converted = { lat: result[1], lng: result[0] };
      setCache(key, converted);
      return converted;
    } catch (error) {
      console.error('❌ WGS84 轉換失敗:', error);
      return null;
    }
  }
  
  /**
   * 批量轉換座標（高性能版 - 使用文檔碎片和批量處理）
   * @param {Array<{lat:number,lng:number}>} coords - WGS84 座標陣列
   * @returns {Array<{N:number,E:number}>} HK80 座標陣列
   */
  function batchToHK80(coords) {
    const results = new Array(coords.length);
    const toConvert = [];
    const cacheKeys = [];
    
    // 第一遍：檢查快取
    for (let i = 0; i < coords.length; i++) {
      const key = `wgs2hk:${coords[i].lat.toFixed(6)},${coords[i].lng.toFixed(6)}`;
      cacheKeys.push(key);
      const cached = getFromCache(key);
      if (cached) {
        results[i] = cached;
      } else {
        toConvert.push({ index: i, coord: coords[i], key: key });
      }
    }
    
    // 第二遍：批量轉換未快取的座標
    const transform = initProj4();
    if (transform) {
      for (let i = 0; i < toConvert.length; i++) {
        const item = toConvert[i];
        try {
          const result = transform.forward([parseFloat(item.coord.lng), parseFloat(item.coord.lat)]);
          const converted = { N: result[1], E: result[0] };
          results[item.index] = converted;
          setCache(item.key, converted);
        } catch (error) {
          console.error('❌ 批量轉換失敗:', error);
          results[item.index] = { N: 0, E: 0 };
        }
      }
    } else {
      // proj4 不可用時的降級處理
      for (let i = 0; i < toConvert.length; i++) {
        results[toConvert[i].index] = { N: 0, E: 0 };
      }
    }
    
    return results;
  }
  
  /**
   * 格式化數字（小數點後 1 位）
   * @param {number} n - 數字
   * @returns {string} 格式化後的字串
   */
  function format1(n) {
    return Number(n).toFixed(1);
  }
  
  /**
   * 格式化數字（小數點後 5 位）
   * @param {number} n - 數字
   * @returns {string} 格式化後的字串
   */
  function format5(n) {
    return Number(n).toFixed(5);
  }
  
  /**
   * 清除座標快取
   */
  function clearCache() {
    coordCache.clear();
    cacheOrder.length = 0;
    isPreheated = false;
  }
  
  /**
   * 獲取快取統計信息
   * @returns {object}
   */
  function getCacheStats() {
    return {
      size: coordCache.size,
      maxSize: MAX_CACHE_SIZE,
      usagePercent: ((coordCache.size / MAX_CACHE_SIZE) * 100).toFixed(1) + '%'
    };
  }
  
  // 公開 API
  return {
    toHK80,
    toWGS84,
    batchToHK80,
    format1,
    format5,
    clearCache,
    getCacheStats,
    preheatCache
  };
})();

// ES6 Modules 匯出
export { CoordUtils };

// CommonJS 匯出（如需 Node.js 環境使用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CoordUtils, AppError, ApiError, AuthError, ValidationError, NetworkError, CacheError, ConfigError, ErrorHandler, wrapAsync };
}
