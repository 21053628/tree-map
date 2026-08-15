/**
 * 樹木標記與 popup 模組
 * v4.4 - 加入狀態過濾（配合 filters.js）
 * v4.3 - 🔢 掣升級做三模式循環：智能(默認) → 恆常 → 關閉 → 智能…
 * v4.2 - 樹木編號標籤系統
 * v4.1 - L.circleMarker + Canvas 渲染
 */
import { state } from './state.js';
import { updateStatus, escapeHtml } from './dom.js';

/* =========================================================
 * 🔥 [C2] 共用 Canvas renderer（全 App 只建立一次，所有 circleMarker 共用）
 * ========================================================= */
let canvasRenderer = null;
function getCanvasRenderer() {
  if (!canvasRenderer) {
    canvasRenderer = L.canvas({ padding: 0.5, tolerance: 3 });
  }
  return canvasRenderer;
}

// 🔥 [C1] 可視範圍邊距（0.3 個視窗，避免拖動邊緣樹突然出現/消失）
const BOUNDS_PADDING = 0.3;

// 🔥 [Phase1] 單一渲染排程器（供 moveend 使用）：合併原先「重繪 + 標籤」兩個獨立 debounce，
// 避免每次平移地圖觸發多輪全量重繪與 DOM 重建。
let _redrawTimer = null;
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

// 🔥 修正：不再覆寫 Leaflet 原生 setZIndexOffset，改用獨立的 bringToFront helper
export function bringTreeToFront(marker) {
  if (marker && marker.bringToFront) marker.bringToFront();
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
let _lastLabelZoom = null; // 🔥 記錄上次 label 刷新時嘅 zoom，平移時唔重建 label

function labelsShouldShow(){
  if (labelMode === 'on') return true;
  if (labelMode === 'off') return false;
  return !!(state.map && state.map.getZoom() >= LABEL_MIN_ZOOM); // auto
}

// 🔥 按鈕外觀跟住模式變
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
  btn.title = labelMode === 'on' ? '樹木編號：恆常顯示（撳切換）'
        : labelMode === 'off' ? '樹木編號：關閉（撳切換）'
        : '樹木編號：智能（撳切換）';
}

// 🔥 三模式循環（map.js 嘅 🔢 掣 call 呢個）
export function toggleTreeLabels(){
  labelMode = labelMode === 'auto' ? 'on' : (labelMode === 'on' ? 'off' : 'auto');
  updateLabelBtn();
  refreshLabels();
  if (labelMode === 'on' && !labelLayer && state.curProject) {
    updateStatus('⚠️ 可見樹木太多，請放大先顯示編號');
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
  const list = currentTrees(); // 🔥 [v4.4] 使用過濾後嘅樹木
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

// 🔥 防抖版本（俾 moveend 用）
export function scheduleRefreshLabels(){
  clearTimeout(_labelTimer);
  _labelTimer = setTimeout(refreshLabels, 120);
}

/* =========================================================
 * 樹木標記（v4.1 Canvas 版）
 * ========================================================= */
export function drawTrees(silent) {
  const startTime = performance.now();

  // 🔥 拖動地圖重繪前，記低目前開緊嘅樹木 popup 編號，等重繪完可以重新開返
  let openTreeId = null;
  if (state.map && state.map._popup && state.map._popup.isOpen() && state.map._popup._source && state.map._popup._source._treeId != null) {
    openTreeId = String(state.map._popup._source._treeId);
  }

  state.treeLayer.clearLayers();
  // 🔥 修正：每次重繪前清空 marker 快取，避免舊 marker 殘留造成記憶體累積與誤定位
  state.treesCache.clear();

  if (!state.curProject) {
    if (!silent) updateStatus('👉 請先選擇地盤，即可查看樹木');
    refreshLabels();
    return;
  }

  const allTrees = state.treeSearchIndex.get(state.curProject) || [];
  const list = currentTrees(); // 🔥 [v4.4] 使用過濾後嘅樹木

  // 🔥 [C1] 只渲染可視範圍內嘅樹（含邊距）
  let viewBounds = null;
  if (state.map) {
    viewBounds = state.map.getBounds().pad(BOUNDS_PADDING);
  }
  const renderer = getCanvasRenderer(); // 🔥 [C2] 共用 Canvas renderer

  const markers = [];

  list.forEach((t) => {
    const lat = t.lat;
    const lng = t.lng;
    if (!lat || !lng) return;

    // 🔥 [C1] 可視範圍外（超過邊距）直接跳過，不建立 marker
    if (viewBounds && !viewBounds.contains([lat, lng])) return;

    // 🔥 [Phase1] 使用 applyData 預存的顏色（避免每幀重查色表）
    const color = t._color || Config.TREE_STATUS_COLORS[t.status] || Config.TREE_STATUS_COLORS.Unknown;

    const marker = L.circleMarker([lat, lng], {
      radius: 7,
      fillColor: color,
      color: '#fff',
      weight: 2.5,
      opacity: 1,
      fillOpacity: 1,
      renderer: renderer // 🔥 [C2] 指定 Canvas renderer
    });

    marker._originalPos = [lat, lng];
    marker._treeId = String(t.tree_id);

    marker.on('click', function () {
      marker.bringToFront();
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
        ((t.photo_url && String(t.photo_url).indexOf('...') === -1) ? '<img class="popup-img" src="' + t.photo_url + '" style="width:100%;height:200px;object-fit:cover;display:block;margin:6px auto 0;border-radius:6px;"><br>' : '') +
        '<a href="t.html?id=' + encodeURIComponent(t.tree_id) + '&prj=' + encodeURIComponent(t.project_id || '') + '">📋 樹木頁（巡查／簽到）</a>';

      e.popup.setContent(DOMPurify.sanitize(popupHtml));

      setTimeout(() => {
        try {
          const el = e.popup.getElement();
          if (el) {
            const img = el.querySelector('img.popup-img');
            if (img && !img.complete) {
              img.addEventListener('load', () => {
                if (e.popup && e.popup._map) e.popup.update();
              });
            } else if (e.popup && e.popup._map) {
              e.popup.update();
            }
          }
        } catch (err) { }
      }, 50);
    });

    markers.push(marker);
    state.treesCache.set(state.curProject + '_' + t.tree_id, marker);
    state.treesCache.set(t.tree_id, marker);
  });

  if (markers.length > 0) {
    state.treeLayer.addLayers(markers);
  }

  // 🔥 拖動重繪後重新開返先前開緊嘅樹木 popup（保留「移動唔關視窗」行為）
  if (silent && openTreeId) {
    const key = state.curProject + '_' + openTreeId;
    const m = state.treesCache.get(key) || state.treesCache.get(openTreeId);
    if (m) m.openPopup();
  }

  state.perfMetrics.totalRenders++;
  state.perfMetrics.renderTime = performance.now() - startTime;

  // 🔥 [優化] 平移重繪（silent）唔重建 label（Leaflet 會自動跟住移動），
  // 只有 zoom 變化（或非 silent 的全量重繪）先至重建，避免重複 DOM 操作
  if (silent) {
    const z = state.map ? state.map.getZoom() : null;
    if (z !== _lastLabelZoom) refreshLabels();
  } else {
    refreshLabels();
  }
  updateLabelBtn(); 

  // 🔥 [Phase1] 平移地圖觸發的 silent 重繪不再刷狀態列（避免 MutationObserver 動畫與樣式切換）
  if (silent) {
    if (console.debug) console.debug('🎨 重繪 ' + markers.length + '/' + allTrees.length + ' 棵（' + state.perfMetrics.renderTime.toFixed(1) + 'ms）');
    return;
  }
  const pname = (state.PROJECTS.find((x) => String(x.project_id) === String(state.curProject)) || {}).name;
  // 🔥 [v4.4] 狀態列顯示過濾對比（例如：顯示 12/50 棵樹（已過濾））
  const filterText = statusFilter ? '（已過濾）' : '';
  updateStatus('✅ 地盤：' + pname + '｜顯示 ' + markers.length + '/' + allTrees.length + ' 棵樹' + filterText);
}
