/**
 * DOM 快取與 UI 工具模組
 */
import { escapeHtml, debounce, throttle, sanitizeHtml } from '../core/utils.js';

export const DOM = {
  statusEl: null,
  projSel: null,
  addProjectBtn: null,
  addTreeBtn: null,
  siteInfoBtn: null,
  panel: null,
  panelContent: null,
  searchResults: null,
  treeSearch: null
};

export const $ = (s) => document.querySelector(s);

// re-export 共用工具（保持對外介面不變，供其他 module 繼續 import）
export { escapeHtml, debounce, throttle };

// 狀態列更新
export function updateStatus(message) {
  if (!DOM.statusEl) {
    console.log('[Status]', message);
    return;
  }

  const text = String(message);
  const statusEl = DOM.statusEl;
  statusEl.textContent = text;
  statusEl.classList.remove(
    'success',
    'processing',
    'warning',
    'offline',
    'error'
  );

  if (text.indexOf('✅') !== -1 || text.indexOf('成功') !== -1 || text.indexOf('已更新') !== -1) {
    statusEl.classList.add('success');
  } else if (
    text.indexOf('❌') !== -1 ||
    text.indexOf('失敗') !== -1 ||
    text.indexOf('錯誤') !== -1
  ) {
    statusEl.classList.add('error');
  } else if (
    text.indexOf('📴') !== -1 ||
    text.indexOf('離線') !== -1 ||
    text.indexOf('未能連線') !== -1
  ) {
    statusEl.classList.add('offline');
  } else if (text.indexOf('⚠️') !== -1 || text.indexOf('警告') !== -1) {
    statusEl.classList.add('warning');
  } else if (
    text.indexOf('🗺️') !== -1 ||
    text.indexOf('載入') !== -1 ||
    text.indexOf('定位中') !== -1 ||
    text.indexOf('📡') !== -1
  ) {
    statusEl.classList.add('processing');
  }

  statusEl.classList.add('status-visible');
  clearTimeout(statusEl._hideTimer);
  statusEl._hideTimer = setTimeout(() => {
    statusEl.classList.remove('status-visible');
  }, 3000);
}

// 顯示側邊面板
export function showPanel(html, opts) {
  opts = opts || {};
  // [Phase13] 載入中可以顯示 skeleton
  if (opts.loading) {
    DOM.panelContent.innerHTML =
      '<div class="panel-loading" aria-hidden="true">' +
        '<div class="skeleton skeleton-title"></div>' +
        '<div class="skeleton skeleton-input"></div>' +
        '<div class="skeleton skeleton-input"></div>' +
        '<div class="skeleton skeleton-input"></div>' +
        '<div class="skeleton skeleton-button"></div>' +
      '</div>';
  } else {
    DOM.panelContent.innerHTML = sanitizeHtml(html); // [Phase7] 移除 inline onclick，改用 addEventListener
  }
  DOM.panel.classList.add('is-visible'); DOM.panel.classList.remove('is-hidden');
  document.body.classList.add('panel-open');
}

// 關閉側邊面板
export function closePanel() {
  DOM.panel.classList.remove('is-visible'); DOM.panel.classList.add('is-hidden');
  document.body.classList.remove('panel-open');
}

// =========================================================
// [Phase13] Toast 通知系統（取代 alert()，統一 UI 提示）
// =========================================================
let _toastContainer = null;

function ensureToastContainer_() {
  if (_toastContainer && document.body.contains(_toastContainer)) return _toastContainer;
  let el = document.querySelector('.toast-container');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast-container';
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  _toastContainer = el;
  return el;
}

/**
 * 顯示 Toast 通知
 * @param {string} message 訊息內容
 * @param {string} type    'success' | 'error' | 'warning' | 'info'（預設 'info'）
 * @param {number} duration 顯示毫秒（預設 3000；error 3500）
 */
export function showToast(message, type, duration) {
  const t = type || 'info';
  const text = String(message == null ? '' : message);
  if (!text) return;

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: '💬' };
  const container = ensureToastContainer_();

  const toast = document.createElement('div');
  toast.className = 'toast toast-' + t;
  toast.innerHTML =
    '<span class="toast-icon">' + (icons[t] || icons.info) + '</span>' +
    '<span class="toast-msg"></span>';
  toast.querySelector('.toast-msg').textContent = text;
  container.appendChild(toast);

  const dur = (typeof duration === 'number' && duration > 0) ? duration : (t === 'error' ? 3500 : 3000);

  // 自動消失（先加 is-leaving 淡出動畫，再移除）
  const _remove = () => {
    if (!toast.isConnected) return;
    toast.classList.add('is-leaving');
    setTimeout(() => { if (toast.isConnected) toast.remove(); }, 320);
  };
  const _timer = setTimeout(_remove, dur);

  // 點擊 toast 即時關閉
  toast.addEventListener('click', () => { clearTimeout(_timer); _remove(); });
  return toast;
}

// =========================================================
// [Phase13] 表單欄位驗證錯誤（紅框 + shake + inline 錯誤訊息）
// =========================================================
/**
 * 標記表單欄位錯誤
 * @param {HTMLElement|string} el 欄位元素或 CSS selector
 * @param {string} message 錯誤訊息（留空只加紅框不移除）
 * @returns {boolean} false（方便直接 return）
 */
export function formFieldError(el, message) {
  const field = typeof el === 'string' ? document.querySelector(el) : el;
  if (!field) return false;

  field.classList.add('field-error');
  field.setAttribute('aria-invalid', 'true');

  // 移除舊錯誤訊息（同欄位）
  const oldMsg = field.parentNode ? field.parentNode.querySelector('.form-error-msg') : null;
  if (oldMsg) oldMsg.remove();
  if (field.id) field.removeAttribute('aria-describedby');

  if (message) {
    const msg = document.createElement('span');
    msg.className = 'form-error-msg';
    msg.textContent = message;
    if (field.id) {
      const msgId = field.id + '-error';
      msg.id = msgId;
      field.setAttribute('aria-describedby', msgId);
      msg.setAttribute('role', 'alert');
    }
    if (field.parentNode) {
      field.parentNode.appendChild(msg);
    }
  }
  return false;
}

/**
 * 清除欄位錯誤狀態（focus 或 input 時自動呼叫）
 */
export function clearFieldError(el) {
  const field = typeof el === 'string' ? document.querySelector(el) : el;
  if (!field) return;
  field.classList.remove('field-error');
  field.removeAttribute('aria-invalid');
  if (field.id) field.removeAttribute('aria-describedby');
  const oldMsg = field.parentNode ? field.parentNode.querySelector('.form-error-msg') : null;
  if (oldMsg) oldMsg.remove();
}

/**
 * 將「欄位被標記錯誤 + input/focus 自動清除」掛到 panel 內所有輸入框
 */
export function enableAutoClearFieldErrors() {
  if (!DOM.panel) return;
  DOM.panel.addEventListener('input', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('field-error')) {
      clearFieldError(e.target);
    }
  }, true);
  DOM.panel.addEventListener('focus', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('field-error')) {
      clearFieldError(e.target);
    }
  }, true);
}