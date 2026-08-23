/**
 * 統一快取管理器 - 收斂 responseCache / localStorage / SW 失效入口
 * 依賴：CachePolicy（可選，未載入時回退預設 60s/1h）
 */
(function(global){
  'use strict';
  function resolveMemoryTtl(action){
    try { if(global.CachePolicy) return global.CachePolicy.getMemoryTtl(action); } catch(e) {}
    return 60*1000;
  }
  function resolveSwMaxAge(action){
    try { if(global.CachePolicy) return global.CachePolicy.getSwMaxAge(action); } catch(e) {}
    return 3600000;
  }

  // 通知 SW 清指定 DATA_CACHE 條目（與 sw.js:INVALIDATE_DATA_CACHE 對應）
  function notifySwInvalidate(type, payload){
    try {
      if(!global.navigator || !global.navigator.serviceWorker || !global.navigator.serviceWorker.controller) return;
      var msg = { type: 'INVALIDATE_DATA_CACHE', invalidateType: type, payload: payload||null };
      global.navigator.serviceWorker.controller.postMessage(msg);
    } catch(e) {}
    // 回退：若無 controller，嘗試經 ready 再發（短延時）
    try {
      if(global.navigator && global.navigator.serviceWorker && global.navigator.serviceWorker.ready){
        global.navigator.serviceWorker.ready.then(function(reg){
          if(reg && reg.active) reg.active.postMessage({ type: 'INVALIDATE_DATA_CACHE', invalidateType: type, payload: payload||null });
        }).catch(function(){});
      }
    } catch(e2) {}
  }

  var CacheManager = {
    resolveMemoryTtl: resolveMemoryTtl,
    resolveSwMaxAge: resolveSwMaxAge,
    notifySwInvalidate: notifySwInvalidate
  };

  if (typeof global !== 'undefined') global.CacheManager = CacheManager;
  if (typeof module !== 'undefined' && module.exports) module.exports = CacheManager;
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
