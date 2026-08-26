/**
 * 環境注入範例 - 請複製為 env.js 並填入實際值
 * 此文件可提交，env.js 已被 .gitignore 忽略
 *
 * 產生方式（CI）：
 *   echo "export const ENV={API_ENDPOINT:'${GAS_API_URL}'}" > assets/js/env.js
 *
 * 本地開發：
 *   cp assets/js/env.example.js assets/js/env.js
 *   然後編輯 env.js 填入你的 GAS /exec URL
 */
export const ENV = {
  API_ENDPOINT: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec'
};

