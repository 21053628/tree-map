/**
 * UI 頂部進度條（零依賴，plain script）
 * - window.ProgressBar.start() / stop() 以計數器管理，避免併發請求互相打斷
 * - 無請求時自動淡出
 */
(function (g) {
  'use strict';
  var el = null;
  var counter = 0;
  var hideTimer = null;

  function ensureEl() {
    if (el && document.body.contains(el)) return el;
    el = document.getElementById('progressBar');
    if (!el) {
      el = document.createElement('div');
      el.id = 'progressBar';
      el.className = 'progress-bar';
      el.setAttribute('role', 'progressbar');
      el.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
  }

  function show() {
    var bar = ensureEl();
    bar.classList.add('is-active');
    bar.setAttribute('aria-hidden', 'false');
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function hide() {
    var bar = ensureEl();
    bar.classList.remove('is-active');
    bar.setAttribute('aria-hidden', 'true');
  }

  var ProgressBar = {
    start: function () {
      counter++;
      show();
    },
    stop: function () {
      if (counter > 0) counter--;
      if (counter > 0) return;
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(hide, 250); // 延遲淡出，避免快速連續請求閃爍
    },
    reset: function () { counter = 0; hide(); },
    get activeCount() { return counter; }
  };

  g.ProgressBar = ProgressBar;
})(typeof globalThis !== 'undefined' ? globalThis : this);