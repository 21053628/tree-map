/**
 * DOM 快取與 UI 工具模組
 */
import { escapeHtml, debounce, throttle } from '../core/utils.js';

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

// re-export 共用工具（保持對外介面不變，供其他 module 繼續 import）
export { escapeHtml, debounce, throttle };

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
  DOM.panelContent.innerHTML = DOMPurify.sanitize(html); // [Phase7] 移除 inline onclick，改用 addEventListener
  DOM.panel.style.display = 'block';
  document.body.classList.add('panel-open');
}

// 關閉側邊面板
export function closePanel() {
  DOM.panel.style.display = 'none';
  document.body.classList.remove('panel-open');
}