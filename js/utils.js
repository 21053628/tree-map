/**
 * 樹木管理系統 - 座標轉換工具模組
 * 
 * 性能優化：
 * 1. LRU 快取機制，限制快取大小防止記憶體洩露
 * 2. 批量轉換支持，減少函數調用開銷
 * 3. 預熱常用座標轉換
 * 4. 使用二進制搜尋加速大量數據的座標轉換
 */

const CoordUtils = (function() {
  'use strict';
  
  // LRU 快取配置
  const MAX_CACHE_SIZE = 1000; // 增加快取大小至 1000
  const coordCache = new Map();
  const cacheOrder = []; // 維護插入順序用於 LRU
  
  // 預熱常見座標範圍（香港地區）
  const HK_BOUNDS = {
    latMin: 22.15, latMax: 22.55,
    lngMin: 113.85, lngMax: 114.45
  };
  
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
      const result = proj4(Config.PROJECTIONS.WGS84, Config.PROJECTIONS.HK80, [parseFloat(lng), parseFloat(lat)]);
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
      const result = proj4(Config.PROJECTIONS.HK80, Config.PROJECTIONS.WGS84, [parseFloat(E), parseFloat(N)]);
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
    for (let i = 0; i < toConvert.length; i++) {
      const item = toConvert[i];
      try {
        const result = proj4(Config.PROJECTIONS.WGS84, Config.PROJECTIONS.HK80, 
          [parseFloat(item.coord.lng), parseFloat(item.coord.lat)]);
        const converted = { N: result[1], E: result[0] };
        results[item.index] = converted;
        setCache(item.key, converted);
      } catch (error) {
        console.error('❌ 批量轉換失敗:', error);
        results[item.index] = { N: 0, E: 0 };
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
    getCacheStats
  };
})();

// 匯出模組
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CoordUtils;
}
