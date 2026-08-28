/**
 * 地盤標記與選擇模組
 * v1.0.0-beta - 統一版本號（正式發佈前整合）
 * 歷史：v2.44 - XSS 加固；v2.43 - 修正 zoom 級別
 */
import { state } from './state.js';
import { DOM } from './dom.js';
import { hideSearch } from './search.js';
import { drawTrees } from './trees.js';
import { emit } from '../core/event-bus.js'; // 🔥 [Phase4] 事件解耦，移除對 map.js 的直接依賴
import { toHK80, format1 } from '../core/coordinates.js';
import { Config } from '../config.js';

function syncTreeActionState() {
  const hasProject = Boolean(String(state.curProject || '').trim());
  const addTreeBtn = DOM.addTreeBtn;
  const siteInfoBtn = DOM.siteInfoBtn;

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
  if (siteInfoBtn) {
    siteInfoBtn.classList.toggle('ghost-hidden', !hasProject);
    siteInfoBtn.classList.toggle('is-project-selected', hasProject);
    siteInfoBtn.setAttribute('aria-disabled', String(!hasProject));
    siteInfoBtn.disabled = !hasProject;
    siteInfoBtn.title = hasProject ? '查看地盤資料及樹木清單' : '請先選擇地盤';
  }
}

export function buildSelect() {
  const sel = DOM.projSel;
  if (!sel) return;

  // [v2.44 XSS 加固] 移除任何遺留的 inline handler，CSP 友好
  sel.removeAttribute('onchange');

  // [v2.44 XSS 加固] 純 DOM API 重建選單，避免 innerHTML 拼字串
  // value / textContent 由瀏覽器自動處理跳脫，p.name / p.project_id 即使含 < > " ' & 亦只會當純文字
  sel.replaceChildren();
  const frag = document.createDocumentFragment();
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = '🗂️ 全部地盤';
  frag.appendChild(allOpt);
  state.PROJECTS.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = String(p.project_id ?? '');
    opt.textContent = '🚩 ' + String(p.name ?? '');
    frag.appendChild(opt);
  });
  sel.appendChild(frag);
  sel.value = String(state.curProject ?? '');
  syncTreeActionState();
  // 變更監聽由 app.js 單次綁定 addEventListener('change') 統一處理，此處不再寫入 inline onchange
}

export function drawProjects() {
  const startTime = performance.now();
  state.prjLayer.clearLayers();
  state.projectMarkersCache = null;

  const markers = [];

  state.PROJECTS.forEach((p) => {
    if (String(p.project_id) === String(state.curProject)) return;
    const lat = +p.lat, lng = +p.lng;
    if (isNaN(lat) || isNaN(lng)) return;

    const hk = toHK80(lat, lng);
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
    // [v2.44 XSS 加固] 改用 DOM API 逐段以 textContent / createTextNode 組裝，不再 innerHTML + DOMPurify 拼字串
    const b = document.createElement('b');
    b.textContent = '🚩 ' + String(p.name ?? '');
    popupDiv.appendChild(b);
    popupDiv.appendChild(document.createElement('br'));
    popupDiv.appendChild(document.createTextNode('此地盤樹木：' + String(count) + ' 棵'));
    popupDiv.appendChild(document.createElement('br'));
    if (hk) {
      popupDiv.appendChild(document.createTextNode('HK80：N ' + format1(hk.N) + ' / E ' + format1(hk.E)));
      popupDiv.appendChild(document.createElement('br'));
    }
    const btn = L.DomUtil.create('button', '', popupDiv);
    btn.textContent = '📍 前往地盤查看樹木';
    L.DomEvent.disableClickPropagation(btn);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      selectProject(p.project_id);
    });
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

  function afterFly(cb) {
    var done = false;
    function run() {
      if (done) return;
      done = true;
      cb();
    }
    state.map.once('moveend', run);
    setTimeout(run, 1500); // 安全網：flyTo 若被中斷仍會觸發
  }

  if (pid) {
    const p = state.PROJECTS.find((x) => String(x.project_id) === String(pid));
    if (p) {
      // 🔥 [v2.43 修正] 前往地盤：使用 PROJECT_ZOOM (19)，移除無效參數 easeLineProxy
      state.map.flyTo([+p.lat, +p.lng], Config.MAP.PROJECT_ZOOM || 19, { duration: 1.2 });
      afterFly(function () { drawProjects(); drawTrees(); });
      return;
    }
  } else {
    state.map.flyTo(Config.MAP.DEFAULT_CENTER, Config.MAP.DEFAULT_ZOOM, { duration: 1.0 });
    afterFly(function () { drawProjects(); drawTrees(); });
    return;
  }

  drawProjects();
  drawTrees();
}

export function selectProject(pid, opts) {
  if (state.isLocating) {
    console.log('[v2.8] selectProject blocked by isLocating lock');
    return;
  }
  opts = opts || {};
  pid = pid ? String(pid) : '';
  state.curProject = pid;
  buildSelect();
  hideSearch();
  emit('project:selected', pid);
  // 依 project 按需載入：首次進入該地盤自動拉樹（動態 import 避免循環依賴）
  if (pid && !opts.skipLoad) {
    const hasData = state.treeSearchIndex.has(pid) && state.treeSearchIndex.get(pid).length > 0;
    if (!hasData) {
      import('./loader.js').then(function(m){ if(m.loadTreesForProject) m.loadTreesForProject(pid).catch(function(e){ console.warn('[selectProject] loadTrees failed', e); }); }).catch(function(){ /* intentionally ignored: optional fallback failure */ });
    }
  }
  if (state.map) {
    state.map.closePopup();
    setTimeout(function () { performFlyTo(pid); }, 50);
  } else {
    performFlyTo(pid);
  }
}