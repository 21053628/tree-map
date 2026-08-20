/**
 * 樹木管理系統 - 主入口（ES Modules 版本）
 * v2.55 - 狀態雲「前置→淡出」：更新時浮到最前 3 秒，然後漸變退回後面
 * v2.54 - 兩段式載入：快照 → GAS 背景刷新
 * [Phase2] 移除脆皮 setter 注入，改由模組直接 import
 */

import { state } from './modules/state.js';
import { DOM, closePanel } from './modules/dom.js';
import { initMap } from './modules/map.js';
import { handleSearch, hideSearch } from './modules/search.js';
import { loadTreeSpecies } from './modules/species.js';
import { selectProject } from './modules/projects.js';
import { locateTree, checkURLParams } from './modules/locate.js';
import { clearLotCache } from './modules/lots.js';
import {
  openProjectForm, doCreateProject,
  openTreeForm, doCreateTree,
  pickTreeLocation,
  setPromptAuth
} from './modules/forms.js';
import { load } from './modules/loader.js';

// 全域依賴注入（剩餘：AuthService 尚未轉 ESM）
ApiService.init(Config.API_ENDPOINT);
setPromptAuth(() => AuthService.promptAuth());

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
  state.treeLowerIndex.clear();
  state.treeIdIndex.clear();
  state.spatialIndexCache = null;
  state.coordGroupsCache = null;
  clearLotCache();
  localStorage.removeItem('tree_map_last_view');
  if (typeof ApiService !== 'undefined' && ApiService.clearCache) ApiService.clearCache();
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
  DOM.addProjectBtn = document.getElementById('addProjectBtn');
  DOM.addTreeBtn = document.getElementById('addTreeBtn');
  DOM.panel = document.getElementById('panel');
  DOM.panelContent = document.getElementById('panelContent');
  DOM.searchResults = document.getElementById('searchResults');
  DOM.treeSearch = document.getElementById('treeSearch');

  // 🔥 [v2.55] 狀態雲「前置→淡出」：文字一變就浮到最前 3 秒，然後退回後面
  if (DOM.statusEl && 'MutationObserver' in window) {
    let frontTimer = null;
    const mo = new MutationObserver(function () {
      DOM.statusEl.classList.add('status-front');
      clearTimeout(frontTimer);
      frontTimer = setTimeout(function () {
        DOM.statusEl.classList.remove('status-front');
      }, 3000);
    });
    mo.observe(DOM.statusEl, { childList: true, characterData: true, subtree: true });
  }

  if (DOM.addProjectBtn) {
    DOM.addProjectBtn.addEventListener('click', () => openProjectForm());
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

  console.log('🌳 樹木管理系統已啟動（ES Modules 版本 v2.55 - 狀態雲前置淡出）');
}

document.addEventListener('DOMContentLoaded', init);

// 🔥 全域 API（向後相容，保留 window.App）
window.App = {
  selectProject,
  openProjectForm,
  doCreateProject,
  openTreeForm,
  doCreateTree,
  pickTreeLocation,
  closePanel,
  clearCache,
  getPerfMetrics,
  locateTree,
  handleSearch,
  focusTree
};