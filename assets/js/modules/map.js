/**
 * 地圖初始化模組
 * v2.62 - 整理手機版底圖控制：政府／官航／地段／航拍統一收納於 Layer FAB
 * v2.52 - 加入 🎚 狀態過濾按鈕（配合 filters.js）
 * v2.51 - 抽屜加入「建立地盤／新增樹木」動作按鈕
 * v2.50 - 手機版 layer bar 變身 FAB 抽屜
 */
import { state } from './state.js';
import { updateStatus, closePanel } from './dom.js';
import { hideSearch } from './search.js';
import { toggleLotLayer } from './lots.js';
import { toggleTreeLabels, scheduleRedraw } from './trees.js';
import { toggleFilterPanel, closeFilterPanel } from './filters.js'; // 🔥 [v2.52]
import { startMeasure, cancelInteraction, clearAllDrawings, getMode as getDrawMode } from './draw.js'; // 🔥 [Phase1]
import { toggleGeolocation, locateOnce } from './geolocate.js'; // 🔥 [Phase1]
import { on } from '../core/event-bus.js'; // 🔥 [Phase4] 訂閱 project:selected 以觸發航拍圖刷新

// 🔥 layers 圖示（filter 按鈕用，清楚表示「分層」）
const LAYERS_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"/></svg>';

export function initMap() {
  if (!window.L) {
    updateStatus('❌ 地圖元件載入失敗：請檢查網路後重新整理');
    return false;
  }

  const isMobile = window.matchMedia('(max-width: 600px)').matches ||
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  const mapOptions = {
    zoomControl: !isMobile,
    attributionControl: true,
    zoomAnimation: !isMobile,
    fadeAnimation: !isMobile,
    markerZoomAnimation: !isMobile,
    tap: isTouch,
    tapTolerance: 15,
    preferCanvas: true
  };

  state.map = L.map('map', mapOptions).setView(Config.MAP.DEFAULT_CENTER, Config.MAP.DEFAULT_ZOOM);

  if (isMobile) {
    // 🔥 GPS 定位按鈕（放在縮放 +/− 按鈕上面，一按定位自己）
    const geoCtrl = L.control({ position: 'topleft' });
    geoCtrl.onAdd = function () {
      const bar = L.DomUtil.create('div', 'leaflet-bar geo-locate-bar');
      const a = L.DomUtil.create('a', '', bar);
      a.href = '#';
      a.title = '定位到我的位置';
      a.setAttribute('role', 'button');
      a.setAttribute('aria-label', '定位到我的位置');
      a.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/></svg>';
      L.DomEvent.on(a, 'click', function (e) {
        L.DomEvent.preventDefault(e);
        locateOnce();
      });
      L.DomEvent.disableClickPropagation(a);
      return bar;
    };
    geoCtrl.addTo(state.map);

    L.control.zoom({
      position: 'topleft',
      zoomInText: '+',
      zoomOutText: '−',
      zoomInTitle: '放大',
      zoomOutTitle: '縮小'
    }).addTo(state.map);
  }

  if (!state.map.getPane('aerialPane')) {
    const aerialPane = state.map.createPane('aerialPane');
    aerialPane.style.zIndex = 250;
  }

  // 🔥 [修復] 地段專用 pane：z-index 350 低於 overlayPane(400)，
  // 確保樹木 Canvas（400）在上層可被點擊，地段 SVG 在下層不遮擋
  if (!state.map.getPane('lotPane')) {
    const lotPane = state.map.createPane('lotPane');
    lotPane.style.zIndex = 350;
  }

  state.baseLayers = {
    hk: L.layerGroup([
      L.tileLayer('https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/wgs84/{z}/{x}/{y}.png',
        { attribution: '© 地政總署 LandsD HKSAR', maxNativeZoom: 19, maxZoom: Config.MAP.MAX_ZOOM }),
      L.tileLayer('https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/tc/wgs84/{z}/{x}/{y}.png',
        { maxNativeZoom: 19, maxZoom: Config.MAP.MAX_ZOOM })
    ]),
    sat: L.tileLayer('https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/imagery/WGS84/{z}/{x}/{y}.png', {
      attribution: 'Aerial Photograph from Lands Department',
      maxNativeZoom: 20,
      maxZoom: Config.MAP.MAX_ZOOM
    })
  };

  state.baseLayers.hk.addTo(state.map);
  state.currentBaseLayer = state.baseLayers.hk;

  // 🔥 [Phase1] 比例尺
  L.control.scale({ imperial: false, metric: true, position: 'bottomleft', maxWidth: 130 }).addTo(state.map);

  function toggleMeasureLine() {
    if (getDrawMode() === 'line') { cancelInteraction(); return; }
    startMeasure('line');
  }
  function toggleMeasureArea() {
    if (getDrawMode() === 'area') { cancelInteraction(); return; }
    startMeasure('area');
  }
  // 🔥 全螢幕＋三個 GIS 工具（電腦版 icon bar，垂直排列在縮放按鈕下面）
  const gisCtrl = L.control({ position: 'topleft' });
  gisCtrl.onAdd = function () {
    const div = L.DomUtil.create('div', 'leaflet-bar gis-tools');
    L.DomEvent.disableClickPropagation(div);

    function addBtn(html, title, aria, onClick) {
      const b = L.DomUtil.create('a', 'gis-btn', div);
      b.href = '#';
      b.title = title;
      b.setAttribute('role', 'button');
      b.setAttribute('aria-label', aria);
      b.innerHTML = html;
      L.DomEvent.on(b, 'click', function (e) {
        L.DomEvent.preventDefault(e);
        onClick();
      });
      return b;
    }

    addBtn('⛶', '全螢幕', '切換全螢幕', function () {
      const c = state.map.getContainer();
      if (document.fullscreenElement) { document.exitFullscreen(); }
      else if (c.requestFullscreen) { c.requestFullscreen(); }
    });
    addBtn('📏', '量度距離', '量度距離', toggleMeasureLine);
    addBtn('📐', '量度面積', '量度面積', toggleMeasureArea);
    addBtn('✕', '清除所有量測／繪圖', '清除所有量測／繪圖', clearAllDrawings);

    return div;
  };
  gisCtrl.addTo(state.map);

  state.lotLayer = L.layerGroup();

  let layerWrap = null;
  let closeDrawerFn = null;
  const layerBar = L.control({ position: isMobile ? 'bottomright' : 'bottomleft' });
  layerBar.onAdd = function () {
    layerWrap = L.DomUtil.create('div', 'layerbar-wrap');

    const fab = L.DomUtil.create('button', 'layerbar-fab', layerWrap);
    fab.type = 'button';
    fab.innerHTML = '▲';
    fab.title = '開啟圖層與功能';
    fab.setAttribute('aria-label', '開啟圖層與功能');
    fab.setAttribute('aria-expanded', 'false');
    fab.setAttribute('aria-controls', 'map-layer-drawer');

    const div = L.DomUtil.create('div', 'layerbar', layerWrap);
    div.id = 'map-layer-drawer';
    if (isMobile) {
      // 手機版：底圖切換直接收納在 Layer FAB，避免再點擊一層「圖層」分類。
      div.innerHTML =
        '<button class="drawer-cat" data-cat="tools" aria-expanded="false">📏 測量工具</button>' +
        '<div class="drawer-sub" data-sub="tools">' +
          '<button data-act="measureLine">📏 距離</button>' +
          '<button data-act="measureArea">📐 面積</button>' +
          '<button data-act="clearDrawings">✕ 清除</button>' +
        '</div>' +
        '<div class="drawer-sep"></div>' +
        '<button class="drawer-cat" data-cat="layers" aria-expanded="false">🗺️ 圖層</button>' +
        '<div class="drawer-sub" data-sub="layers">' +
          '<button data-l="hk" class="on">🏛️ 政府</button>' +
          '<button data-l="sat">🛰️ 衛星</button>' +
          '<button data-l="lot">🗺️ 地段索引</button>' +
          '<button data-l="aerial">📷 航拍</button>' +
        '</div>' +
        '<div class="drawer-sep"></div>' +
        '<button data-l="filter">' + LAYERS_ICON + ' 篩選</button>' +
        '<button data-l="labels">🔢 樹木數字顯示</button>' +
        '<button data-act="sync">☁️ 同步 <span class="drawer-sync-badge" aria-hidden="true">●</span></button>';
    } else {
      div.innerHTML =
        '<button data-act="addProject" class="drawer-action act-project">＋ 建立地盤</button>' +
        '<button data-act="addTree" class="drawer-action act-tree">🌳 新增樹木</button>' +
        '<div class="drawer-sep sep-tools"></div>' +
        '<button data-act="measureLine">📏 距離</button>' +
        '<button data-act="measureArea">📐 面積</button>' +
        '<button data-act="locate">📍 定位</button>' +
        '<button data-act="clearDrawings">✕ 清除</button>' +
        '<div class="drawer-sep"></div>' +
        '<button data-l="hk" class="on">政府</button>' +
        '<button data-l="sat">官航</button>' +
        '<button data-l="labels">🔢</button>' +
        '<button data-l="filter">' + LAYERS_ICON + ' 篩選</button>' +   // 🔥 [v2.52] 狀態過濾按鈕
        '<button data-l="lot">🗺️ 地段</button>' +
        '<button data-l="aerial">🛰 航拍</button>';
    }

    L.DomEvent.disableClickPropagation(layerWrap);

    function setDrawerOpen(open) {
      layerWrap.classList.toggle('open', open);
      fab.innerHTML = open ? '✕' : '▲';
      fab.setAttribute('aria-expanded', String(open));
    }

    function closeDrawer() {
      setDrawerOpen(false);
    }
    closeDrawerFn = closeDrawer;

    // FAB 同時位於 Leaflet 控制列及可觸控地圖上方；使用 pointerup
    // 處理觸控，並抑制瀏覽器隨後合成的 click，避免一次點擊被開關兩次。
    let suppressFabClickUntil = 0;
    function toggleDrawer(event) {
      if (event) {
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
      }
      setDrawerOpen(!layerWrap.classList.contains('open'));
    }

    function handleFabPointerUp(event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      suppressFabClickUntil = Date.now() + 500;
      toggleDrawer(event);
    }

    function handleFabTouchEnd(event) {
      suppressFabClickUntil = Date.now() + 500;
      toggleDrawer(event);
    }

    function handleFabClick(event) {
      if (Date.now() < suppressFabClickUntil) {
        suppressFabClickUntil = 0;
        if (event.cancelable) event.preventDefault();
        event.stopPropagation();
        return;
      }
      toggleDrawer(event);
    }

    if (window.PointerEvent) {
      fab.addEventListener('pointerup', handleFabPointerUp);
    } else {
      fab.addEventListener('touchend', handleFabTouchEnd, { passive: false });
    }
    fab.addEventListener('click', handleFabClick);

    layerWrap.querySelectorAll('.layerbar button').forEach((b) => {
      b.onclick = function () {
        if (b.dataset.cat) {
          const sub = div.querySelector('.drawer-sub[data-sub="' + b.dataset.cat + '"]');
          if (sub) {
            const open = sub.classList.toggle('open');
            b.classList.toggle('open', open);
            b.setAttribute('aria-expanded', String(open));
          }
          return;
        }
        if (b.dataset.act === 'addProject') {
          closeDrawer();
          const rp = document.getElementById('addProjectBtn');
          if (rp) rp.click();
          return;
        }
        if (b.dataset.act === 'addTree') {
          closeDrawer();
          const rt = document.getElementById('addTreeBtn');
          if (!state.curProject) {
            updateStatus('👉 請先選擇地盤，先可以新增樹木');
          } else if (rt) {
            rt.click();
          }
          return;
        }

        if (b.dataset.act === 'sync') {
          closeDrawer();
          const syncBadge = document.getElementById('syncBadge');
          if (syncBadge) {
            syncBadge.click();
          } else {
            updateStatus('☁️ 同步中心尚未就緒');
          }
          return;
        }
        if (b.dataset.act === 'measureLine') {
          closeDrawer();
          if (getDrawMode() === 'line') { cancelInteraction(); return; }
          startMeasure('line');
          return;
        }
        if (b.dataset.act === 'measureArea') {
          closeDrawer();
          if (getDrawMode() === 'area') { cancelInteraction(); return; }
          startMeasure('area');
          return;
        }
        if (b.dataset.act === 'locate') {
          closeDrawer();
          toggleGeolocation(b);
          return;
        }
        if (b.dataset.act === 'clearDrawings') {
          closeDrawer();
          clearAllDrawings();
          return;
        }

        const layerType = b.dataset.l;
        if (layerType === 'lot') {
          toggleLotLayer();
          if (isMobile) closeDrawer();
        } else if (layerType === 'aerial') {
          toggleAerial();
          if (isMobile) closeDrawer();
        } else if (layerType === 'labels') {
          toggleTreeLabels();
          if (isMobile) closeDrawer();
        } else if (layerType === 'filter') {
          // 🔥 [v2.52] 按 filter 按鈕：收起抽屜，彈出 filter 面板
          if (layerWrap && layerWrap.classList.contains('open')) closeDrawer();
          toggleFilterPanel(b);
        } else {
          if (state.currentBaseLayer) state.map.removeLayer(state.currentBaseLayer);
          state.currentBaseLayer = state.baseLayers[layerType];
          state.currentBaseLayer.addTo(state.map);
          div.querySelectorAll('button[data-l="hk"], button[data-l="sat"]')
            .forEach((x) => { x.classList.toggle('on', x.dataset.l === layerType); });
          if (isMobile) closeDrawer();
        }
      };
      if (isTouch) {
        b.addEventListener('touchstart', function (e) {
          e.preventDefault();
          b.click();
        }, { passive: false });
      }
    });
    return layerWrap;
  };
  layerBar.addTo(state.map);

  state.map.on('moveend', function () {
    scheduleRedraw();
  });

  state.markerCluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    spiderfyOnMaxZoom: false,
    removeOutsideVisibleBounds: true,
    disableClusteringAtZoom: 16,
    maxClusterRadius: 20,
    iconCreateFunction: function (cluster) {
      const count = cluster.getChildCount();
      return L.divIcon({
        html: '<div style="background:#e74c3c;color:white;border-radius:50%;width:36px;height:36px;line-height:36px;text-align:center;font-weight:bold;font-size:14px;">' + count + '</div>',
        className: '',
        iconSize: [36, 36]
      });
    }
  });
  state.treeLayer = state.markerCluster;
  state.treeLayer.addTo(state.map);
  state.prjLayer = L.layerGroup().addTo(state.map);

  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = function () {
    const d = L.DomUtil.create('div', 'legend');
    d.innerHTML = '<b>🚩 地盤｜● Tree Status</b><br>' +
      '<span style="color:' + Config.TREE_STATUS_COLORS.Normal + '">●</span> Normal ' +
      '<span style="color:' + Config.TREE_STATUS_COLORS.Fair + '">●</span> Fair ' +
      '<span style="color:' + Config.TREE_STATUS_COLORS.Poor + '">●</span> Poor ' +
      '<span style="color:' + Config.TREE_STATUS_COLORS['Very Poor'] + '">●</span> Very Poor ' +
      '<span style="color:' + Config.TREE_STATUS_COLORS.Dead + '">●</span> Dead';
    return d;
  };
  legend.addTo(state.map);

  state.map.on('click', function () {
    closeFilterPanel(); // 🔥 [v2.52] 點擊地圖自動收起 filter 面板
    if (closeDrawerFn && layerWrap && layerWrap.classList.contains('open')) {
      closeDrawerFn();
    }
    if (document.body.classList.contains('panel-open')) {
      closePanel();
    }
    hideSearch();
  });

  // Marker、地段及其他 popup 開啟時，避免抽屜遮擋 popup。
  state.map.on('popupopen', function () {
    if (closeDrawerFn && layerWrap && layerWrap.classList.contains('open')) {
      closeDrawerFn();
    }
  });

  // 🔥 [v2.61] 桌面 filter 按鈕（#bar 搜尋框下方）
  const filterBtn = document.getElementById('filterBtn');
  if (filterBtn) {
    filterBtn.addEventListener('click', function () {
      toggleFilterPanel(filterBtn);
    });
  }

  return true;
}

export function toggleAerial() {
  state.aerialEnabled = !state.aerialEnabled;
  const btn = document.querySelector('.layerbar button[data-l="aerial"]');
  if (btn) btn.classList.toggle('on', state.aerialEnabled);
  refreshAerial();
  updateStatus(state.aerialEnabled ? '✅ 已開啟航拍圖層' : '✅ 已關閉航拍圖層');
}

// 🔥 [Phase4] 訂閱地盤選擇事件，取代 projects/locate 直接 import refreshAerial（斷循環）
on('project:selected', function () {
  refreshAerial();
});

export function refreshAerial() {
  if (state.aerialLayer) {
    state.map.removeLayer(state.aerialLayer);
    state.aerialLayer = null;
  }
  if (!state.aerialEnabled || !state.curProject) return;

  const p = state.PROJECTS.find((x) => String(x.project_id) === String(state.curProject));
  if (!p || !p.aerial_url || !p.aerial_n1 || !p.aerial_e1 || !p.aerial_n2 || !p.aerial_e2) {
    updateStatus('⚠️ 此地盤未配置航拍圖（請在 projects 表填寫）');
    return;
  }

  const sw = CoordUtils.toWGS84(+p.aerial_n1, +p.aerial_e1);
  const ne = CoordUtils.toWGS84(+p.aerial_n2, +p.aerial_e2);
  if (!sw || !ne) {
    updateStatus('❌ 航拍座標轉換失敗');
    return;
  }
  const bounds = L.latLngBounds([sw.lat, sw.lng], [ne.lat, ne.lng]);

  const mode = String(p.aerial_type || 'image').toLowerCase();

  if (mode === 'tiles') {
    state.aerialLayer = L.tileLayer(p.aerial_url, {
      bounds: bounds,
      minNativeZoom: 17,
      maxNativeZoom: 22,
      maxZoom: Config.MAP.MAX_ZOOM,
      opacity: 0.9,
      pane: 'aerialPane',
      noWrap: true
    }).addTo(state.map);
  } else {
    state.aerialLayer = L.imageOverlay(p.aerial_url, bounds, {
      opacity: 0.9,
      interactive: false,
      pane: 'aerialPane'
    }).addTo(state.map);
  }
}
