/**
 * 全域狀態模組
 * [Phase3] 拆分職責：
 *   - 業務資料（PROJECTS / TREES / 索引 / speciesCache）留在這裡
 *   - UI/渲染層狀態（map / layers / GPS / draw / perfMetrics）移到 ui-state.js
 * 透過 Proxy 將 UI 欄位轉發到 uiState，對下游保持 `state.xxx` 存取不變。
 */
import { uiState } from './ui-state.js';

const businessState = {
  PROJECTS: [],
  TREES: [],
  curProject: '',

  treeCountMap: new Map(),
  treeMap: new Map(),
  treeSearchIndex: new Map(), // projectId -> array of trees
  // 🔥 [Phase1] 大小寫不敏感定位索引（O(1)，取代 locateTree 的 O(N) 線性掃描）
  treeLowerIndex: new Map(), // pid_lower + '_' + tree_id_lower -> tree
  treeIdIndex: new Map(),    // tree_id_lower -> tree（全域，取首個）

  speciesCache: null,
  speciesPromise: null,
};

// UI 層欄位：轉發到 uiState（保留 state.map / state.perfMetrics 等舊有存取）
const UI_KEYS = [
  'projectMarkersCache',
  'treesCache',
  'spatialIndexCache',
  'coordGroupsCache',
  'map',
  'treeLayer',
  'prjLayer',
  'baseLayers',
  'markerCluster',
  'currentBaseLayer',
  'lotLayer',
  'lotLayerEnabled',
  'lotCache',
  'lotLoadTimer',
  'aerialLayer',
  'aerialEnabled',
  'geolocation',
  'drawBoundary',
  'isLocating',
  'perfMetrics'
];

export const state = new Proxy(businessState, {
  get(target, prop, receiver) {
    if (UI_KEYS.indexOf(prop) !== -1) {
      return Reflect.get(uiState, prop, uiState);
    }
    return Reflect.get(target, prop, receiver);
  },
  set(target, prop, value, receiver) {
    if (UI_KEYS.indexOf(prop) !== -1) {
      return Reflect.set(uiState, prop, value, uiState);
    }
    return Reflect.set(target, prop, value, receiver);
  },
  has(target, prop) {
    return (UI_KEYS.indexOf(prop) !== -1) || Reflect.has(target, prop);
  },
  ownKeys(target) {
    return Array.from(new Set([
      ...Reflect.ownKeys(target),
      ...Object.keys(uiState)
    ]));
  },
  getOwnPropertyDescriptor(target, prop) {
    if (UI_KEYS.indexOf(prop) !== -1) {
      return Reflect.getOwnPropertyDescriptor(uiState, prop);
    }
    return Reflect.getOwnPropertyDescriptor(target, prop);
  }
});

export const LOT_CACHE_MAX = 50;