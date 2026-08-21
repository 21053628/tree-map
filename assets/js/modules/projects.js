/**
 * 地盤標記與選擇模組
 * v2.43 - 修正「前往地盤」按鈕的 zoom 級別
 */
import { state } from './state.js';
import { DOM, updateStatus } from './dom.js';
import { hideSearch } from './search.js';
import { drawTrees } from './trees.js';
import { emit } from '../core/event-bus.js'; // 🔥 [Phase4] 事件解耦，移除對 map.js 的直接依賴

function syncTreeActionState() {
  const hasProject = Boolean(String(state.curProject || '').trim());
  const addTreeBtn = DOM.addTreeBtn;

  if (addTreeBtn) {
    addTreeBtn.classList.toggle('ghost-hidden', !hasProject);
    addTreeBtn.classList.toggle('is-project-selected', hasProject);
    addTreeBtn.setAttribute('aria-disabled', String(!hasProject));
    addTreeBtn.title = hasProject ? '在目前地盤新增樹木' : '請先選擇地盤';
  }

  document.querySelectorAll('.layerbar button[data-act="addTree"]').forEach((button) => {
    button.classList.toggle('is-project-selected', hasProject);
    button.disabled = false;
    button.setAttribute('aria-disabled', String(!hasProject));
    button.title = hasProject ? '在目前地盤新增樹木' : '請先選擇地盤';
  });
}

export function buildSelect() {
  const sel = DOM.projSel;
  if (!sel) return;

  const inlineOnChange = sel.getAttribute('onchange');
  sel.removeAttribute('onchange');
  sel.onchange = null;

  sel.innerHTML = '<option value="">🗂️ 全部地盤</option>' +
    state.PROJECTS.map((p) => '<option value="' + p.project_id + '">🚩 ' + p.name + '</option>').join('');
  sel.value = state.curProject;
  syncTreeActionState();

  if (inlineOnChange) {
    sel.setAttribute('onchange', inlineOnChange);
  } else {
    sel.onchange = function () { window.App.selectProject(this.value); };
  }
}

export function drawProjects() {
  const startTime = performance.now();
  state.prjLayer.clearLayers();
  state.projectMarkersCache = null;

  const markers = [];

  state.PROJECTS.forEach((p) => {
    if (String(p.project_id) === String(state.curProject)) return;
    const lat = +p.lat, lng = +p.lng;
    if (!lat || !lng) return;

    const hk = CoordUtils.toHK80(lat, lng);
    const count = state.treeCountMap.get(String(p.project_id)) || 0;

    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: '<div class="prjIcon">🚩</div>',
        iconSize: [34, 24],
        iconAnchor: [17, 12]
      })
    });

    const popupDiv = L.DomUtil.create('div');
    popupDiv.innerHTML = DOMPurify.sanitize(
      '<b>🚩 ' + p.name + '</b><br>' +
      '此地盤樹木：' + count + ' 棵<br>' +
      (hk ? 'HK80：N ' + CoordUtils.format1(hk.N) + ' / E ' + CoordUtils.format1(hk.E) + '<br>' : '')
    );
    const btn = L.DomUtil.create('button', '', popupDiv);
    btn.textContent = '📍 前往地盤查看樹木';
    L.DomEvent.disableClickPropagation(btn);
    btn.onclick = function (e) {
      e.stopPropagation();
      window.App.selectProject(p.project_id);
    };
    marker.bindPopup(popupDiv);

    markers.push(marker);
  });

  if (markers.length > 0) {
    state.prjLayer.addLayer(L.layerGroup(markers));
  }

  state.perfMetrics.totalRenders++;
  state.perfMetrics.renderTime = performance.now() - startTime;
}

function performFlyTo(pid) {
  state.treesCache.clear();
  state.prjLayer.clearLayers();

  if (pid) {
    const p = state.PROJECTS.find((x) => String(x.project_id) === String(pid));
    if (p) {
      // 🔥 [v2.43 修正] 前往地盤：使用 PROJECT_ZOOM (19)，移除無效參數 easeLineProxy
      state.map.flyTo([+p.lat, +p.lng], Config.MAP.PROJECT_ZOOM || 19, { duration: 1.2 });
      state.map.once('moveend', function () { drawProjects(); drawTrees(); });
      return;
    }
  } else {
    state.map.flyTo(Config.MAP.DEFAULT_CENTER, Config.MAP.DEFAULT_ZOOM, { duration: 1.0 });
    state.map.once('moveend', function () { drawProjects(); drawTrees(); });
    return;
  }

  drawProjects();
  drawTrees();
}

export function selectProject(pid) {
  if (state.isLocating) {
    console.log('[v2.8] selectProject blocked by isLocating lock');
    return;
  }

  state.curProject = pid;
  buildSelect();
  hideSearch();

  // 🔥 [Phase4] 移除 no-op saveViewState 呼叫，斷開 projects ⇄ locate 循環依賴
  // 🔥 [Phase4] 轉地盤自動換航拍圖：改用事件通知，交由 map.js 訂閱處理
  emit('project:selected', pid);

  if (state.map) {
    state.map.closePopup();
    setTimeout(function () { performFlyTo(pid); }, 50);
  } else {
    performFlyTo(pid);
  }
}