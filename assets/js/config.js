/**
 * 樹木管理系統 - 配置模組（ES Module，零 window 橋接）
 *
 * 環境注入優先級（高 → 低）：
 * 1. ENV.API_ENDPOINT  (assets/js/env.js - ESM 注入，CI 生成)
 * 2. <meta name="api-endpoint" content="..."> (反向代理 / 模板注入)
 */

import { ENV } from './env.js';
import { PROJECTIONS } from './core/coordinates.js';

function resolveApiEndpoint_() {
  // 1) 環境注入 env.js
  if (ENV && typeof ENV.API_ENDPOINT === 'string' && ENV.API_ENDPOINT.trim()) {
    return ENV.API_ENDPOINT.trim();
  }
  // 2) <meta name="api-endpoint">
  try {
    if (typeof document !== 'undefined' && document.querySelector) {
      var m = document.querySelector('meta[name="api-endpoint"]');
      if (m && m.content && m.content.trim()) return m.content.trim();
    }
  } catch (e) { /* intentionally ignored: optional fallback failure */ }
  return '';
}

function isValidGasExecEndpointFallback_(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint.trim()) return false;
  try {
    var url = new URL(endpoint.trim());
    return url.protocol === 'https:' &&
      url.hostname === 'script.google.com' &&
      url.pathname.indexOf('/macros/s/') === 0 &&
      /\/exec$/.test(url.pathname) &&
      !url.search &&
      !url.hash &&
      url.pathname.split('/').filter(Boolean).length === 4;
  } catch (e) {
    return false;
  }
}

// 配置對象 - 應從外部配置文件或環境變數加載
const Config = {
  // API 端點配置 - 由 resolveApiEndpoint_() 環境注入解析，避免硬編碼
  API_ENDPOINT: null,

  // 認證配置
  AUTH: {
    SESSION_DURATION: 4 * 60 * 60 * 1000, // 4 小時（縮短以降低 token 洩漏風險）
    STORAGE_KEY: 'tree_staff_token'
  },

  // 座標系統定義（單一真源：core/coordinates.js）
  PROJECTIONS,
  // 🎨 樹木狀態顏色（v2.32 更新）
  TREE_STATUS_COLORS: {
    Normal: '#2E7D32',     // 翡翠綠
    Fair: '#7CB342',       // 草綠色（淺綠）
    Poor: '#FFB300',       // 琥珀黃
    'Very Poor': '#E53935', // 鮮紅色
    Dead: '#000000',       // 純黑色
    Unknown: '#757575'     // 未知（灰色）
  },

  // 地圖配置
  MAP: {
    DEFAULT_CENTER: [22.40, 114.18],
    DEFAULT_ZOOM: 11,
    MAX_ZOOM: 22,
    PROJECT_ZOOM: 19,  // 🔥 選擇地盤：19（政府底圖原生最清晰＋看盡全盤）
    TREE_ZOOM: 22,      // 🔥 找樹：22（極清近鏡）
    VIEWPORT_THRESHOLD: 2000 // 🔥 視域按需：當地盤樹數 >= 此值才啟用 bbox 增量載入
  },

  // 📷 [Phase5] 相片上傳策略：true＝兩階段（先傳 metadata 得 inspection_id，再逐張傳相片）
  // ✅ [v2.58] 後端已支援 inspection_photo type，且 inspection 成功時回傳 inspection_id，故此啟用兩階段上傳
  INSPECTION_SPLIT_PHOTOS: true, // [Phase12] 兩階段相片上傳：先文字後逐張相，弱網更穩

  // 📷 圖片上傳限制（前後端一致）
  UPLOAD: {
    ALLOWED_MIMES: ['image/jpeg', 'image/png', 'image/webp'],
    ALLOWED_EXTS: ['jpg', 'jpeg', 'png', 'webp'],
    ACCEPT: 'image/jpeg,image/png,image/webp',
    MAX_BYTES: 10 * 1024 * 1024, // 10MB 解碼後
    MAX_COUNT: 10, // 單次/單筆最多 10 張
    MAX_COUNT_TOTAL: 30 // 單次巡查建議總量（提示用）
  }
};

// 初始化配置
function initConfig(apiEndpoint) {
  if (apiEndpoint) {
    Config.API_ENDPOINT = apiEndpoint;
  } else if (!Config.API_ENDPOINT) {
    // 嘗試從環境注入解析
    var resolved = resolveApiEndpoint_();
    if (resolved) Config.API_ENDPOINT = resolved;
  }

  // 驗證必要配置
  if (!Config.API_ENDPOINT) {
    console.warn('⚠️ API_ENDPOINT 未配置：請建立 assets/js/env.js（複製 env.example.js）或在 HTML 加入 <meta name="api-endpoint">，或設定 CI Secrets GAS_API_URL');
  } else {
    // 校驗端點格式（若已載入外部校驗函數則優先使用）
    var validator = (typeof isValidGasExecEndpoint === 'function') ? isValidGasExecEndpoint : isValidGasExecEndpointFallback_;
    if (!validator(Config.API_ENDPOINT)) {
      console.warn('⚠️ API_ENDPOINT 格式不符預期（應為 https://script.google.com/macros/s/<id>/exec），當前值:', Config.API_ENDPOINT);
    } else {
      console.log('✅ API 端點已配置:', Config.API_ENDPOINT);
    }
  }

  return Config;
}

// 載入時自動嘗試解析（env.js 已在 config.js 之前載入時可直接命中）
(function autoResolve_() {
  if (Config.API_ENDPOINT) return;
  var resolved = resolveApiEndpoint_();
  if (resolved) Config.API_ENDPOINT = resolved;
})();

export { Config, initConfig };

