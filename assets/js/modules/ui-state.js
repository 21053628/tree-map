/**
 * UI 狀態模組 [Phase3]
 * 集中管理地圖、圖層、GPS、繪圖、渲染快取等「UI/渲染層」狀態，
 * 與業務資料（projects/trees/索引）分離。
 * 透過 state.js 的 Proxy 轉發，對下游保持 `state.xxx` 存取不變。
 */
export const uiState = {
  // 渲染快取
  projectMarkersCache: null,
  treesCache: new Map(),
  spatialIndexCache: null,
  coordGroupsCache: null,

  // 地圖核心
  map: null,
  treeLayer: null,
  prjLayer: null,
  baseLayers: {},
  markerCluster: null,
  currentBaseLayer: null,

  // 地段索引圖層
  lotLayer: null,
  lotLayerEnabled: false,
  lotCache: new Map(), // bboxKey -> {data, timestamp}
  lotLoadTimer: null,

  // 航拍圖疊加層
  aerialLayer: null,
  aerialEnabled: false,

  // GPS 定位與繪圖邊界
  geolocation: { marker: null, circle: null },
  drawBoundary: null,

  isLocating: false,

  // 效能計數
  perfMetrics: {
    renderTime: 0,
    cacheHits: 0,
    totalRenders: 0,
    spatialIndexBuildTime: 0
  }
};