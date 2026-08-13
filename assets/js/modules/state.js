/**
 * 全域狀態模組
 * 集中管理所有可變狀態，避免散落到各處
 */

export const state = {
  PROJECTS: [],
  TREES: [],
  curProject: '',
  
  treeCountMap: new Map(),
  treeMap: new Map(),
  treeSearchIndex: new Map(), // projectId -> array of trees
  // 🔥 [Phase1] 大小寫不敏感定位索引（O(1)，取代 locateTree 的 O(N) 線性掃描）
  treeLowerIndex: new Map(), // pid_lower + '_' + tree_id_lower -> tree
  treeIdIndex: new Map(),    // tree_id_lower -> tree（全域，取首個）
  
  projectMarkersCache: null,
  treesCache: new Map(),
  spatialIndexCache: null,
  coordGroupsCache: null,
  
  map: null,
  treeLayer: null,
  prjLayer: null,
  baseLayers: {},
  markerCluster: null,
  currentBaseLayer: null,
  
  lotLayer: null,
  lotLayerEnabled: false,
  lotCache: new Map(), // bboxKey -> {data, timestamp}
  lotLoadTimer: null,
    // 🔥 [v2.33] 航拍圖疊加層
  aerialLayer: null,
  aerialEnabled: false,
  
  // 🔥 [Phase1] GPS 定位與繪圖邊界
  geolocation: { marker: null, circle: null },
  drawBoundary: null,
  
  isLocating: false,
  
  speciesCache: null,
  speciesPromise: null,
  
  perfMetrics: {
    renderTime: 0,
    cacheHits: 0,
    totalRenders: 0,
    spatialIndexBuildTime: 0
  }
};

export const LOT_CACHE_MAX = 50;