/**
 * 共用工具模組 [Phase0]（零業務依賴，可獨立測試）
 * ES Module 版，與 core/global-utils.js 互為對應；兩處需同步維護
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

// ID 白名單驗證（防 NFC／URL 注入）：只容許字母（含中文）、數字、點、底線、連字號
// 拒絕空白與所有 HTML/JS 特殊字元，並限制長度，回傳空字串代表不合法
export function sanitizeId(value) {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  if (!s) return '';
  if (s.length > 64) return '';
  const ok = /^[\p{L}\p{N}._-]+$/u.test(s);
  return ok ? s : '';
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

// 樹木健康狀態合法值（供 forms.js / t.js 共用）
export const VALID_HEALTH = ['Normal', 'Fair', 'Poor', 'Very Poor', 'Dead'];

// HK80 座標有效性驗證（N/E 必須喺香港合理範圍）
export function isValidHK80(N, E) {
  if (N === '' || N === null || N === undefined) return false;
  if (E === '' || E === null || E === undefined) return false;
  const n = Number(N), e = Number(E);
  if (!isFinite(n) || !isFinite(e)) return false;
  return n >= 800000 && n <= 850000 && e >= 800000 && e <= 870000;
}
