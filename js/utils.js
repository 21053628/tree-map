/**
 * 樹木管理系統 - 座標轉換工具模組
 * 
 * 改進：
 * 1. 抽取共用函數避免重複
 * 2. 加入快取機制提升效能
 * 3. 完整的錯誤處理
 */

const CoordUtils = (function() {
  'use strict';
  
  const coordCache = new Map();
  
  /**
   * WGS84 轉 HK80 座標
   * @param {number} lat - 緯度
   * @param {number} lng - 經度
   * @returns {{N: number, E: number}|null} HK80 座標
   */
  function toHK80(lat, lng) {
    if (!window.proj4 || !lat || !lng) {
      console.warn('⚠️ proj4 未載入或座標無效');
      return null;
    }
    
    const key = `wgs2hk:${lat},${lng}`;
    if (coordCache.has(key)) {
      return coordCache.get(key);
    }
    
    try {
      const result = proj4(Config.PROJECTIONS.WGS84, Config.PROJECTIONS.HK80, [parseFloat(lng), parseFloat(lat)]);
      const converted = { N: result[1], E: result[0] };
      coordCache.set(key, converted);
      return converted;
    } catch (error) {
      console.error('❌ HK80 轉換失敗:', error);
      return null;
    }
  }
  
  /**
   * HK80 轉 WGS84 座標
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
    if (coordCache.has(key)) {
      return coordCache.get(key);
    }
    
    try {
      const result = proj4(Config.PROJECTIONS.HK80, Config.PROJECTIONS.WGS84, [parseFloat(E), parseFloat(N)]);
      const converted = { lat: result[1], lng: result[0] };
      coordCache.set(key, converted);
      return converted;
    } catch (error) {
      console.error('❌ WGS84 轉換失敗:', error);
      return null;
    }
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
  }
  
  // 公開 API
  return {
    toHK80,
    toWGS84,
    format1,
    format5,
    clearCache
  };
})();

// 匯出模組
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CoordUtils;
}
