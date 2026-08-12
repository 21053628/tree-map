/**
 * URL 參數解析與定位模組
 * v2.44 - 移除 localStorage 記憶，F5 刷新時回到預設位置
 */
import { state } from './state.js';
import { DOM, updateStatus } from './dom.js';
import { buildSelect } from './projects.js';
import { drawProjects } from './projects.js';
import { drawTrees } from './trees.js';
import { refreshAerial } from './map.js'; // 🔥 [v2.33] 加入航拍圖刷新

export function saveViewState(treeId, lat, lng) {
  // 🔥 [v2.44] 移除 localStorage 儲存，F5 刷新時不再跳回上次位置
  // 保留函數殼避免其他模組 (如 projects.js) 呼叫時出錯
}

export function locateTree(treeId, projectId, lat, lng) {
  state.isLocating = true;

  let tree = null;
  let targetPid = projectId ? String(projectId) : '';

  // 大小寫不敏感
  if (targetPid) {
    const proj = state.PROJECTS.find((x) =>
      String(x.project_id).toLowerCase() === targetPid.toLowerCase()
    );
    if (proj) targetPid = String(proj.project_id);
  }

  if (treeId) {
    tree = state.treeMap.get(targetPid + '_' + String(treeId));
    if (!tree) {
      const tp = targetPid.toLowerCase();
      tree = state.TREES.find((t) =>
        String(t.tree_id) === String(treeId) &&
        (!tp || String(t.project_id || '').toLowerCase() === tp)
      ) || null;
    }
  }

  const finalPid = tree ? String(tree.project_id || '') : targetPid;
  const targetLat = tree ? +tree.lat : (lat ? +lat : null);
  const targetLng = tree ? +tree.lng : (lng ? +lng : null);

  if (finalPid && String(state.curProject) !== finalPid) {
    state.curProject = finalPid;

    const sel = DOM.projSel;
    if (sel) {
      const inlineOnChange = sel.getAttribute('onchange');
      sel.removeAttribute('onchange');
      sel.onchange = null;

      let hasOption = false;
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === finalPid) { hasOption = true; break; }
      }
      if (hasOption) {
        sel.value = finalPid;
      } else {
        buildSelect();
      }

      if (inlineOnChange) sel.setAttribute('onchange', inlineOnChange);
      else sel.onchange = function () { window.App.selectProject(this.value); };
    }
    DOM.addTreeBtn.classList.toggle('ghost-hidden', !state.curProject);

    state.treesCache.clear();
    state.spatialIndexCache = null;
    state.coordGroupsCache = null;
    drawProjects();
    drawTrees();
    
    // 🔥 [v2.33] 定位後同步換航拍圖
    refreshAerial();
  }

  if (targetLat && targetLng && !isNaN(targetLat) && !isNaN(targetLng)) {
    // 🔥 [v2.39] 搜尋／定位到樹木後使用 TREE_ZOOM (22)，只給座標使用 MAX_ZOOM
    state.map.flyTo([targetLat, targetLng], tree ? Config.MAP.TREE_ZOOM : (state.map.getZoom() || Config.MAP.MAX_ZOOM), { duration: 1.2 });

    if (tree) {
      setTimeout(function () {
        const marker = state.treesCache.get(finalPid + '_' + tree.tree_id) ||
          state.treesCache.get(tree.tree_id) ||
          state.treesCache.get(String(treeId));
        if (marker) {
          state.treesCache.forEach((m) => m.setZIndexOffset(0));
          marker.setZIndexOffset(2000);
          marker.openPopup();
          updateStatus('✅ 已定位到樹木：' + treeId);
        }
      }, 1400);
    }
  } else if (finalPid) {
    const p = state.PROJECTS.find((x) => String(x.project_id) === finalPid);
    if (p) {
      // 🔥 [v2.39] 純地盤定位使用 PROJECT_ZOOM (19)
      state.map.flyTo([+p.lat, +p.lng], Config.MAP.PROJECT_ZOOM, { duration: 1.2 });
    }
  }

  if (window.history && window.history.replaceState) {
    window.history.replaceState({}, '', window.location.pathname);
  }

  saveViewState(treeId, targetLat, targetLng);

  setTimeout(function () {
    state.isLocating = false;
  }, 2000);
}

export function checkURLParams() {
  const params = new URLSearchParams(location.search);
  let treeId = params.get('tree_id');
  let projectId = params.get('project_id');
  let lat = params.get('lat');
  let lng = params.get('lng');

  // 🔥 [v2.44] 移除 localStorage 讀取：F5 刷新時 URL 乾淨，直接留喺預設位置
  // 只有當 URL 真正帶有參數（例如由 t.html 撳返回掣）先至會定位

  if (treeId || projectId || (lat && lng)) {
    setTimeout(function () { locateTree(treeId, projectId, lat, lng); }, 600);
  }
}