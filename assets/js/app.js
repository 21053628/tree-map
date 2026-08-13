/**
 * 樹木管理系統 - 主入口（ES Modules 版本）
 * v2.55 - 狀態雲「彈前→漸退」：更新時浮到最前 3 秒，然後漸變退返後面
 * v2.54 - 兩段式載入：快照 → GAS 背景刷新
 */

import { state } from './modules/state.js';
import { DOM, updateStatus, closePanel } from './modules/dom.js';
import { initMap, setClosePanel, setHideSearch } from './modules/map.js';
import { handleSearch, hideSearch } from './modules/search.js';
import { loadTreeSpecies } from './modules/species.js';
import { drawTrees } from './modules/trees.js';
import { drawProjects, selectProject, buildSelect } from './modules/projects.js';
import { locateTree, checkURLParams } from './modules/locate.js';
import { clearLotCache } from './modules/lots.js';
import {
  openProjectForm, doCreateProject,
  openTreeForm, doCreateTree,
  pickTreeLocation,
  setLoad, setPromptAuth
} from './modules/forms.js';

// 全域依賴注入（避免循環依賴）
ApiService.init(Config.API_ENDPOINT);
setClosePanel(closePanel);
setHideSearch(hideSearch);
setLoad(load);
setPromptAuth(() => AuthService.promptAuth());

// 🔥 [v2.32] 抽出資料處理邏輯，供本地快照同網路刷新共用
function applyData(projects, trees) {
  state.PROJECTS = projects;
  state.TREES = trees;

  state.treeCountMap.clear();
  state.treeMap.clear();
  state.treeSearchIndex.clear();
  state.treeLowerIndex.clear();
  state.treeIdIndex.clear();

  // 🔥 [Phase1] 單次遍歷：正規化座標 + 建構所有索引（取代原先多次 pass）
  const searchIndex = state.treeSearchIndex;
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    const pid = String(t.project_id || '');
    const tid = String(t.tree_id);

    // 正規化：字串座標轉 number（避免渲染迴圈每幀重複 +t.lat/+t.lng）
    if (typeof t.lat === 'string') t.lat = +t.lat;
    if (typeof t.lng === 'string') t.lng = +t.lng;
    // 預存狀態色（避免渲染與 popup 每次重新查色表）
    t._color = Config.TREE_STATUS_COLORS[t.status] || Config.TREE_STATUS_COLORS.Unknown;

    // 地盤樹木計數
    state.treeCountMap.set(pid, (state.treeCountMap.get(pid) || 0) + 1);

    // 精確索引 (pid + '_' + tree_id)
    state.treeMap.set(pid + '_' + tid, t);

    // 🔥 [Phase1] 大小寫不敏感定位索引（O(1)）
    const pidLower = pid.toLowerCase();
    const tidLower = tid.toLowerCase();
    state.treeLowerIndex.set(pidLower + '_' + tidLower, t);
    if (!state.treeIdIndex.has(tidLower)) state.treeIdIndex.set(tidLower, t);

    // 地盤搜尋索引 (pid -> trees)
    let arr = searchIndex.get(pid);
    if (!arr) { arr = []; searchIndex.set(pid, arr); }
    arr.push(t);
  }

  state.projectMarkersCache = null;
  state.treesCache.clear();
  state.spatialIndexCache = null;
  state.coordGroupsCache = null;

  buildSelect();
  hideSearch();
  drawProjects();
  drawTrees();
}

// 🔥 [v2.54] 兩段式載入＋拒絕過期快取＋自動重試
async function load() {
  updateStatus('🗺️ 載入中…');

  let hasLocal = false;

  // 1️⃣ IndexedDB 快照（回訪用戶 0 秒）
  if (window.TreeSnapshot) {
    try {
      const snap = await window.TreeSnapshot.load('main');
      if (snap && snap.projects && snap.trees) {
        applyData(snap.projects, snap.trees);
        hasLocal = true;
        updateStatus('⚡ 本地快取顯示中，後台刷新…');
      }
    } catch (e) {
      console.warn('Snapshot load failed', e);
    }
  }

  // 2️⃣ 背景刷新：只接受「真・最新」數據，過期快取一律拒絕＋自動重試
  async function refreshFromGAS() {
    const res = await ApiService.get('bootstrap');

    if (!res || res.offline || res.stale) throw new Error('STALE_CACHE');

    const projects = (res.data && res.data.projects) || [];
    const trees = (res.data && res.data.trees) || [];
    if (!projects.length && !trees.length) throw new Error('EMPTY_RESPONSE');

    applyData(projects, trees);
    if (window.TreeSnapshot) {
      window.TreeSnapshot.save('main', { projects, trees }).catch(() => {});
    }
    console.log('✅ 已從後端載入最新資料', ApiService.getStats());
    return true;
  }

  async function tryRefresh(attemptsLeft) {
    try {
      await refreshFromGAS();
      updateStatus('✅ 資料已更新至最新');
      return true;
    } catch (err) {
      if (attemptsLeft > 0) {
        console.log('⏳ 後端未就緒／返回過期快取，5 秒後重試（餘 ' + attemptsLeft + ' 次）');
        await new Promise(function (r) { setTimeout(r, 5000); });
        return tryRefresh(attemptsLeft - 1);
      }
      throw err;
    }
  }

  try {
    await tryRefresh(2);
    return Promise.resolve();
  } catch (error) {
    if (hasLocal) {
      updateStatus('📴 未能連線後端：顯示本地快取（資料可能較舊）');
    } else {
      updateStatus('❌ 後端連線失敗：' + error.message);
    }
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
  DOM.addTreeBtn = document.getElementById('addTreeBtn');
  DOM.panel = document.getElementById('panel');
  DOM.panelContent = document.getElementById('panelContent');
  DOM.searchResults = document.getElementById('searchResults');
  DOM.treeSearch = document.getElementById('treeSearch');

  // 🔥 [v2.55] 狀態雲「彈前→漸退」：文字一變就浮到最前 3 秒，然後退返後面
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

  console.log('🌳 樹木管理系統已啟動（ES Modules 版本 v2.55 - 狀態雲彈前漸退）');
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
