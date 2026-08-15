/**
 * 座標轉換 service（lazy proj4 版）[Phase6]
 * - 保留按需延遲載入 proj4，避免阻塞首屏（與原 t.html 效能設計一致）
 * - 供 t.html 等 plain script 頁面共用，消除內嵌重複
 */
(function () {
  'use strict';

  const HK80  = '+proj=tmerc +lat_0=22.31213333333334 +lon_0=114.1785555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.067753,-2.243649,-1.158827,-1.094246 +units=m +no_defs';
  const WGS84 = '+proj=longlat +datum=WGS84 +no_defs';

  const coordCache = new Map();

  let proj4Promise = null;
  function ensureProj4() {
    if (window.proj4) return Promise.resolve(window.proj4);
    if (proj4Promise) return proj4Promise;
    proj4Promise = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = 'assets/vendor/proj4.js';
      s.onload = function () { resolve(window.proj4); };
      s.onerror = function () { reject(new Error('proj4 載入失敗')); };
      document.head.appendChild(s);
    });
    return proj4Promise;
  }

  async function toHK(lat, lng) {
    if (!lat || !lng) return null;
    const key = lat + ',' + lng;
    if (coordCache.has(key)) return coordCache.get(key);
    try {
      const proj = await ensureProj4();
      const r = proj(WGS84, HK80, [+lng, +lat]);
      const result = { N: r[1], E: r[0] };
      coordCache.set(key, result);
      return result;
    } catch (e) { return null; }
  }

  async function toWGS(N, E) {
    if (!N || !E) return null;
    const key = N + ',' + E;
    if (coordCache.has(key)) return coordCache.get(key);
    try {
      const proj = await ensureProj4();
      const r = proj(HK80, WGS84, [+E, +N]);
      const result = { lat: r[1], lng: r[0] };
      coordCache.set(key, result);
      return result;
    } catch (e) { return null; }
  }

  window.CoordLazy = {
    toHK: toHK,
    toWGS: toWGS
  };
})();