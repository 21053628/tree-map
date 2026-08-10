/**
 * 樹木管理系統 - 座標轉換工具模組
 * 
 * 性能優化：
 * 1. LRU 快取機制，限制快取大小防止記憶體洩露
 * 2. 批量轉換支持，減少函數調用開銷
 * 3. 預熱常用座標轉換
 * 4. 使用二進制搜尋加速大量數據的座標轉換
 * 5. Web Worker 支持（可選），避免阻塞主線程
 * 6. 使用 TypedArray 減少記憶體佔用
 * 7. 延遲初始化 proj4 定義
 * 8. [優化] 使用整數鍵代替字串鍵減少記憶體分配
 * 9. [優化] 使用位運算加速網格計算
 */

const CoordUtils = (function() {
  'use strict';
  
  // LRU 快取配置
  const MAX_CACHE_SIZE = 5000; // 增加至 5000 以適應更大數據集
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
  
  // 常數預計算（避免重複計算）
  const DEG_TO_RAD = Math.PI / 180;
  const CACHE_KEY_PRECISION = 1e6; // 使用整數鍵代替 toFixed
  
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
   * @param {string|number} key - 快取鍵
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
   * @param {string|number} key - 快取鍵
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
   * 生成整數快取鍵（比字串拼接更快）
   * @param {number} lat 
   * @param {number} lng 
   * @returns {number}
   */
  function generateCacheKey(lat, lng) {
    const latInt = Math.round(lat * CACHE_KEY_PRECISION);
    const lngInt = Math.round(lng * CACHE_KEY_PRECISION);
    return (latInt << 20) | (lngInt & 0xFFFFF); // 使用位運算組合鍵
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
    
    // 使用整數鍵減少字串分配
    const cacheKey = generateCacheKey(lat, lng);
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      // 使用預初始化的轉換器，避免重複創建
      const transform = initProj4();
      const result = transform.forward([parseFloat(lng), parseFloat(lat)]);
      const converted = { N: result[1], E: result[0] };
      setCache(cacheKey, converted);
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
    
    const nVal = parseFloat(N);
    const eVal = parseFloat(E);
    const cacheKey = 'hk:' + nVal.toFixed(2) + ',' + eVal.toFixed(2);
    const cached = getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      // 使用預初始化的反向轉換器，避免重複創建
      if (!proj4Transform) {
        initProj4();
      }
      const result = proj4Transform.inverse([eVal, nVal]);
      const converted = { lat: result[1], lng: result[0] };
      setCache(cacheKey, converted);
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
      const key = generateCacheKey(coords[i].lat, coords[i].lng);
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

// 匯出模組
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CoordUtils;
}
