/**
 * @deprecated 薄轉發層 — 統一至 assets/js/core/coordinates.js
 * 供 t.html plain script 使用，維持 CoordLazy 非同步介面；內部優先委派至統一模組（若已載入），否則回退至自帶 LRU 實現。
 * 新代碼請改為： import { toHK80Async, toWGS84Async } from './core/coordinates.js'
 */
(function () {
  'use strict';
  var _g = typeof globalThis !== 'undefined' ? globalThis : window;
  // 若統一模組已載入（透過 ESM 設定 globalThis.CoordUtils），直接委派
  function hasUnified(){ return _g.CoordUtils && typeof _g.CoordUtils.toHK80Async==='function'; }
  // 回退：自帶 LRU + ensureProj4（修正 !lat 誤判、統一 key、2000 上限）
  var HK80 = '+proj=tmerc +lat_0=22.31213333333334 +lon_0=114.1785555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.067753,-2.243649,-1.158827,-1.094246 +units=m +no_defs';
  var WGS84 = '+proj=longlat +datum=WGS84 +no_defs';
  var MAX_CACHE_SIZE = 2000;
  var coordCache = new Map();
  var proj4Promise = null;
  function getFromCache(k){ if(!coordCache.has(k)) return null; var v=coordCache.get(k); coordCache.delete(k); coordCache.set(k,v); return v; }
  function setCache(k,v){ if(coordCache.has(k)) coordCache.delete(k); else if(coordCache.size>=MAX_CACHE_SIZE){ var oldest=coordCache.keys().next().value; coordCache.delete(oldest);} coordCache.set(k,v); }
  function ensureProj4() {
    if (_g.proj4) return Promise.resolve(_g.proj4);
    if (proj4Promise) return proj4Promise;
    proj4Promise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      // t.html 位於根目錄，vendor 相對路徑為 assets/vendor/proj4.js；若在子目錄則嘗試第二路徑
      s.src = 'assets/vendor/proj4.js';
      s.onload = function () { resolve(_g.proj4); };
      s.onerror = function () {
        try{
          var s2=document.createElement('script'); s2.src='../../assets/vendor/proj4.js';
          s2.onload=function(){ resolve(_g.proj4); }; s2.onerror=function(){ reject(new Error('proj4 載入失敗')); };
          document.head.appendChild(s2);
        }catch(e){ reject(e); }
      };
      document.head.appendChild(s);
    });
    return proj4Promise;
  }
  async function toHK_fallback(lat, lng) {
    if(lat===''||lat==null||lat===undefined) return null; if(lng===''||lng==null||lng===undefined) return null;
    var numLat=Number(lat),numLng=Number(lng); if(!Number.isFinite(numLat)||!Number.isFinite(numLng)) return null;
    var key='wgs2hk:'+numLat.toFixed(6)+','+numLng.toFixed(6); var hit=getFromCache(key); if(hit) return hit;
    try{ var proj=await ensureProj4(); var r=proj(WGS84, HK80, [numLng, numLat]); var out={N:r[1],E:r[0]}; setCache(key,out); return out; }catch(e){ return null; }
  }
  async function toWGS_fallback(N, E) {
    if(N===''||N==null||N===undefined) return null; if(E===''||E==null||E===undefined) return null;
    var numN=Number(N),numE=Number(E); if(!Number.isFinite(numN)||!Number.isFinite(numE)) return null;
    var key='hk2wgs:'+numN+','+numE; var hit=getFromCache(key); if(hit) return hit;
    try{ var proj=await ensureProj4(); var r=proj(HK80, WGS84, [numE, numN]); var out={lat:r[1],lng:r[0]}; setCache(key,out); return out; }catch(e){ return null; }
  }
  function wrapAsync(fnUnified, fnFallback){
    return function(a,b){
      if(hasUnified()) return fnUnified(a,b);
      return fnFallback(a,b);
    };
  }
  // 建立 CoordLazy
  var toHK = hasUnified() ? function(lat,lng){ return _g.CoordUtils.toHK80Async(lat,lng); } : toHK_fallback;
  var toWGS = hasUnified() ? function(N,E){ return _g.CoordUtils.toWGS84Async(N,E); } : toWGS_fallback;
  // 動態委派：每次呼叫時檢查統一模組是否已就緒
  _g.CoordLazy = {
    toHK: function(lat,lng){ if(hasUnified()) return _g.CoordUtils.toHK80Async(lat,lng); return toHK_fallback(lat,lng); },
    toWGS: function(N,E){ if(hasUnified()) return _g.CoordUtils.toWGS84Async(N,E); return toWGS_fallback(N,E); },
    toHK80: function(lat,lng){ if(hasUnified()) return _g.CoordUtils.toHK80(lat,lng); return null; },
    toWGS84: function(N,E){ if(hasUnified()) return _g.CoordUtils.toWGS84(N,E); return null; },
    toHK80Async: function(lat,lng){ if(hasUnified()) return _g.CoordUtils.toHK80Async(lat,lng); return toHK_fallback(lat,lng); },
    toWGS84Async: function(N,E){ if(hasUnified()) return _g.CoordUtils.toWGS84Async(N,E); return toWGS_fallback(N,E); }
  };
  // 若統一模組稍後載入，立即同步快取與方法
  try{
    document.addEventListener('DOMContentLoaded', function(){
      if(hasUnified()){
        // 嘗試合併快取（可選）
      }
    });
  }catch(e){}
})();