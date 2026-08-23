/**
 * 樹木管理系統 - 配置模組（ESM，零 window 橋接）
 *
 * 環境注入優先級（高 → 低）：
 * 1. ENV.API_ENDPOINT  (assets/js/env.js - ESM 注入，CI 生成)
 * 2. <meta name="api-endpoint" content="..."> (反向代理 / 模板注入)
 * 3. API_CONFIG.ENDPOINT (assets/js/api-config.js - 已棄用，僅本地兼容)
 */

function resolveApiEndpoint_() {
  // 1) 環境注入 env.js（零 window，透過 globalThis.ENV）
  try {
    var _g = typeof globalThis !== 'undefined' ? globalThis : null;
    if (_g && _g.ENV && typeof _g.ENV.API_ENDPOINT === 'string' && _g.ENV.API_ENDPOINT.trim()) {
      return _g.ENV.API_ENDPOINT.trim();
    }
  } catch (e) {}
  // 2) <meta name="api-endpoint">
  try {
    if (typeof document !== 'undefined' && document.querySelector) {
      var m = document.querySelector('meta[name="api-endpoint"]');
      if (m && m.content && m.content.trim()) return m.content.trim();
    }
  } catch (e) {}
  // 3) 舊 api-config.js 兼容（若為佔位符 YOUR_ 則忽略）
  try {
    var _g2 = typeof globalThis !== 'undefined' ? globalThis : null;
    if (_g2 && _g2.API_CONFIG && typeof _g2.API_CONFIG.ENDPOINT === 'string' && _g2.API_CONFIG.ENDPOINT.trim() && _g2.API_CONFIG.ENDPOINT.indexOf('YOUR_') === -1) {
      return _g2.API_CONFIG.ENDPOINT.trim();
    }
  } catch (e) {}
  try {
    if (typeof API_CONFIG !== 'undefined' && API_CONFIG && typeof API_CONFIG.ENDPOINT === 'string' && API_CONFIG.ENDPOINT.trim() && API_CONFIG.ENDPOINT.indexOf('YOUR_') === -1) {
      return API_CONFIG.ENDPOINT.trim();
    }
  } catch (e) {}
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
  
  // 座標系統定義（單一真源：assets/js/core/coordinates.js → Config.PROJECTIONS 唯讀映射；此處保留硬編碼作為未載入統一模組時的 fallback）
  PROJECTIONS: (function(){
    try{
      var g=typeof globalThis!=='undefined'?globalThis:null;
      if(g&&g.CoordUtils&&g.CoordUtils.PROJECTIONS) return g.CoordUtils.PROJECTIONS;
    }catch(e){}
    return {
      HK80: '+proj=tmerc +lat_0=22.31213333333334 +lon_0=114.1785555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.067753,-2.243649,-1.158827,-1.094246 +units=m +no_defs',
      WGS84: '+proj=longlat +datum=WGS84 +no_defs'
    };
  })(),
  
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
    ALLOWED_MIMES: ['image/jpeg','image/png','image/webp'],
    ALLOWED_EXTS: ['jpg','jpeg','png','webp'],
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
    // 若已載入校驗函數（api-config.js），則校驗格式
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

// 匯出至全域（零 window 橋接，透過 globalThis）
try {
  var _gCfg = typeof globalThis !== 'undefined' ? globalThis : null;
  if (_gCfg) { _gCfg.Config = Config; _gCfg.initConfig = initConfig; }
} catch (e) {}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Config, initConfig };
}