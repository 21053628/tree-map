/**
 * 地圖初始化模組
 * v2.52 - 加入 🎚 狀態過濾掣（配合 filters.js）
 * v2.51 - 抽屜加入「建立地盤／新增樹木」動作掣
 * v2.50 - 手機版 layer bar 變身 FAB 抽屜
 */
import { state } from './state.js';
import { updateStatus } from './dom.js';
import { toggleLotLayer } from './lots.js';
import { toggleTreeLabels, scheduleRefreshLabels } from './trees.js';
import { toggleFilterPanel, closeFilterPanel } from './filters.js'; // 🔥 [v2.52]

let _closePanel = null;
let _hideSearch = null;

export function setClosePanel(fn) { _closePanel = fn; }
export function setHideSearch(fn) { _hideSearch = fn; }

export function initMap() {
  if (!window.L) {
    updateStatus('❌ 地圖元件載入失敗：請檢查網路後重新整理');
    return false;
  }

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
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

  state.lotLayer = L.layerGroup();

  let layerWrap = null;
  let closeDrawerFn = null;
  const layerBar = L.control({ position: isMobile ? 'bottomright' : 'bottomleft' });
  layerBar.onAdd = function () {
    layerWrap = L.DomUtil.create('div', 'layerbar-wrap');

    const fab = L.DomUtil.create('button', 'layerbar-fab', layerWrap);
    fab.type = 'button';
    fab.innerHTML = '▲';
    fab.title = '圖層與功能';

    const div = L.DomUtil.create('div', 'layerbar', layerWrap);
    div.innerHTML =
      '<button data-act="addProject" class="drawer-action act-project">＋ 建立地盤</button>' +
      '<button data-act="addTree" class="drawer-action act-tree">🌳 新增樹木</button>' +
      '<div class="drawer-sep"></div>' +
      '<button data-l="hk" class="on">政府</button>' +
      '<button data-l="sat">官航</button>' +
      '<button data-l="labels">🔢</button>' +
      '<button data-l="filter">🎚</button>' +   // 🔥 [v2.52] 狀態過濾掣
      '<button data-l="lot">🗺️ 地段</button>' +
      '<button data-l="aerial">🛰 航拍</button>';
    L.DomEvent.disableClickPropagation(layerWrap);

    function closeDrawer() {
      layerWrap.classList.remove('open');
      fab.innerHTML = '▲';
    }
    closeDrawerFn = closeDrawer;

    fab.addEventListener('click', function () {
      const open = layerWrap.classList.toggle('open');
      fab.innerHTML = open ? '✕' : '▲';
    });

    div.querySelectorAll('button').forEach((b) => {
      b.onclick = function () {
        if (b.dataset.act === 'addProject') {
          closeDrawer();
          const rp = document.getElementById('addProjectBtn');
          if (rp) rp.click();
          return;
        }
        if (b.dataset.act === 'addTree') {
          closeDrawer();
          const rt = document.getElementById('addTreeBtn');
          if (rt && rt.classList.contains('ghost-hidden')) {
            updateStatus('👉 請先選擇地盤，先可以新增樹木');
          } else if (rt) {
            rt.click();
          }
          return;
        }

        const layerType = b.dataset.l;
        if (layerType === 'lot') {
          toggleLotLayer();
        } else if (layerType === 'aerial') {
          toggleAerial();
        } else if (layerType === 'labels') {
          toggleTreeLabels();
        } else if (layerType === 'filter') {
          // 🔥 [v2.52] 撳 filter 掣：收起抽屜，彈出 filter 面板
          if (layerWrap && layerWrap.classList.contains('open')) closeDrawer();
          toggleFilterPanel(b);
        } else {
          if (state.currentBaseLayer) state.map.removeLayer(state.currentBaseLayer);
          state.currentBaseLayer = state.baseLayers[layerType];
          state.currentBaseLayer.addTo(state.map);
          div.querySelectorAll('button[data-l="hk"], button[data-l="sat"]')
            .forEach((x) => { x.classList.toggle('on', x.dataset.l === layerType); });
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

  state.map.on('moveend', scheduleRefreshLabels);

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
    closeFilterPanel(); // 🔥 [v2.52] 撳地圖自動收埋 filter 面板
    if (closeDrawerFn && layerWrap && layerWrap.classList.contains('open')) {
      closeDrawerFn();
    }
    if (document.body.classList.contains('panel-open') && _closePanel) {
      _closePanel();
    }
    if (_hideSearch) _hideSearch();
  });

  return true;
}

export function toggleAerial() {
  state.aerialEnabled = !state.aerialEnabled;
  const btn = document.querySelector('.layerbar button[data-l="aerial"]');
  if (btn) btn.classList.toggle('on', state.aerialEnabled);
  refreshAerial();
  updateStatus(state.aerialEnabled ? '✅ 已開啟航拍圖層' : '✅ 已關閉航拍圖層');
}

export function refreshAerial() {
  if (state.aerialLayer) {
    state.map.removeLayer(state.aerialLayer);
    state.aerialLayer = null;
  }
  if (!state.aerialEnabled || !state.curProject) return;

  const p = state.PROJECTS.find((x) => String(x.project_id) === String(state.curProject));
  if (!p || !p.aerial_url || !p.aerial_n1 || !p.aerial_e1 || !p.aerial_n2 || !p.aerial_e2) {
    updateStatus('⚠️ 此地盤未配置航拍圖（請喺 projects 表填寫）');
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
