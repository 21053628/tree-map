/**
 * 環境注入 - Runtime 配置（零 window 橋接）
 * 部署時由 CI / 手動生成（取代已移除的 api-config.js）
 * 產生方式（CI）： echo "globalThis.ENV={API_ENDPOINT:'https://script.google.com/macros/s/<ID>/exec'}" > assets/js/env.js
 * 本文件已被 .gitignore 忽略，請複製 env.example.js 為 env.js 並填入實際值
 * ESM 兼容：同時提供 ESM 導出（當以 type=\"module\" 載入時）
 */
(function (g) {
  'use strict';
  var ENV = { API_ENDPOINT: 'https://script.google.com/macros/s/AKfycbxlwiMM1CW7tV4ljwU0GDJoM4CfDjqc7iS-yp65TzOX4DVsj4FD1BgVVlAhu2jegvn3/exec' };
  // 暴露至 globalThis（零 window 橋接）
  try { if (g) g.ENV = g.ENV || ENV; if (g && g.ENV && !g.ENV.API_ENDPOINT) g.ENV.API_ENDPOINT = ENV.API_ENDPOINT; } catch (e) {}
  // 嘗試 ESM 導出（若環境支持，忽略錯誤）
  try { if (typeof module !== 'undefined' && module.exports) module.exports = { ENV: (g && g.ENV) || ENV }; } catch (e2) {}
})(typeof globalThis !== 'undefined' ? globalThis : this);
// ESM 導出（供 type=\"module\" 引入時使用；plain script 載入時此行會被忽略為註釋外的容錯）
// export const ENV = (typeof globalThis !== 'undefined' && globalThis.ENV) ? globalThis.ENV : { API_ENDPOINT: '' };
