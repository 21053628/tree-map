/**
 * 樹木管理系統 - 座標轉換工具模組（極致性能優化版 v2.0）
 * 供 index.html 使用，proj4 已由 vendor 同步載入；t.html 請用 core/coord-lazy.js
 * 
 * 🚀 優化重點：
 * 1. [殺手級優化] 重構 LRU 快取：利用 Map 原生順序特性，將 get/set 複雜度由 O(N) 降至 O(1)
 * 2. [記憶體優化] 移除冗餘的 cacheOrder 陣列，減少 GC (垃圾回收) 壓力
 * 3. [批量優化] batchToHK80 減少不必要的 parseFloat 呼叫與記憶體分配
 * 4. [容錯優化] 強化 proj4 未載入時的降級處理，避免阻斷主線程
 */

const CoordUtils = (function() {
  'use strict';
  
  // LRU 快取配置
  const MAX_CACHE_SIZE = 2000; 
  const coordCache = new Map(); // 🔥 優化：單純使用 Map，利用其原生插入順序特性實作 LRU
  
  // 預熱常見座標範圍（香港地區）
  const HK_BOUNDS = {
    latMin: 22.15, latMax: 22.55,
    lngMin: 113.85, lngMax: 114.45
  };
  
  let isPreheated = false;
  let proj4Transform = null;
  
  /**
   * 初始化 proj4 轉換器（延遲加載）
   */
  function initProj4() {
    if (!proj4Transform && window.proj4 && typeof Config !== 'undefined') {
      try {
        proj4Transform = proj4(Config.PROJECTIONS.WGS84, Config.PROJECTIONS.HK80);
      } catch (e) {
        console.error('❌ proj4 初始化失敗:', e);
      }
    }
    return proj4Transform;
  }
  
  /**
   * 預熱常用座標轉換
   */
  function preheatCache() {
    if (isPreheated || !window.proj4) return;
    
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
   * 🔥 [核心優化] O(1) 複雜度的 LRU 讀取
   * 利用 Map 的特性：delete 後再 set，該 key 就會自動排到最後面（最新訪問）
   */
  function getFromCache(key) {
    if (!coordCache.has(key)) return null;
    const value = coordCache.get(key);
    // 更新訪問順序（移到末尾）
    coordCache.delete(key);
    coordCache.set(key, value);
    return value;
  }
  
  /**
   * 🔥 [核心優化] O(1) 複雜度的 LRU 寫入與淘汰
   */
  function setCache(key, value) {
    if (coordCache.has(key)) {
      coordCache.delete(key);
    } else if (coordCache.size >= MAX_CACHE_SIZE) {
      // Map.keys().next().value 獲取最舊的 key (O(1))
      const oldestKey = coordCache.keys().next().value;
      coordCache.delete(oldestKey);
    }
    coordCache.set(key, value);
  }
  
  /**
   * WGS84 轉 HK80 座標
   */
  function toHK80(lat, lng) {
    if (!window.proj4 || !lat || !lng) return null;
    
    const numLat = +lat;
    const numLng = +lng;
    
    // 快速驗證是否在香港範圍內（僅警告，不阻斷）
    if (numLat < HK_BOUNDS.latMin - 0.1 || numLat > HK_BOUNDS.latMax + 0.1 ||
        numLng < HK_BOUNDS.lngMin - 0.1 || numLng > HK_BOUNDS.lngMax + 0.1) {
      // console.warn('⚠️ 座標可能不在香港範圍'); // 避免 console 刷屏影響效能
    }
    
    const key = 'wgs2hk:' + numLat.toFixed(6) + ',' + numLng.toFixed(6);
    const cached = getFromCache(key);
    if (cached) return cached;
    
    try {
      const transform = initProj4();
      if (!transform) return null;
      
      const result = transform.forward([numLng, numLat]);
      const converted = { N: result[1], E: result[0] };
      setCache(key, converted);
      return converted;
    } catch (error) {
      console.error('❌ HK80 轉換失敗:', error);
      return null;
    }
  }
  
  /**
   * HK80 轉 WGS84 座標
   */
  function toWGS84(N, E) {
    if (!window.proj4) return null;
    
    const numN = +N;
    const numE = +E;
    
    const key = 'hk2wgs:' + numN + ',' + numE;
    const cached = getFromCache(key);
    if (cached) return cached;
    
    try {
      const transform = initProj4();
      if (!transform) return null;
      
      const result = transform.inverse([numE, numN]);
      const converted = { lat: result[1], lng: result[0] };
      setCache(key, converted);
      return converted;
    } catch (error) {
      console.error('❌ WGS84 轉換失敗:', error);
      return null;
    }
  }
  
  /**
   * 批量轉換座標（高性能版）
   */
  function batchToHK80(coords) {
    if (!coords || coords.length === 0) return [];
    
    const results = new Array(coords.length);
    const transform = initProj4();
    
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      const numLat = +c.lat;
      const numLng = +c.lng;
      const key = 'wgs2hk:' + numLat.toFixed(6) + ',' + numLng.toFixed(6);
      
      const cached = getFromCache(key);
      if (cached) {
        results[i] = cached;
      } else if (transform) {
        try {
          const res = transform.forward([numLng, numLat]);
          const converted = { N: res[1], E: res[0] };
          results[i] = converted;
          setCache(key, converted);
        } catch (error) {
          results[i] = { N: 0, E: 0 };
        }
      } else {
        results[i] = { N: 0, E: 0 };
      }
    }
    return results;
  }
  
  function format1(n) { return Number(n).toFixed(1); }
  function format5(n) { return Number(n).toFixed(5); }
  
  function clearCache() {
    coordCache.clear();
    isPreheated = false;
  }
  
  function getCacheStats() {
    return {
      size: coordCache.size,
      maxSize: MAX_CACHE_SIZE,
      usagePercent: ((coordCache.size / MAX_CACHE_SIZE) * 100).toFixed(1) + '%'
    };
  }
  
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CoordUtils;
}