/**
 * API 端點配置文件（範例）— 已棄用
 *
 * 推薦改用環境注入：複製 assets/js/env.example.js 為 env.js
 *   cp assets/js/env.example.js assets/js/env.js
 * 此文件僅為舊本地開發兼容保留。
 *
 * @deprecated 請遷移至 env.js (ENV.API_ENDPOINT via globalThis.ENV)
 *
 * 使用方法（舊）：
 * 1. 複製此文件：cp api-config.example.js api-config.js
 * 2. 編輯 api-config.js，填入實際的 Google Apps Script URL
 */

const API_CONFIG = {
  // Google Apps Script 執行端點（佔位符，真實值由 env.js 注入）
  ENDPOINT: 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE'
};

// 自動初始化 Config（僅當環境注入未提供時；佔位符不覆蓋）
if (typeof Config !== 'undefined' && (Config.API_ENDPOINT === null || Config.API_ENDPOINT === '')) {
  var _hasEnv = false;
  try {
    var _envRef2 = (typeof globalThis !== 'undefined' && globalThis.ENV) ? globalThis.ENV : null;
    _hasEnv = !!(_envRef2 && _envRef2.API_ENDPOINT && String(_envRef2.API_ENDPOINT).trim());
  } catch (e) {}
  if (!_hasEnv && API_CONFIG.ENDPOINT.indexOf('YOUR_') === -1) {
    Config.API_ENDPOINT = API_CONFIG.ENDPOINT;
  }
}
