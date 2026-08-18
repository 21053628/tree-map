/**
 * Service Worker 註冊（外部化，避免 CSP script-src 'self' 擋掉內嵌 script）
 * 供 index.html / t.html 共用
 */
(function () {
  'use strict';
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.warn('Service Worker 註冊失敗:', err);
      });
    });
  }
})();