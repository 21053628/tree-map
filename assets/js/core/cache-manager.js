/**
 * 統一快取管理器 - 收斂 responseCache / localStorage / SW 失效入口（ES Module）
 * 依賴：cache-policy.js 的 ESM export
 */
import { CachePolicy } from './cache-policy.js';

function resolveMemoryTtl(action) {
  try { return CachePolicy.getMemoryTtl(action); } catch (e) { /* intentionally ignored: optional fallback failure */ }
  return 60 * 1000;
}

function resolveSwMaxAge(action) {
  try { return CachePolicy.getSwMaxAge(action); } catch (e) { /* intentionally ignored: optional fallback failure */ }
  return 3600000;
}

// 通知 SW 清指定 DATA_CACHE 條目（與 sw.js:INVALIDATE_DATA_CACHE 對應）
function notifySwInvalidate(type, payload) {
  try {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
    const msg = { type: 'INVALIDATE_DATA_CACHE', invalidateType: type, payload: payload || null };
    navigator.serviceWorker.controller.postMessage(msg);
  } catch (e) { /* intentionally ignored: optional fallback failure */ }
  // 回退：若無 controller，嘗試經 ready 再發（短延時）
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(function (reg) {
        if (reg && reg.active) reg.active.postMessage({ type: 'INVALIDATE_DATA_CACHE', invalidateType: type, payload: payload || null });
      }).catch(function () { /* intentionally ignored: optional fallback failure */ });
    }
  } catch (e2) { /* intentionally ignored: optional fallback failure */ }
}

export const CacheManager = {
  resolveMemoryTtl,
  resolveSwMaxAge,
  notifySwInvalidate
};

