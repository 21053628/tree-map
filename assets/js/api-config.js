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
  // Google Apps Script 執行端點
  ENDPOINT: 'https://script.google.com/macros/s/AKfycbzNvSomlr1LmAvfA3rByDii9TISFs-HooX2iD5yJkK3QWI59sGhKYpqQyan2HRwgPwC/exec'
};

// 自動初始化 Config（如果已加載）
if (typeof Config !== 'undefined' && Config.API_ENDPOINT === null) {
  Config.API_ENDPOINT = API_CONFIG.ENDPOINT;
}
