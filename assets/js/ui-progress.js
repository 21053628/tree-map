/**
 * UI 進度條（零依賴，ES Module）
 * - ProgressBar.start() / stop() 以計數器管理，避免併發請求互相打斷（頂部細條）
 * - ProgressBar.showModal() / setProgress() / hideModal() 提供確定性進度面板（提交表單用）
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

/* ---------- 進度面板（確定性進度條 + 訊息） ---------- */
function ensureModal() {
  let modal = document.getElementById('progressModal');
  if (modal && document.body.contains(modal)) return modal;
  modal = document.createElement('div');
  modal.id = 'progressModal';
  modal.className = 'progress-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML =
    '<div class="progress-modal__overlay"></div>' +
    '<div class="progress-modal__panel" role="document">' +
      '<div class="progress-modal__icon">⟳</div>' +
      '<div class="progress-modal__message" id="progressMessage">處理中...</div>' +
      '<div class="progress-modal__bar-track">' +
        '<div class="progress-modal__bar-fill" id="progressFill"></div>' +
      '</div>' +
      '<div class="progress-modal__detail" id="progressDetail"></div>' +
    '</div>';
  document.body.appendChild(modal);
  return modal;
}

function showModal() {
  const modal = ensureModal();
  // 重置進度條
  const fill = document.getElementById('progressFill');
  if (fill) fill.style.width = '0%';
  const msg = document.getElementById('progressMessage');
  if (msg) msg.textContent = '處理中...';
  const detail = document.getElementById('progressDetail');
  if (detail) detail.textContent = '';
  modal.classList.add('is-active');
  modal.setAttribute('aria-hidden', 'false');
}

function hideModal() {
  const modal = document.getElementById('progressModal');
  if (modal) {
    modal.classList.remove('is-active');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function setProgress(percent, message) {
  const fill = document.getElementById('progressFill');
  if (fill) fill.style.width = Math.min(100, Math.max(0, percent)) + '%';
  if (message) setMessage(message);
}

function setMessage(text) {
  const el = document.getElementById('progressMessage');
  if (el) el.textContent = text;
}

function setDetail(text) {
  const el = document.getElementById('progressDetail');
  if (el) el.textContent = text;
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
  get activeCount() { return counter; },
  /* 確定性進度面板 */
  showModal,
  hideModal,
  setProgress,
  setMessage,
  setDetail
};
