/**
 * API 端點配置文件
 * 
 * ⚠️ 安全性警告：
 * 1. 此文件不應提交到版本控制系統
 * 2. 在生產環境中，應使用環境變數或後端代理
 * 3. 建議將此文件添加到 .gitignore
 * 
 * 使用方法：
 * - 複製 api-config.example.js 為 api-config.js
 * - 填入實際的 API 端點
 */

const API_CONFIG = {
  // Google Apps Script 正式執行端點；請勿填入 /dev 測試網址
  ENDPOINT: 'https://script.google.com/macros/s/AKfycbzNvSomlr1LmAvfA3rByDii9TISFs-HooX2iD5yJkK3QWI59sGhKYpqQyan2HRwgPwC/exec'
};

function isValidGasExecEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint.trim()) return false;

  try {
    const url = new URL(endpoint.trim());
    return url.protocol === 'https:' &&
      url.hostname === 'script.google.com' &&
      url.pathname.indexOf('/macros/s/') === 0 &&
      /\/exec$/.test(url.pathname) &&
      !url.search &&
      !url.hash &&
      url.pathname.split('/').filter(Boolean).length === 4;
  } catch (error) {
    return false;
  }
}

// 自動初始化 Config（如果已加載）
if (typeof Config !== 'undefined' && Config.API_ENDPOINT === null) {
  if (isValidGasExecEndpoint(API_CONFIG.ENDPOINT)) {
    Config.API_ENDPOINT = API_CONFIG.ENDPOINT.trim();
  } else {
    console.error('❌ API_ENDPOINT 設定無效：必須是 HTTPS 的 Google Apps Script /macros/s/<deployment-id>/exec 正式網址，不能使用 /dev。');
  }
}
