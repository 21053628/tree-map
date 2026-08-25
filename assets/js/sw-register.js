/**
 * Service Worker 註冊（外部化，避免 CSP script-src 'self' 擋掉內嵌 script）
 * v1.0.0-beta：統一版本號（正式發佈前整合）
 * 歷史：v3.0.0 - updateViaCache none + SKIP_WAITING 交由前端決定 + 更新提示
 *       v3.0.1 - [修復] 自動更新：檢測到新版本 → 自動清空快取（SW CacheStorage + localStorage tree_cache_*）→ SKIP_WAITING → 自動 reload
 *               （舊版「點擊重新載入」因 CSS .offline-toast{pointer-events:none} 令 toast 無法點擊而失效，改為全自動免點擊）
 */
import { pwaToast } from '../../offline.js';

if ('serviceWorker' in navigator) {

  var _autoUpdating = false;

  // 清除 offline.js 儲存在 localStorage 的離線快取（tree_cache_*）
  function clearLocalStorageCache() {
    try {
      var toRemove = [];
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && k.indexOf('tree_cache_') === 0) toRemove.push(k);
      }
      toRemove.forEach(function (k) { window.localStorage.removeItem(k); });
    } catch (e) { /* 忽略 */ }
  }

  // 🔥 [v3.0.1] 自動更新：清空 SW 快取 → 啟動新 SW → controllerchange 自動 reload
  function autoUpdate(reg) {
    if (_autoUpdating || !reg.waiting) return;
    _autoUpdating = true;

    if (typeof pwaToast === 'function') {
      pwaToast('🔄 新版本已就緒，正在清除快取並重新載入…', 6000);
    }
    clearLocalStorageCache();

    if (typeof MessageChannel !== 'undefined') {
      var channel = new MessageChannel();
      var done = false;
      var skipWaitingOnce = function () {
        if (done) return;
        done = true;
        try { if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
      };
      channel.port1.onmessage = function (e) {
        if (e.data && e.data.ok) skipWaitingOnce();
      };
      try {
        reg.waiting.postMessage({ type: 'CLEAR_CACHE' }, [channel.port2]);
      } catch (e) {
        skipWaitingOnce();
      }
      // 安全網：5 秒內未收到 CLEAR_CACHE 完成回覆，仍強制更新避免卡死
      setTimeout(skipWaitingOnce, 5000);
    } else {
      // 不支援 MessageChannel 時直接啟動新 SW
      try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
    }
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js', { type: 'module', updateViaCache: 'none' }).then(function (reg) {
      // 已有 waiting 的 SW：自動更新
      if (reg.waiting) autoUpdate(reg);
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            autoUpdate(reg);
          }
        });
      });
    }).catch(function (err) {
      console.warn('Service Worker 註冊失敗:', err);
    });

    var refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}