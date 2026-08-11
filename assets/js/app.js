/**
 * 樹木管理系統 - 主入口（ES Modules 版本）
 * v2.31 - 移除 inline onclick，改用 addEventListener 綁定
 * 
 * 🔥 重要：config / api / utils / auth 係舊式腳本，用 top-level const 宣告。
 *    const 唔會掛去 window，但會進入全域詞法環境，
 *    所以 module 入面直接用「裸名」就可以，千萬唔好用 window.XXX！
 */

import { state } from './modules/state.js';
import { DOM, updateStatus, closePanel } from './modules/dom.js';
import { initMap, setClosePanel, setHideSearch } from './modules/map.js';
import { buildSearchIndex, handleSearch, hideSearch } from './modules/search.js';
import { loadTreeSpecies } from './modules/species.js';
import { drawTrees } from './modules/trees.js';
import { drawProjects, selectProject, buildSelect } from './modules/projects.js';
import { locateTree, checkURLParams } from './modules/locate.js';
import { clearLotCache } from './modules/lots.js';
import {
  openProjectForm, doCreateProject,
  openTreeForm, doCreateTree,
  setLoad, setPromptAuth
} from './modules/forms.js';

// 全域依賴注入（避免循環依賴）
// Config / ApiService / AuthService / CoordUtils 直接用裸名（全域詞法環境）
ApiService.init(Config.API_ENDPOINT);
setClosePanel(closePanel);
setHideSearch(hideSearch);
setLoad(load);
setPromptAuth(() => AuthService.promptAuth());

// 全域函數
async function load() {
  updateStatus('🗺️ 載入中…');

  try {
    const [projectsRes, treesRes] = await Promise.all([
      ApiService.get('projects'),
      ApiService.get('trees')
    ]);

    state.PROJECTS = projectsRes.data || [];
    state.TREES = treesRes.data || [];

    state.treeCountMap.clear();
    state.treeMap.clear();
    state.TREES.forEach((t) => {
      const pid = String(t.project_id || '');
      state.treeCountMap.set(pid, (state.treeCountMap.get(pid) || 0) + 1);
      state.treeMap.set(pid + '_' + String(t.tree_id), t);
    });

    buildSearchIndex();

    state.projectMarkersCache = null;
    state.treesCache.clear();
    state.spatialIndexCache = null;
    state.coordGroupsCache = null;

    buildSelect();
    hideSearch();
    drawProjects();
    drawTrees();

    const stats = ApiService.getStats();
    console.log('✅ 資料載入完成', stats);
    return Promise.resolve();
  } catch (error) {
    updateStatus('❌ 後端連線失敗：' + error.message);
    console.error('載入失敗:', error);
  }
}

function getPerfMetrics() {
  return {
    renderTime: state.perfMetrics.renderTime,
    cacheHits: state.perfMetrics.cacheHits,
    totalRenders: state.perfMetrics.totalRenders,
    apiStats: ApiService.getStats(),
    coordCacheStats: CoordUtils.getCacheStats()
  };
}

function clearCache() {
  state.projectMarkersCache = null;
  state.treesCache.clear();
  state.treeCountMap.clear();
  state.treeMap.clear();
  state.treeSearchIndex.clear();
  state.spatialIndexCache = null;
  state.coordGroupsCache = null;
  clearLotCache();
  localStorage.removeItem('tree_map_last_view');
  console.log('🗑️ 緩存已清除');
}

function focusTree(treeId) {
  hideSearch();
  if (DOM.treeSearch) { DOM.treeSearch.value = ''; DOM.treeSearch.blur(); }
  locateTree(String(treeId), state.curProject, null, null);
}

// 初始化
function init() {
  DOM.statusEl = document.getElementById('status');
  DOM.projSel = document.getElementById('projSel');
  DOM.addTreeBtn = document.getElementById('addTreeBtn');
  DOM.panel = document.getElementById('panel');
  DOM.panelContent = document.getElementById('panelContent');
  DOM.searchResults = document.getElementById('searchResults');
  DOM.treeSearch = document.getElementById('treeSearch');

  // 🔥 [v2.31] 綁定事件監聽器（取代 inline onclick）
  const addProjectBtn = document.getElementById('addProjectBtn');
  if (addProjectBtn) {
    addProjectBtn.addEventListener('click', () => openProjectForm());
  }
  if (DOM.addTreeBtn) {
    DOM.addTreeBtn.addEventListener('click', () => openTreeForm());
  }
  if (DOM.projSel) {
    DOM.projSel.addEventListener('change', (e) => selectProject(e.target.value));
  }
  if (DOM.treeSearch) {
    DOM.treeSearch.addEventListener('input', (e) => handleSearch(e.target.value));
    DOM.treeSearch.addEventListener('focus', (e) => handleSearch(e.target.value));
  }

  if (!initMap()) return;

  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => CoordUtils.preheatCache());
  } else {
    setTimeout(() => CoordUtils.preheatCache(), 100);
  }

  loadTreeSpecies();

  if (DOM.searchResults) {
    DOM.searchResults.addEventListener('click', (e) => {
      const item = e.target?.closest?.('.sr-item[data-id]');
      if (item) focusTree(item.getAttribute('data-id'));
    });
  }
  document.addEventListener('click', (e) => {
    if (!e.target?.closest?.('.search-wrap')) hideSearch();
  });

  load().then(() => checkURLParams());

  console.log('🌳 樹木管理系統已啟動（ES Modules 版本 v2.31）');
}

document.addEventListener('DOMContentLoaded', init);

// 🔥 全域 API（向後相容，保留 window.App）
window.App = {
  selectProject,
  openProjectForm,
  doCreateProject,
  openTreeForm,
  doCreateTree,
  closePanel,
  clearCache,
  getPerfMetrics,
  locateTree,
  handleSearch,
  focusTree
};