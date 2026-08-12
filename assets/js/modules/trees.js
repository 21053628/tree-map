/**
 * 樹木標記與 popup 模組
 * v4.2 - 新增樹木編號標籤：A) zoom>=19 自動顯示 + B) 手動 🔢 開關
 * v4.1 - L.circleMarker + Canvas 渲染，2000 棵樹 0 延遲
 */
import { state } from './state.js';
import { updateStatus } from './dom.js';

/* =========================================================
 * 🔥 [v4.2] 樹木編號標籤系統（性能保護版）
 * ========================================================= */
const LABEL_MIN_ZOOM = 19;      // 自動顯示嘅最低 zoom
const LABEL_MAX_COUNT = 400;    // 可見標籤上限，超過即跳過（防 DOM 爆炸）
let labelsAuto = true;          // A：高 zoom 自動顯示
let labelsForced = false;       // B：手動強制顯示
let labelLayer = null;
let _labelTimer = null;

function escapeHtml(str){
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function labelsShouldShow(){
  return labelsForced || (labelsAuto && state.map && state.map.getZoom() >= LABEL_MIN_ZOOM);
}

// 🔥 B：手動開關（layer bar 🔢 ）
export function toggleTreeLabels(){
  labelsForced = !labelsForced;
  const btn = document.querySelector('.layerbar button[data-l="labels"]');
  if (btn) btn.classList.toggle('on', labelsForced);
  refreshLabels();
  if (labelsForced && !labelLayer && state.curProject) {
    updateStatus('⚠️ 可見樹木太多，請放大先顯示編號');
  } else {
    updateStatus(labelsForced ? '✅ 樹木編號：恆常顯示' : '✅ 樹木編號：自動（放大顯示）');
  }
}

// 🔥 重建標籤層（只渲染可見範圍，性能保護）
export function refreshLabels(){
  if (!state.map) return;
  if (labelLayer) { state.map.removeLayer(labelLayer); labelLayer = null; }
  if (!labelsShouldShow() || !state.curProject) return;

  const bounds = state.map.getBounds();
  const list = state.treeSearchIndex.get(state.curProject) || [];
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

// 🔥 防抖版本（俾 moveend 用，避免拖圖狂重建）
export function scheduleRefreshLabels(){
  clearTimeout(_labelTimer);
  _labelTimer = setTimeout(refreshLabels, 120);
}

/* =========================================================
 * 樹木標記（v4.1 Canvas 版）
 * ========================================================= */
export function drawTrees() {
  const startTime = performance.now();
  state.treeLayer.clearLayers();

  if (!state.curProject) {
    updateStatus('👉 請先選擇地盤，即可查看樹木');
    refreshLabels(); // 🔥 [v4.2] 清埋標籤
    return;
  }

  const list = state.treeSearchIndex.get(state.curProject) || [];
  const markers = [];

  list.forEach((t) => {
    const lat = +t.lat;
    const lng = +t.lng;
    if (!lat || !lng) return;

    const color = Config.TREE_STATUS_COLORS[t.status] || Config.TREE_STATUS_COLORS.Unknown;

    const marker = L.circleMarker([lat, lng], {
      radius: 7,
      fillColor: color,
      color: '#fff',
      weight: 2.5,
      opacity: 1,
      fillOpacity: 1
    });

    marker._originalPos = [lat, lng];

    marker.setZIndexOffset = function(z) {
      if (z > 0 && this.bringToFront) this.bringToFront();
      return this;
    };

    marker.on('click', function () {
      marker.bringToFront();
    });

    marker.bindPopup('<div style="text-align:center;padding:10px;color:#666;">載入中...</div>');

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

  state.perfMetrics.totalRenders++;
  state.perfMetrics.renderTime = performance.now() - startTime;

  refreshLabels(); // 🔥 [v4.2] 數據變咗，標籤跟住重建

  const pname = (state.PROJECTS.find((x) => String(x.project_id) === String(state.curProject)) || {}).name;
  updateStatus('✅ 地盤：' + pname + '｜顯示 ' + list.length + ' 棵樹（耗時 ' + state.perfMetrics.renderTime.toFixed(1) + 'ms）');
}