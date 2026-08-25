/**
 * 環境注入 - Runtime 配置（ES Module）
 * 部署時由 CI / 手動生成（取代已移除的 api-config.js）
 * 產生方式（CI）：
 *   echo "export const ENV={API_ENDPOINT:'https://script.google.com/macros/s/<ID>/exec'}" > assets/js/env.js
 * 本文件已被 .gitignore 忽略，請複製 env.example.js 為 env.js 並填入實際值
 */
export const ENV = {
  API_ENDPOINT: 'https://script.google.com/macros/s/AKfycbxlwiMM1CW7tV4ljwU0GDJoM4CfDjqc7iS-yp65TzOX4DVsj4FD1BgVVlAhu2jegvn3/exec'
};

if (typeof globalThis !== 'undefined' && !globalThis.ENV) {
  try { globalThis.ENV = ENV; } catch (e) {}
}