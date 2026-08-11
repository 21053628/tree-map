/**
 * DOM 快取與 UI 工具模組
 */

export const DOM = {
  statusEl: null,
  projSel: null,
  addTreeBtn: null,
  panel: null,
  panelContent: null,
  searchResults: null,
  treeSearch: null
};

export const $ = (s) => document.querySelector(s);

// 🔥 HTML 跳脫（防 XSS）
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 防抖
export function debounce(fn, delay) {
  let timer = null;
  return function () {
    const context = this, args = arguments;
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(context, args), delay);
  };
}

// 節流
export function throttle(fn, limit) {
  let lastTime = 0;
  return function () {
    const now = Date.now();
    if (now - lastTime >= limit) {
      lastTime = now;
      fn.apply(this, arguments);
    }
  };
}

// 狀態列更新
export function updateStatus(message) {
  if (!DOM.statusEl) {
    console.log('[Status]', message);
    return;
  }
  DOM.statusEl.textContent = message;
  DOM.statusEl.classList.remove('success', 'error');
  if (message.indexOf('✅') !== -1 || message.indexOf('成功') !== -1) {
    DOM.statusEl.classList.add('success');
  } else if (message.indexOf('❌') !== -1 || message.indexOf('失敗') !== -1 || message.indexOf('錯誤') !== -1) {
    DOM.statusEl.classList.add('error');
  }
  clearTimeout(DOM.statusEl._hideTimer);
  DOM.statusEl._hideTimer = setTimeout(() => {
    DOM.statusEl.classList.remove('success', 'error');
  }, 5000);
}

// 顯示側邊面板
export function showPanel(html) {
  DOM.panelContent.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ['onclick'] });
  DOM.panel.style.display = 'block';
  document.body.classList.add('panel-open');
}

// 關閉側邊面板
export function closePanel() {
  DOM.panel.style.display = 'none';
  document.body.classList.remove('panel-open');
}