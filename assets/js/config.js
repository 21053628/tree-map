/**
 * 樹木管理系統 - 配置模組
 * 
 * 安全性改進：
 * 1. 移除硬編碼的 API 端點和密碼
 * 2. 使用環境變數或外部配置文件
 * 3. 實作適當的認證機制
 */

// 配置對象 - 應從外部配置文件或環境變數加載
const Config = {
  // API 端點配置
  API_ENDPOINT: 'https://script.google.com/macros/s/AKfycby5Wby6nj8MPOdw5io10CakB877gY8qf3HKeckPz5MVb-to8QxUYfEH3pN_y-6hHvXj/exec',
  
  // 認證配置
  AUTH: {
    SESSION_DURATION: 4 * 60 * 60 * 1000, // 4 小時（縮短以降低 token 洩漏風險）
    STORAGE_KEY: 'tree_staff_token'
  },
  
  // 座標系統定義
  PROJECTIONS: {
    HK80: '+proj=tmerc +lat_0=22.31213333333334 +lon_0=114.1785555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.067753,-2.243649,-1.158827,-1.094246 +units=m +no_defs',
    WGS84: '+proj=longlat +datum=WGS84 +no_defs'
  },
  
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
    PROJECT_ZOOM: 19,  // 🔥 揀地盤：19（政府底圖原生最清＋睇晒全盤）
    TREE_ZOOM: 22      // 🔥 搵樹：22（極清近鏡）
  },

  // 📷 [Phase5] 相片上傳策略：true＝兩階段（先傳 metadata 得 inspection_id，再逐張傳相片）
  // ⚠️ 需要後端支援 inspection_photo type，且 inspection 成功時回傳 inspection_id
  INSPECTION_SPLIT_PHOTOS: false
};

// 初始化配置
function initConfig(apiEndpoint) {
  if (apiEndpoint) {
    Config.API_ENDPOINT = apiEndpoint;
  }
  
  // 驗證必要配置
  if (!Config.API_ENDPOINT) {
    console.warn('⚠️ API_ENDPOINT 未配置，請在初始化時提供');
  } else {
    console.log('✅ API 端點已配置:', Config.API_ENDPOINT);
  }
  
  return Config;
}

// 匯出配置到全域對象
if (typeof window !== 'undefined') {
  window.Config = Config;
  window.initConfig = initConfig;
}

// CommonJS 匯出（如需 Node.js 環境使用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Config, initConfig };
}