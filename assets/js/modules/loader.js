/**
 * 資料載入服務（兩段式載入：快照 → GAS 背景刷新）
 * [Phase2] 由 app.js 抽出，供 forms / app 共用，移除 setter 注入
 */
import { state } from './state.js';
import { updateStatus } from './dom.js';
import { hideSearch } from './search.js';
import { drawTrees } from './trees.js';
import { drawProjects, buildSelect } from './projects.js';

// 🔥 抽出資料處理邏輯，供本地快照同網路刷新共用
export function applyData(projects, trees) {
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
export async function load() {
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

  // 2️⃣ 背景刷新：只接受「真正最新」的資料，過期快取一律拒絕並自動重試
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