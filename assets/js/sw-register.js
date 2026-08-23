/**
 * Service Worker 註冊（外部化，避免 CSP script-src 'self' 擋掉內嵌 script）
 * v3.0.0：updateViaCache none + SKIP_WAITING 交由前端決定 + 更新提示
 */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;

  function showUpdateToast(reg) {
    // 若頁面已有 pwaToast（offline.js），複用；否則簡易提示
    var msg = '有新版本可用，點擊重新載入';
    if (typeof pwaToast === 'function') {
      pwaToast(msg, 8000);
      // 點擊 toast 即更新
      var el = document.getElementById('pwaToast');
      if (el) el.onclick = function () { if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }); };
    } else if (confirm(msg + '？')) {
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
      // 已有 waiting 的 SW：提示更新
      if (reg.waiting) showUpdateToast(reg);
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast(reg);
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
})();
