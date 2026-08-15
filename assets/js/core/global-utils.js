/**
 * 共用工具 [Phase0]（plain script 版，供非 module 頁面：nfc.html / t.html 使用）
 * 掛載到 window.TreeUtils，避免各頁內嵌重複邏輯
 */
(function () {
  'use strict';

  // HTML 跳脫（防 XSS）— 用字串拼接避開實體被解讀
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const A = '&';
    return String(str)
      .replace(/&/g, A + 'amp;')
      .replace(/</g, A + 'lt;')
      .replace(/>/g, A + 'gt;')
      .replace(/"/g, A + 'quot;')
      .replace(/'/g, A + '#39;');
  }

  function format1(n) { return Number(n).toFixed(1); }
  function format5(n) { return Number(n).toFixed(5); }

  window.TreeUtils = {
    escapeHtml: escapeHtml,
    format1: format1,
    format5: format5
  };
})();