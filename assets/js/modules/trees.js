/**
 * 樹木標記與 popup 模組
 * v1.0.0-beta - 統一版本號（正式發佈前整合）
 * 歷史：v4.5 - 增量差量 + 防閃爍；v4.4 - 狀態過濾；v4.3 - 標籤三模式；v4.2 - 編號標籤系統；v4.1 - 固定尺寸 marker
 */
import { state } from './state.js';
import { updateStatus, escapeHtml } from './dom.js';
import { sanitizeHtml } from '../core/utils.js';
import { querySpatialIndex } from '../core/spatial-index.js';
import { toHK80, format1 } from '../core/coordinates.js';
import { Config } from '../config.js';

/* =========================================================
 * 樹木狀態點使用固定尺寸 DivIcon。
 * MarkerCluster 的縮放動畫只配合 L.Marker，避免把 Path/Canvas
 * 混入 cluster 後在 NFC flyTo 高倍 zoom 時產生放大殘影。
 * ========================================================= */

// 🔥 [C1] 可視範圍邊距（0.3 個視窗，避免拖動邊緣樹突然出現/消失）
const BOUNDS_PADDING = 0.3;

// 🔥 [Phase1] 單一渲染排程器（供 moveend 使用）：合併原先「重繪 + 標籤」兩個獨立 debounce，
// 避免每次平移地圖觸發多輪全量重繪與 DOM 重建。
let _redrawTimer = null;
let _lastSilentSet = null;
let _lastSilentZoom = null;
export function scheduleRedraw() {
  clearTimeout(_redrawTimer);
  _redrawTimer = setTimeout(() => drawTrees(true), 150);
}

/* =========================================================
 * 🔥 [v4.4] 狀態過濾（null = 全部顯示）
 * ========================================================= */
let statusFilter = null;

export function setStatusFilter(set) {
  // null/undefined = 顯示全部（不過濾）；空 Set = 全部唔顯示
  if (set === null || set === undefined) {
    statusFilter = null;
  } else {
    // 保留空 Set 原意：空 = 無樹木符合
    statusFilter = set;
  }
  drawTrees();
}

 // 🔥 修正：兼容 L.Marker 與 Path 圖層，避免直接呼叫不存在的 bringToFront
export function bringTreeToFront(marker) {
  if (!marker) return;
  if (typeof marker.bringToFront === 'function') {
    marker.bringToFront();
  } else if (typeof marker.setZIndexOffset === 'function') {
    marker.setZIndexOffset(1000);
  }
}

export function getStatusFilter() { return statusFilter; }

function currentTrees() {
  const list = state.treeSearchIndex.get(state.curProject) || [];
  if (!statusFilter) return list; // null = 全部顯示
  if (statusFilter.size === 0) return []; // 空 Set = 全部唔顯示
  return list.filter((t) => statusFilter.has(t.status));
}

/* =========================================================
 * 🔥 [v4.3] 樹木編號標籤系統（三模式版）
 * mode: 'auto' = 智能（zoom>=20 先顯示，默認）
 *       'on'   = 恆常顯示
 *       'off'  = 全部關閉
 * ========================================================= */
const LABEL_MIN_ZOOM = 20;
const LABEL_MAX_COUNT = 400;
let labelMode = 'auto';
let labelLayer = null;
let _labelTimer = null;
let _lastLabelZoom = null; // 🔥 記錄上次 label 刷新時的 zoom，平移時不重建 label

function labelsShouldShow(){
  if (labelMode === 'on') return true;
  if (labelMode === 'off') return false;
  return !!(state.map && state.map.getZoom() >= LABEL_MIN_ZOOM); // auto
}

// 🔥 按鈕外觀跟隨模式變
function updateLabelBtn(){
  const btn = document.querySelector('.layerbar button[data-l="labels"]');
  if (!btn) return;
  btn.classList.toggle('on', labelMode === 'on');
  btn.classList.toggle('label-btn--off', labelMode === 'off');
  btn.title = labelMode === 'on' ? '樹木編號：恆常顯示（按切換）'
        : labelMode === 'off' ? '樹木編號：關閉（按切換）'
        : '樹木編號：智能（按切換）';
}

// 🔥 三模式循環（map.js 的 🔢 按鈕呼叫這個）
export function toggleTreeLabels(){
  labelMode = labelMode === 'auto' ? 'on' : (labelMode === 'on' ? 'off' : 'auto');
  updateLabelBtn();
  refreshLabels();
  if (labelMode === 'on' && !labelLayer && state.curProject) {
    updateStatus('⚠️ 可見樹木太多，請先放大再顯示編號');
  } else if (labelMode === 'on') {
    updateStatus('✅ 樹木編號：恆常顯示');
  } else if (labelMode === 'off') {
    updateStatus('🚫 樹木編號：已關閉');
  } else {
    updateStatus('✅ 樹木編號：智能（放大顯示）');
  }
}

// 🔥 重建標籤層（空間索引 + 性能保護）
export function refreshLabels(){
  if (!state.map) return;
  _lastLabelZoom = state.map.getZoom();
  if (labelLayer) { state.map.removeLayer(labelLayer); labelLayer = null; }
  if (!labelsShouldShow() || !state.curProject) return;

  const bounds = state.map.getBounds();
  const filterFn = statusFilter ? (t) => statusFilter.has(t.status) : null;
  let visible = querySpatialIndex(state.curProject, bounds, filterFn);
  if (visible.length > LABEL_MAX_COUNT) return;
  if (!visible.length) return;

  labelLayer = L.layerGroup();
  visible.forEach((t) => {
    labelLayer.addLayer(L.marker([+t.lat, +t.lng], {
      icon: L.divIcon({
        className: '',
        html: '<div style="transform:translate(-50%,-200%);color:#fff;font-size:11px;font-weight:700;white-space:nowrap;text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 0 4px rgba(0,0,0,.85);pointer-events:none;">' + escapeHtml(t.tree_id) + '</div>',
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      }),
      interactive: false,
      keyboard: false
    }));
  });
  labelLayer.addTo(state.map);
}

// 🔥 防抖版本（供 moveend 用）
export function scheduleRefreshLabels(){
  clearTimeout(_labelTimer);
  _labelTimer = setTimeout(refreshLabels, 120);
}

// 🔥 [防閃爍] 記錄上次繪製範圍／key／zoom
let lastDrawBounds = null;
let lastDrawKey = '';
let lastDrawZoom = null;

function drawKey() {
  return String(state.curProject) + '|' +
    (statusFilter ? Array.from(statusFilter).slice().sort().join(',') : 'all');
}

// 🔥 [手機修復] popup 開啟後自動平移，確保完整入視野（唔出界）
export function ensurePopupFullyVisible(marker) {
  const map = state.map;
  const popup = marker && marker.getPopup ? marker.getPopup() : null;
  if (!map || !popup) return;
  setTimeout(function () {
    if (popup.isOpen && !popup.isOpen()) return;
    const el = popup.getElement();
    if (!el) return;
    const wrap = el.querySelector('.leaflet-popup-content-wrapper') || el;
    const h = wrap.offsetHeight || 300;
    const w = wrap.offsetWidth || 300;
    const ll = marker.getLatLng();
    const sideNeed = Math.round(w / 2) + 16;
    const topNeed = h + 24;
    const bottomNeed = 64;
    if (typeof map.panInside === 'function') {
      map.panInside(ll, {
        paddingTopLeft: L.point(sideNeed, topNeed),
        paddingBottomRight: L.point(sideNeed, bottomNeed),
        animate: true, duration: 0.25
      });
      return;
    }
    // fallback（舊 Leaflet）：手動 panBy
    const pt = map.latLngToContainerPoint(ll);
    const size = map.getSize();
    let sx = 0, sy = 0;
    if (pt.y < topNeed) sy = topNeed - pt.y;
    else if (pt.y > size.y - bottomNeed) sy = (size.y - bottomNeed) - pt.y;
    if (pt.x < sideNeed) sx = sideNeed - pt.x;
    else if (pt.x > size.x - sideNeed) sx = (size.x - sideNeed) - pt.x;
    if (sx || sy) map.panBy([-sx, -sy], { animate: true, duration: 0.25 });
  }, 80);
}

function makeMarker(t) {
  const color = t._color || Config.TREE_STATUS_COLORS[t.status] || Config.TREE_STATUS_COLORS.Unknown;

  // MarkerCluster 的 zoom 動畫只處理 L.Marker icon；使用固定尺寸 DivIcon，
  // 避免 L.CircleMarker 的 Canvas／Path 在 NFC flyTo 高倍 zoom 時產生放大殘影。
  const marker = L.marker([+t.lat, +t.lng], {
    icon: L.divIcon({
      className: 'tree-status-marker',
      html: '<span class="tree-status-dot" style="background-color:' + color + ';" aria-hidden="true"></span>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      popupAnchor: [0, -9]
    }),
    keyboard: false,
    title: String(t.tree_id)
  });
  marker._originalPos = [+t.lat, +t.lng];
  marker._treeId = String(t.tree_id);
  marker.on('click', function () {
    bringTreeToFront(marker);
  });
  marker.bindPopup('<div style="text-align:center;padding:10px;color:#666;">載入中...</div>', { autoPan: false });
  marker.on('popupopen', function (e) {
    const originalHk = toHK80(+t.lat, +t.lng);
    const popupHtml =
      '<b>' + escapeHtml(t.tree_id) + ' ' + escapeHtml(t.name) + '</b><br>' +
      '<b>Status:</b> <span style="color:' + color + ';font-weight:bold;">' + escapeHtml(t.status) + '</span><br>' +
      '<b>Tree Height:</b> ' + escapeHtml(t.tree_height || t.height || '-') + ' m | <b>DBH:</b> ' + escapeHtml(t.dbh || '-') + ' m<br>' +
      '<b>Crown Width:</b> ' + escapeHtml(t.crown_width || t.spread || '-') + ' m | <b>Level:</b> ' + escapeHtml(t.level || '-') + ' m<br>' +
      '<b>Ground Dia.:</b> ' + escapeHtml(t.ground_diameter || '-') + ' m | <b>Stem Length:</b> ' + escapeHtml(t.stem_length || '-') + ' m<br>' +
      '<b>Crown Area:</b> ' + escapeHtml(t.crown_area || '-') + ' ㎡ | <b>Crown Vol.:</b> ' + escapeHtml(t.crown_volume || '-') + ' m³<br>' +
      (originalHk ? '<b>HK80：</b>N ' + format1(originalHk.N) + ' / E ' + format1(originalHk.E) + '<br>' : '') +
      ((t.photo_url && String(t.photo_url).indexOf('...') === -1) ? '<img class="popup-img" src="' + escapeHtml(t.photo_url) + '" style="width:100%;height:auto;max-height:280px;object-fit:contain;display:block;margin:6px auto 0;border-radius:6px;background:rgba(128,128,128,.12);"><br>' : '') +
      '<a href="t.html?id=' + encodeURIComponent(t.tree_id) + '&prj=' + encodeURIComponent(t.project_id || '') + '">📋 樹木頁（巡查／簽到）</a>';
    e.popup.setContent(sanitizeHtml(popupHtml));
    // 🔥 [手機修復 C] 用戶主動開啟時，出界就自動 pan 入視野；silent 重開唔 pan
    if (!state.map.getContainer().classList.contains('popup-silent-reopen')) {
      ensurePopupFullyVisible(marker);
    }
    // 圖片載入後再校正一次（同樣受 silent 壓制）
    setTimeout(() => {
      try {
        const el = e.popup.getElement();
        if (el) {
          const img = el.querySelector('img.popup-img');
          if (img && !img.complete) {
            img.addEventListener('load', () => {
              if (e.popup && e.popup._map) { e.popup.update(); if (!state.map.getContainer().classList.contains('popup-silent-reopen')) ensurePopupFullyVisible(marker); }
            });
          } else if (e.popup && e.popup._map) {
            e.popup.update();
            if (!state.map.getContainer().classList.contains('popup-silent-reopen')) ensurePopupFullyVisible(marker);
          }
        }
      } catch (err) { /* intentionally ignored: optional fallback failure */ }
    }, 50);
  });
  return marker;
}

/* =========================================================
 * 樹木標記（固定尺寸 Marker 版）
 * ========================================================= */
export function drawTrees(silent) {
  const startTime = performance.now();
  const key = drawKey();
  const zoom = state.map ? state.map.getZoom() : null;
  // 🔥 [修復] 只記錄重繪開始時真正開啟的 popup；手動關閉後不會因重繪再開。
  let openTreeId = null;
  if (state.map && state.map._popup && state.map._popup.isOpen()) {
    const popupSource = state.map._popup._source;
    openTreeId = popupSource && popupSource._treeId ? String(popupSource._treeId) : null;
  }

  // 🔥 [防閃爍 A] 視窗仍喺上次繪製範圍內＋zoom／key 不變 → silent 直接 skip
  if (silent && state.map && lastDrawBounds && key === lastDrawKey &&
      zoom === lastDrawZoom && lastDrawBounds.contains(state.map.getBounds())) {
    return;
  }

  if (!state.curProject) {
    state.treeLayer.clearLayers();
    state.treesCache.clear();
    lastDrawBounds = null; lastDrawKey = key; lastDrawZoom = zoom;
    if (!silent) updateStatus('👉 請先選擇地盤，即可查看樹木');
    refreshLabels();
    return;
  }

  const allTrees = state.treeSearchIndex.get(state.curProject) || [];
  const filterFn = statusFilter ? (t) => statusFilter.has(t.status) : null;
  let viewBounds = null;
  if (state.map) viewBounds = state.map.getBounds().pad(BOUNDS_PADDING);

  // 🔥 空間索引視口查詢替代線性掃描
  let visible;
  if (viewBounds) visible = querySpatialIndex(state.curProject, viewBounds, filterFn);
  else {
    const list = currentTrees();
    visible = list.slice();
  }

  // 🔥 [手機修復 A] 可見樹集合＋zoom 冇變 → silent 直接 skip
  // 🔥 [Bugfix] 用 Set 比較取代巨型字串拼接，避免每次 moveend 產生數 KB 字串
  const zNow = state.map ? state.map.getZoom() : null;
  let visChanged = true;
  if (silent && state.treesCache.size) {
    if (_lastSilentZoom === zNow && _lastSilentSet && _lastSilentSet.size === visible.length) {
      visChanged = false;
      for (let _i = 0; _i < visible.length; _i++) {
        if (!_lastSilentSet.has(String(visible[_i].tree_id))) { visChanged = true; break; }
      }
    }
    if (!visChanged) return;
  }

  if (silent) {
    // 🔥 [防閃爍 B] 增量差量：只移除離開視窗嘅 marker、只加新入視窗嘅；
    // 開住 popup 嘅 marker 只要仍喺視窗就完全唔郁 → 零閃爍
    const desired = new Set(visible.map((t) => String(t.tree_id)));
    const seen = new Set();
    state.treesCache.forEach((m) => {
      if (!m || seen.has(m)) return;
      seen.add(m);
      if (!desired.has(m._treeId)) {
        state.treeLayer.removeLayer(m);
        state.treesCache.delete(state.curProject + '_' + m._treeId);
      }
    });
    const toAdd = [];
    visible.forEach((t) => {
      const id = String(t.tree_id);
      if (!state.treesCache.has(state.curProject + '_' + id)) {
        const m = makeMarker(t);
        toAdd.push(m);
        state.treesCache.set(state.curProject + '_' + id, m);
      }
    });
    if (toAdd.length) state.treeLayer.addLayers(toAdd);
  } else {
    // 全量重繪（轉地盤／過濾／資料更新）：保留舊行為
    state.treeLayer.clearLayers();
    state.treesCache.clear();
    const markers = visible.map((t) => {
      const m = makeMarker(t);
      state.treesCache.set(state.curProject + '_' + String(t.tree_id), m);
      return m;
    });
    if (markers.length) state.treeLayer.addLayers(markers);
  }

  lastDrawBounds = viewBounds;
  lastDrawKey = key;
  lastDrawZoom = zoom;

  _lastSilentSet = new Set(visible.map(t => String(t.tree_id)));
  _lastSilentZoom = zNow;

  // 🔥 [手機修復 B] 只為重繪開始時已開啟的 popup 重開；手動關閉的不會重開。
  // 🔥 [NFC修復] 無論 silent/全量重繪都保留已開 popup（避免 NFC flyTo 後 1.2s 二次對帳衝掉彈窗）
  if (openTreeId) {
    // 🔥 cluster addLayers 異步排隊，marker._map 未必即時 ready，輪詢重開
    const _k = state.curProject + '_' + openTreeId;
    const reopen = function (tries) {
      const _m = state.treesCache.get(_k);
      if (_m && _m._map) {
        const container = state.map.getContainer();
        container.classList.add('popup-silent-reopen');
        _m.openPopup();
        setTimeout(function () { container.classList.remove('popup-silent-reopen'); }, 400);
        return;
      }
      if (tries > 0) setTimeout(function () { reopen(tries - 1); }, 100);
    };
    reopen(10);
  }

  state.perfMetrics.totalRenders++;
  state.perfMetrics.renderTime = performance.now() - startTime;

  if (silent) {
    const z = state.map ? state.map.getZoom() : null;
    if (z !== _lastLabelZoom) refreshLabels();
  } else {
    refreshLabels();
  }
  updateLabelBtn();

  if (silent) {
    if (console.debug) console.debug('🎨 增量重繪 ' + visible.length + '/' + allTrees.length + ' 棵（' + state.perfMetrics.renderTime.toFixed(1) + 'ms）');
    return;
  }
  const pname = (state.PROJECTS.find((x) => String(x.project_id) === String(state.curProject)) || {}).name;
  const filterText = statusFilter ? '（已過濾）' : '';
  updateStatus('✅ 地盤：' + pname + '｜顯示 ' + visible.length + '/' + allTrees.length + ' 棵樹' + filterText);
}
