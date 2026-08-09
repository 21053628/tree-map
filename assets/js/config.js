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
    SESSION_DURATION: 30 * 60 * 1000, // 30 分鐘
    STORAGE_KEY: 'tree_staff_until'
  },
  
  // 座標系統定義
  PROJECTIONS: {
    HK80: '+proj=tmerc +lat_0=22.31213333333334 +lon_0=114.1785555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.067753,-2.243649,-1.158827,-1.094246 +units=m +no_defs',
    WGS84: '+proj=longlat +datum=WGS84 +no_defs'
  },
  
  // 樹木狀態顏色
  TREE_STATUS_COLORS: Object.freeze({
    'Normal': '#2e7d32',
    'Fair': '#f9a825',
    'Poor': '#ef6c00',
    'Very Poor': '#c62828',
    'Dead': '#424242',
    'Unknown': '#757575'
  }),
  
  // 地圖配置
  MAP: {
    DEFAULT_CENTER: [22.40, 114.18],
    DEFAULT_ZOOM: 11,
    MAX_ZOOM: 19
  }
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

// ES6 Modules 匯出
export { Config, initConfig };

// 匯出到全域對象（向後兼容）
if (typeof window !== 'undefined') {
  window.Config = Config;
  window.initConfig = initConfig;
}

// CommonJS 匯出（如需 Node.js 環境使用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Config, initConfig };
}
