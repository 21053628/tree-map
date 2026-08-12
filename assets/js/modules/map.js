/**
 * 地圖初始化模組
 * v2.49 - 移除「地形」「街道」底圖，layer bar 精簡為：政府｜官航｜🔢｜地段｜航拍
 * v2.48 - layer bar 新增 🔢 編號開關 + moveend 自動刷新標籤
 * v2.47 - 衛星層改用地政總署 Imagery Map API
 * v2.46 - 航拍圖獨立 aerialPane (z-index 250)
 */
import { state } from './state.js';
import { updateStatus } from './dom.js';
import { toggleLotLayer } from './lots.js';
import { toggleTreeLabels, scheduleRefreshLabels } from './trees.js';

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
    preferCanvas: true  // 🔥 樹木/地段用 Canvas 渲染，2000 棵樹都順滑
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

  // 🔥 [v2.46] 航拍圖獨立 pane：z-index 250（夾喺底圖 200 同矢量層 400 之間）
  if (!state.map.getPane('aerialPane')) {
    const aerialPane = state.map.createPane('aerialPane');
    aerialPane.style.zIndex = 250;
  }

  // 🔥 [v2.49] 底圖精簡：只保留 政府 + 官航
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

  // 🔥 [v2.49] layer bar 精簡版
  const layerBar = L.control({ position: isMobile ? 'bottomright' : 'bottomleft' });
  layerBar.onAdd = function () {
    const div = L.DomUtil.create('div', 'layerbar');
    div.innerHTML = '<button data-l="hk" class="on">政府</button>' +
      '<button data-l="sat">官航</button>' +
      '<button data-l="labels">🔢</button>' +
      '<button data-l="lot">🗺️ 地段</button>' +
      '<button data-l="aerial">🛰 航拍</button>';
    L.DomEvent.disableClickPropagation(div);

    div.querySelectorAll('button').forEach((b) => {
      b.onclick = function () {
        const layerType = b.dataset.l;
        if (layerType === 'lot') {
          toggleLotLayer();
        } else if (layerType === 'aerial') {
          toggleAerial();
        } else if (layerType === 'labels') {
          toggleTreeLabels();
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
    return div;
  };
  layerBar.addTo(state.map);

  // 🔥 [v2.48] 拖圖／縮放後防抖刷新標籤
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
    if (document.body.classList.contains('panel-open') && _closePanel) {
      _closePanel();
    }
    if (_hideSearch) _hideSearch();
  });

  return true;
}

// 🔥 [v2.33] 航拍圖 toggle 函數
export function toggleAerial() {
  state.aerialEnabled = !state.aerialEnabled;
  const btn = document.querySelector('.layerbar button[data-l="aerial"]');
  if (btn) btn.classList.toggle('on', state.aerialEnabled);
  refreshAerial();
  updateStatus(state.aerialEnabled ? '✅ 已開啟航拍圖層' : '✅ 已關閉航拍圖層');
}

// 🔥 [v2.46] 航拍圖刷新：改用 aerialPane，樹木/地段線永遠喺最頂
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
