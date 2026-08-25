/**
 * 統一快取管理器 - 收斂 responseCache / localStorage / SW 失效入口（ES Module）
 * 依賴：CachePolicy（可選，由 cache-policy.js 經典腳本設定 globalThis.CachePolicy）
 */
function resolveMemoryTtl(action) {
  try { if (globalThis.CachePolicy) return globalThis.CachePolicy.getMemoryTtl(action); } catch (e) {}
  return 60 * 1000;
}

function resolveSwMaxAge(action) {
  try { if (globalThis.CachePolicy) return globalThis.CachePolicy.getSwMaxAge(action); } catch (e) {}
  return 3600000;
}

// 通知 SW 清指定 DATA_CACHE 條目（與 sw.js:INVALIDATE_DATA_CACHE 對應）
function notifySwInvalidate(type, payload) {
  try {
    if (!globalThis.navigator || !globalThis.navigator.serviceWorker || !globalThis.navigator.serviceWorker.controller) return;
    const msg = { type: 'INVALIDATE_DATA_CACHE', invalidateType: type, payload: payload || null };
    globalThis.navigator.serviceWorker.controller.postMessage(msg);
  } catch (e) {}
  // 回退：若無 controller，嘗試經 ready 再發（短延時）
  try {
    if (globalThis.navigator && globalThis.navigator.serviceWorker && globalThis.navigator.serviceWorker.ready) {
      globalThis.navigator.serviceWorker.ready.then(function (reg) {
        if (reg && reg.active) reg.active.postMessage({ type: 'INVALIDATE_DATA_CACHE', invalidateType: type, payload: payload || null });
      }).catch(function () {});
    }
  } catch (e2) {}
}

export const CacheManager = {
  resolveMemoryTtl,
  resolveSwMaxAge,
  notifySwInvalidate
};

// 🔥 向後相容橋接：經典腳本消費端（api.js / offline.js / species.js）仍經 globalThis 讀取
try { if (typeof globalThis !== 'undefined') globalThis.CacheManager = CacheManager; } catch (e) {}