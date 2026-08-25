import { isValidHK80 as _isValidHK80, format1 as _format1, format5 as _format5 } from './coordinates.js';
/**
 * 共用工具模組 [Phase0]（零業務依賴，可獨立測試）
 * ES Module 版（統一真源）；core/global-utils.js 歷史兼容橋已於 2026-08-25 移除
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

// 數字格式化（轉發至統一座標工具，保持 API 相容）
export function format1(n){ try{ return _format1(n); }catch(e){ return Number(n).toFixed(1); } }
export function format5(n){ try{ return _format5(n); }catch(e){ return Number(n).toFixed(5); } }

// 樹木健康狀態合法值（供 forms.js / t.js 共用）
export const VALID_HEALTH = ['Normal', 'Fair', 'Poor', 'Very Poor', 'Dead'];

// HK80 座標有效性驗證（委派至統一座標工具，單一真源）+ 本地回退
export function isValidHK80(N, E){
  try{ return _isValidHK80(N, E); }catch(e){
    if (N === '' || N === null || N === undefined) return false;
    if (E === '' || E === null || E === undefined) return false;
    const n = Number(N), en = Number(E);
    if (!Number.isFinite(n) || !Number.isFinite(en)) return false;
    return n >= 800000 && n <= 850000 && en >= 800000 && en <= 870000;
  }
}

/**
 * 驗證 NFC back URL 是否安全（防開放重定向 / XSS）
 * 只允許同源且路徑白名單的相對或絕對 URL
 * @param {string} value - 待驗證的 URL 字串
 * @param {string} [baseHref] - 用於解析相對路徑的基準（預設為 location.href / location.origin）
 * @returns {string|null} 安全時回傳規範化後的絕對 URL，否則回傳 null
 */
export function isSafeBackUrl(value, baseHref) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  // 攔截危險協議
  if (/^(javascript|data|vbscript|file|blob):/i.test(s)) return null;
  // 攔截協議相對 URL //evil.com
  if (s.startsWith('//')) return null;
  // 攔截反斜線開頭 \\evil
  if (s.startsWith('\\\\')) return null;
  // 攔截空白後的繞過 " javascript:..."
  // 已 trim，無需額外

  let base = baseHref;
  if (!base) {
    try {
      if (typeof location !== 'undefined' && location.href) base = location.href;
      else if (typeof location !== 'undefined' && location.origin) base = location.origin;
      else base = 'http://localhost/';
    } catch (e) {
      base = 'http://localhost/';
    }
  }

  let origin;
  try {
    origin = (typeof location !== 'undefined' && location.origin) ? location.origin : new URL(base).origin;
  } catch (e) {
    origin = null;
  }

  try {
    const u = new URL(s, base);
    // 必須同源
    if (origin && u.origin !== origin) return null;
    // 若 base 無 origin（如 localhost 兜底），仍需檢查 u 協議為 http/https
    if (!/^https?:$/.test(u.protocol)) return null;

    // 路徑白名單：支援部署於子目錄，故用 endsWith 判斷
    const path = u.pathname;
    const allowedSuffixes = ['/t.html', '/index.html', '/nfc.html', '/'];
    // 根路徑 "/" 視為允許（通常對應 index.html）
    const isAllowed = allowedSuffixes.some(function(suffix) {
      if (suffix === '/') return path === '/' || path.endsWith('/index.html');
      return path === suffix || path.endsWith(suffix);
    });
    // 額外允許純 "/" 結尾的子目錄索引（如 /tree-map/）
    const isDirectoryIndex = path.endsWith('/') && path !== '/';
    if (!isAllowed && !isDirectoryIndex) return null;

    return u.href;
  } catch (e) {
    return null;
  }
}
