/**
 * @deprecated 統一座標工具已遷移至 assets/js/core/coordinates.js
 * 本檔僅為向後兼容 shim：若統一模組已載入則直接復用，否則提供最小 fallback 並在統一模組載入後自動替換。
 * 新代碼請改為： import { toHK80, toWGS84 } from './core/coordinates.js' 或使用全域 CoordUtils (由 coordinates.js 提供)。
 */

// shim: 若統一模組已透過 ESM 載入並設定 globalThis.CoordUtils，則沿用；否則提供最小 fallback 並等待統一模組覆蓋
(function(){
  'use strict';
  var g = typeof globalThis!=='undefined'?globalThis:window;
  if(g.CoordUtils && g.CoordUtils.toHK80) return; // 已由 core/coordinates.js 提供
  // 最小 fallback（避免在 coordinates.js 載入前的短暫空窗期報錯）
  var _fallback={
    toHK80:function(){return null;}, toWGS84:function(){return null;}, toHK:function(){return null;}, toWGS:function(){return null;},
    batchToHK80:function(){return [];}, format1:function(n){return Number(n).toFixed(1);}, format5:function(n){return Number(n).toFixed(5);},
    clearCache:function(){}, getCacheStats:function(){return{size:0,maxSize:2000,usagePercent:'0%'};}, preheatCache:function(){},
    isValidHK80:function(){return false;}, isValidWGS84:function(){return false;}
  };
  g.CoordUtils=_fallback;
  // 注意：不再動態載入統一模組，因為 HTML 已包含 <script type="module" src="assets/js/core/coordinates.js">
  // 避免重複載入造成兩次執行。coordinates.js 模組載入後會自動覆蓋 globalThis.CoordUtils。
})();