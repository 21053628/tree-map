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