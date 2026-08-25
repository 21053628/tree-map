/**
 * UI 頂部進度條（零依賴，ES Module）
 * - ProgressBar.start() / stop() 以計數器管理，避免併發請求互相打斷
 * - 無請求時自動淡出
 */
let el = null;
let counter = 0;
let hideTimer = null;

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
  const bar = ensureEl();
  bar.classList.add('is-active');
  bar.setAttribute('aria-hidden', 'false');
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
}

function hide() {
  const bar = ensureEl();
  bar.classList.remove('is-active');
  bar.setAttribute('aria-hidden', 'true');
}

export const ProgressBar = {
  start() {
    counter++;
    show();
  },
  stop() {
    if (counter > 0) counter--;
    if (counter > 0) return;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 250); // 延遲淡出，避免快速連續請求閃爍
  },
  reset() { counter = 0; hide(); },
  get activeCount() { return counter; }
};
