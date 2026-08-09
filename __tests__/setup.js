/**
 * Jest 測試設置文件
 * 用於配置全局 mock 和測試環境
 */

// Mock Config 對象 (用於測試環境)
global.Config = {
  API_ENDPOINT: 'https://script.google.com/macros/s/test-endpoint/exec',
  AUTH: {
    SESSION_DURATION: 30 * 60 * 1000,
    STORAGE_KEY: 'tree_staff_until'
  },
  PROJECTIONS: {
    HK80: '+proj=tmerc +lat_0=22.31213333333334 +lon_0=114.1785555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.067753,-2.243649,-1.158827,-1.094246 +units=m +no_defs',
    WGS84: '+proj=longlat +datum=WGS84 +no_defs'
  },
  TREE_STATUS_COLORS: {
    'Normal': '#2e7d32',
    'Fair': '#f9a825',
    'Poor': '#ef6c00',
    'Very Poor': '#c62828',
    'Dead': '#424242',
    'Unknown': '#757575'
  },
  MAP: {
    DEFAULT_CENTER: [22.40, 114.18],
    DEFAULT_ZOOM: 11,
    MAX_ZOOM: 19
  }
};

// Mock proj4 庫 (用於座標轉換測試)
global.proj4 = function(fromProj, toProj) {
  return {
    forward: function(coords) {
      // Mock WGS84 -> HK80 轉換
      const [lng, lat] = coords;
      // 簡化的 mock 轉換邏輯
      return [836694.05 + lng * 10000, 819069.8 + lat * 10000];
    },
    inverse: function(coords) {
      // Mock HK80 -> WGS84 轉換
      const [E, N] = coords;
      return [(E - 836694.05) / 10000, (N - 819069.8) / 10000];
    }
  };
};

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: jest.fn((key) => {
      return store[key] || null;
    }),
    setItem: jest.fn((key, value) => {
      store[key] = value.toString();
    }),
    removeItem: jest.fn((key) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    })
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock
});

// Mock console.error 避免測試輸出過於嘈雜
global.console.error = jest.fn();
global.console.warn = jest.fn();

// Mock prompt
global.prompt = jest.fn();

// 重置所有 mock
beforeEach(() => {
  localStorageMock.clear();
  jest.clearAllMocks();
});
