/**
 * API 端點配置文件（範例）
 * 
 * ⚠️ 此為範例文件，請複製為 api-config.js 並填入實際值
 * 
 * 使用方法：
 * 1. 複製此文件：cp api-config.example.js api-config.js
 * 2. 編輯 api-config.js，填入實際的 Google Apps Script URL
 * 3. 確保 api-config.js 未被提交到版本控制系統
 */

const API_CONFIG = {
  // Google Apps Script 執行端點
  ENDPOINT: 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE'
};

// 自動初始化 Config（如果已加載）
if (typeof Config !== 'undefined' && Config.API_ENDPOINT === null) {
  Config.API_ENDPOINT = API_CONFIG.ENDPOINT;
}
