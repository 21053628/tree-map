/**
 * 樹木標記與 popup 模組
 * v4.4 - 加入狀態過濾（配合 filters.js）
 * v4.3 - 🔢 按鈕升級做三模式循環：智能(默認) → 恆常 → 關閉 → 智能…
 * v4.2 - 樹木編號標籤系統
 * v4.1 - 固定尺寸狀態 marker，配合 MarkerCluster 穩定縮放渲染
 * v4.5 - 🔥 [防閃爍] silent 增量差量 + 自動平移 ensurePopupInViewport(panInside)
 */
import { state } from './state.js';
import { updateStatus, escapeHtml } from './dom.js';

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
let _lastSilentKey = '';
export function scheduleRedraw() {
  clearTimeout(_redrawTimer);
  _redrawTimer = setTimeout(() => drawTrees(true), 150);
}

/* =========================================================
 * 🔥 [v4.4] 狀態過濾（null = 全部顯示）
 * ========================================================= */
let statusFilter = null;

export function setStatusFilter(set) {
  statusFilter = (set && set.size) ? set : null;
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
  return statusFilter ? list.filter((t) => statusFilter.has(t.status)) : list;
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
  if (labelMode === 'off') {
    btn.style.opacity = '0.45';
    btn.style.filter = 'grayscale(1)';
  } else {
    btn.style.opacity = '';
    btn.style.filter = '';
  }
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

// 🔥 重建標籤層（只渲染可見範圍，性能保護）
export function refreshLabels(){
  if (!state.map) return;
  _lastLabelZoom = state.map.getZoom(); // 🔥 記錄當前 zoom
  if (labelLayer) { state.map.removeLayer(labelLayer); labelLayer = null; }
  if (!labelsShouldShow() || !state.curProject) return;

  const bounds = state.map.getBounds();
  const list = currentTrees(); // 🔥 [v4.4] 使用過濾後的樹木
  const visible = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const lat = +t.lat, lng = +t.lng;
    if (lat && lng && bounds.contains([lat, lng])) {
      visible.push(t);
      if (visible.length > LABEL_MAX_COUNT) break;
    }
  }
  if (!visible.length || visible.length > LABEL_MAX_COUNT) return;

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
let silentReopen = false;

function drawKey() {
  return String(state.curProject) + '|' +
    (statusFilter ? Array.from(statusFilter).slice().sort().join(',') : 'all');
}

// 🔥 [自動平移] 令 popup 完整進入視野（只平移，唔改 zoom）- 舊版兼容保留
function ensurePopupInViewport(popup) {
  const map = state.map;
  const el = popup && popup.getElement ? popup.getElement() : null;
  if (!map || !el || typeof map.panInside !== 'function') return;
  const wrap = el.querySelector('.leaflet-popup-content-wrapper') || el;
  const w = wrap.offsetWidth || 320;
  const h = wrap.offsetHeight || 320;
  const half = Math.round(w / 2) + 12;
  map.panInside(popup.getLatLng(), {
    paddingTopLeft: L.point(half, h + 20),      // popup 喺 marker 上方向上延伸
    paddingBottomRight: L.point(half, 48),      // marker 下方留 tip 空間
    animate: true,
    duration: 0.25
  });
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
    const originalHk = CoordUtils.toHK80(+t.lat, +t.lng);
    const popupHtml =
      '<b>' + t.tree_id + ' ' + t.name + '</b><br>' +
      '<b>Status:</b> <span style="color:' + color + ';font-weight:bold;">' + t.status + '</span><br>' +
      '<b>Tree Height:</b> ' + (t.tree_height || t.height || '-') + ' m | <b>DBH:</b> ' + (t.dbh || '-') + ' m<br>' +
      '<b>Crown Width:</b> ' + (t.crown_width || t.spread || '-') + ' m | <b>Level:</b> ' + (t.level || '-') + ' m<br>' +
      '<b>Ground Dia.:</b> ' + (t.ground_diameter || '-') + ' m | <b>Stem Length:</b> ' + (t.stem_length || '-') + ' m<br>' +
      '<b>Crown Area:</b> ' + (t.crown_area || '-') + ' ㎡ | <b>Crown Vol.:</b> ' + (t.crown_volume || '-') + ' m³<br>' +
      (originalHk ? '<b>HK80：</b>N ' + CoordUtils.format1(originalHk.N) + ' / E ' + CoordUtils.format1(originalHk.E) + '<br>' : '') +
      ((t.photo_url && String(t.photo_url).indexOf('...') === -1) ? '<img class="popup-img" src="' + t.photo_url + '" style="width:100%;height:auto;max-height:280px;object-fit:contain;display:block;margin:6px auto 0;border-radius:6px;background:rgba(128,128,128,.12);"><br>' : '') +
      '<a href="t.html?id=' + encodeURIComponent(t.tree_id) + '&prj=' + encodeURIComponent(t.project_id || '') + '">📋 樹木頁（巡查／簽到）</a>';
    e.popup.setContent(DOMPurify.sanitize(popupHtml));
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
      } catch (err) { }
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
  const list = currentTrees();
  let viewBounds = null;
  if (state.map) viewBounds = state.map.getBounds().pad(BOUNDS_PADDING);

  // 🔥 [手機修復 A] 可見樹集合＋zoom 冇變 → silent 直接 skip，唔掂 layers/popup
  const zNow = state.map ? state.map.getZoom() : null;
  let visKey = '';
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.lat && t.lng && (!viewBounds || viewBounds.contains([t.lat, t.lng]))) {
      visKey += t.tree_id + ',';
    }
  }
  visKey = zNow + '|' + visKey;
  if (silent && state.treesCache.size && visKey === _lastSilentKey) {
    return;
  }

  const visible = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t.lat || !t.lng) continue;
    if (viewBounds && !viewBounds.contains([+t.lat, +t.lng])) continue;
    visible.push(t);
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
        state.treesCache.delete(m._treeId);
      }
    });
    const toAdd = [];
    visible.forEach((t) => {
      const id = String(t.tree_id);
      if (!state.treesCache.has(state.curProject + '_' + id)) {
        const m = makeMarker(t);
        toAdd.push(m);
        state.treesCache.set(state.curProject + '_' + id, m);
        state.treesCache.set(id, m);
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
      state.treesCache.set(String(t.tree_id), m);
      return m;
    });
    if (markers.length) state.treeLayer.addLayers(markers);
  }

  lastDrawBounds = viewBounds;
  lastDrawKey = key;
  lastDrawZoom = zoom;

  _lastSilentKey = visKey;

  // 🔥 [手機修復 B] 只為重繪開始時已開啟的 popup 重開；手動關閉的不會重開。
  if (silent && openTreeId) {
    // 🔥 cluster addLayers 異步排隊，marker._map 未必即時 ready，輪詢重開
    const _k = state.curProject + '_' + openTreeId;
    const reopen = function (tries) {
      const _m = state.treesCache.get(_k) || state.treesCache.get(openTreeId);
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
