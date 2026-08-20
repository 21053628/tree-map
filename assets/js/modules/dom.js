/**
 * DOM 快取與 UI 工具模組
 */
import { escapeHtml, debounce, throttle } from '../core/utils.js';

export const DOM = {
  statusEl: null,
  projSel: null,
  addProjectBtn: null,
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