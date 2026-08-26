/**
 * UI 進度條（零依賴，ES Module）
 * - ProgressBar.start() / stop() 以計數器管理，避免併發請求互相打斷（頂部細條）
 * - ProgressBar.showModal() / setProgress() / hideModal() 提供確定性進度面板（提交表單用）
 * - 進度面板同時提供視覺百分比與 aria 狀態，方便使用者掌握上傳進度
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
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML =
    '<div class="progress-modal__overlay" aria-hidden="true"></div>' +
    '<div class="progress-modal__panel" role="document" aria-labelledby="progressMessage">' +
      '<div class="progress-modal__topline">' +
        '<div class="progress-modal__icon" aria-hidden="true">↑</div>' +
        '<div class="progress-modal__eyebrow">正在處理</div>' +
      '</div>' +
      '<div class="progress-modal__heading">' +
        '<div class="progress-modal__message" id="progressMessage">處理中...</div>' +
        '<div class="progress-modal__percent" id="progressPercent" aria-hidden="true">0%</div>' +
      '</div>' +
      '<div class="progress-modal__bar-track" id="progressTrack" role="progressbar" aria-label="處理進度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-valuetext="0%">' +
        '<div class="progress-modal__bar-fill" id="progressFill"></div>' +
      '</div>' +
      '<div class="progress-modal__meta">' +
        '<div class="progress-modal__detail" id="progressDetail"></div>' +
        '<div class="progress-modal__hint">請保持頁面開啟</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  return modal;
}

function showModal() {
  const modal = ensureModal();
  const fill = modal.querySelector('#progressFill');
  if (fill) fill.style.width = '0%';
  const track = modal.querySelector('#progressTrack');
  if (track) {
    track.setAttribute('aria-valuenow', '0');
    track.setAttribute('aria-valuetext', '0%');
  }
  const percent = modal.querySelector('#progressPercent');
  if (percent) percent.textContent = '0%';
  const msg = modal.querySelector('#progressMessage');
  if (msg) msg.textContent = '處理中...';
  const detail = modal.querySelector('#progressDetail');
  if (detail) detail.textContent = '';
  modal.classList.add('is-active');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('progress-is-open');
}

function hideModal() {
  const modal = document.getElementById('progressModal');
  if (modal) {
    modal.classList.remove('is-active');
    modal.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('progress-is-open');
}

function setProgress(percent, message) {
  const modal = ensureModal();
  const numericPercent = Number.isFinite(Number(percent)) ? Number(percent) : 0;
  const value = Math.min(100, Math.max(0, numericPercent));
  const roundedValue = Math.round(value);
  const fill = modal.querySelector('#progressFill');
  if (fill) fill.style.width = value + '%';
  const percentEl = modal.querySelector('#progressPercent');
  if (percentEl) percentEl.textContent = roundedValue + '%';
  const track = modal.querySelector('#progressTrack');
  if (track) {
    track.setAttribute('aria-valuenow', String(roundedValue));
    track.setAttribute('aria-valuetext', roundedValue + '%');
  }
  if (message) setMessage(message);
}

function setMessage(text) {
  const modal = ensureModal();
  const message = modal.querySelector('#progressMessage');
  if (message) message.textContent = text;
}

function setDetail(text) {
  const modal = ensureModal();
  const detail = modal.querySelector('#progressDetail');
  if (detail) detail.textContent = text;
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
