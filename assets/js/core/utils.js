/**
 * 共用工具模組 [Phase0]（零業務依賴，可獨立測試）
 * 統一 escapeHtml / debounce / throttle / format 等重複到各檔案的功能
 */

// HTML 跳脫（防 XSS）
// 注意：用字串拼接方式寫出 & 等實體，避免工具寫入時被解讀
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  const A = '&';
  return String(str)
    .replace(/&/g, A + 'amp;')
    .replace(/</g, A + 'lt;')
    .replace(/>/g, A + 'gt;')
    .replace(/"/g, A + 'quot;')
    .replace(/'/g, A + '#39;');
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

// 數字格式化
export function format1(n) { return Number(n).toFixed(1); }
export function format5(n) { return Number(n).toFixed(5); }