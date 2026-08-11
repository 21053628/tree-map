/**
 * 地盤標記與選擇模組
 * v2.33 - 加入航拍圖自動刷新
 */
import { state } from './state.js';
import { DOM, updateStatus } from './dom.js';
import { hideSearch } from './search.js';
import { saveViewState } from './locate.js';
import { drawTrees } from './trees.js';
import { refreshAerial } from './map.js'; // 🔥 [v2.33] 加入航拍圖刷新

export function buildSelect() {
  const sel = DOM.projSel;
  if (!sel) return;

  const inlineOnChange = sel.getAttribute('onchange');
  sel.removeAttribute('onchange');
  sel.onchange = null;

  sel.innerHTML = '<option value="">🗂️ 全部地盤</option>' +
    state.PROJECTS.map((p) => '<option value="' + p.project_id + '">🚩 ' + p.name + '</option>').join('');
  sel.value = state.curProject;
  DOM.addTreeBtn.classList.toggle('ghost-hidden', !state.curProject);

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
  console.log('📊 地盤渲染耗時:', state.perfMetrics.renderTime.toFixed(2), 'ms');
}

function performFlyTo(pid) {
  state.treesCache.clear();
  state.prjLayer.clearLayers();

  if (pid) {
    const p = state.PROJECTS.find((x) => String(x.project_id) === String(pid));
    if (p) {
      state.map.flyTo([+p.lat, +p.lng], Config.MAP.MAX_ZOOM, { duration: 1.2, easeLineProxy: 0.25 });
      state.map.once('moveend', function () { drawProjects(); drawTrees(); });
      return;
    }
  } else {
    state.map.flyTo(Config.MAP.DEFAULT_CENTER, Config.MAP.DEFAULT_ZOOM, { duration: 1.0, easeLineProxy: 0.25 });
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
  saveViewState('', null, null);
  
  // 🔥 [v2.33] 轉地盤自動換航拍圖
  refreshAerial();

  if (state.map) {
    state.map.closePopup();
    setTimeout(function () { performFlyTo(pid); }, 50);
  } else {
    performFlyTo(pid);
  }
}