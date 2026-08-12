/**
 * 樹木管理系統 - 主入口（ES Modules 版本）
 * v2.54 - 移除靜態 bootstrap.json 依賴，兩段式載入：快照 → GAS 背景刷新
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

// 🔥 [v2.32] 抽出資料處理邏輯，供本地快照同網路刷新共用
function applyData(projects, trees) {
  state.PROJECTS = projects;
  state.TREES = trees;

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
}

// 🔥 [v2.54] 兩段式載入＋拒絕過期快取＋自動重試：快照 → GAS 背景刷新
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
    const res = await ApiService.get('bootstrap'); // GAS 合併讀取端點（保留）

    // 🔥 [v2.54 核心修正] offline.js 返回過期快取時會標記 offline:true
    // 過期快取 ≠ 成功刷新！拒絕套用，逼佢重試直到攞到真數據
    if (!res || res.offline || res.stale) throw new Error('STALE_CACHE');

    const projects = (res.data && res.data.projects) || [];
    const trees = (res.data && res.data.trees) || [];
    if (!projects.length && !trees.length) throw new Error('EMPTY_RESPONSE');

    // ✅ 真・最新數據：套用＋更新快照（Excel 刪咗記錄會跟住消失）
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
    await tryRefresh(2); // 即時 1 次 ＋ 5 秒間隔重試 2 次
    return Promise.resolve();
  } catch (error) {
    if (hasLocal) {
      // 有本地資料但網路失敗：保持顯示，唔使彈大錯誤
      updateStatus('📴 未能連線後端：顯示本地快取（資料可能較舊）');
    } else {
      // 完全無資料且網路失敗：顯示錯誤
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
  state.spatialIndexCache = null;
  state.coordGroupsCache = null;
  clearLotCache();
  localStorage.removeItem('tree_map_last_view');
  // 🔥 [v2.54] 連 localStorage 舊 API 快取都清埋
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

  console.log('🌳 樹木管理系統已啟動（ES Modules 版本 v2.54 - 兩段式載入）');
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