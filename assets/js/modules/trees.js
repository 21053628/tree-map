/**
 * 樹木標記與 popup 模組
 * v4.0 - 更新欄位名稱（Step 4：DBH/Height/Spread 改名 + 新增欄位）
 */
import { state } from './state.js';
import { updateStatus } from './dom.js';

export function drawTrees() {
  const startTime = performance.now();
  state.treeLayer.clearLayers();

  if (!state.curProject) {
    updateStatus('👉 請先選擇地盤，即可查看樹木');
    return;
  }

  const list = state.treeSearchIndex.get(state.curProject) || [];
  const markers = [];

  list.forEach((t) => {
    const lat = +t.lat;
    const lng = +t.lng;
    const color = Config.TREE_STATUS_COLORS[t.status] || Config.TREE_STATUS_COLORS.Unknown;

    const html = '<div style="width:16px;height:16px;border-radius:50%;background:' + color + ';border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45);cursor:pointer;"></div>';

    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: '',
        html: html,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        popupAnchor: [0, -10]
      })
    });

    marker._originalPos = [lat, lng];

    marker.on('click', function () {
      state.treesCache.forEach((m) => {
        if (m !== marker) m.setZIndexOffset(0);
      });
      marker.setZIndexOffset(2000);
    });

    marker.bindPopup('<div style="text-align:center;padding:10px;color:#666;">載入中...</div>');

    marker.on('popupopen', function (e) {
      const originalHk = CoordUtils.toHK80(+t.lat, +t.lng);
      
      // 🔥 [v4.0] 更新 popup 欄位（向後相容：舊 height/spread 都會顯示）
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

  const pname = (state.PROJECTS.find((x) => String(x.project_id) === String(state.curProject)) || {}).name;
  updateStatus('✅ 地盤：' + pname + '｜顯示 ' + list.length + ' 棵樹');
}