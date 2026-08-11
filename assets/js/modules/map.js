/**
 * 地圖初始化模組
 * - Leaflet 初始化
 * - 底圖切換
 * - 圖例
 */
import { state } from './state.js';
import { updateStatus } from './dom.js';
import { toggleLotLayer } from './lots.js';

// 閉包引用（避免循環依賴，會喺 init 時綁定）
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
    tapTolerance: 15
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

  const hkBase = L.tileLayer('https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/wgs84/{z}/{x}/{y}.png',
    { attribution: '© 地政總署 LandsD HKSAR', maxZoom: Config.MAP.MAX_ZOOM });
  const hkLabel = L.tileLayer('https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/tc/wgs84/{z}/{x}/{y}.png',
    { maxZoom: Config.MAP.MAX_ZOOM });

  state.baseLayers = {
    hk: L.layerGroup([hkBase, hkLabel]),
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© Esri World Imagery', maxZoom: Config.MAP.MAX_ZOOM }),
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      { attribution: '© OpenTopoMap (CC-BY-SA)', maxZoom: 17 }),
    street: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '© OpenStreetMap', maxZoom: Config.MAP.MAX_ZOOM })
  };

  state.baseLayers.hk.addTo(state.map);
  state.currentBaseLayer = state.baseLayers.hk;

  state.lotLayer = L.layerGroup();

  const layerBar = L.control({ position: isMobile ? 'bottomright' : 'bottomleft' });
  layerBar.onAdd = function () {
    const div = L.DomUtil.create('div', 'layerbar');
    div.innerHTML = '<button data-l="hk" class="on">政府</button>' +
      '<button data-l="sat">衛星</button>' +
      '<button data-l="topo">地形</button>' +
      '<button data-l="street">街道</button>' +
      '<button data-l="lot">🗺️ 地段</button>';
    L.DomEvent.disableClickPropagation(div);

    div.querySelectorAll('button').forEach((b) => {
      b.onclick = function () {
        const layerType = b.dataset.l;
        if (layerType === 'lot') {
          toggleLotLayer();
        } else {
          if (state.currentBaseLayer) state.map.removeLayer(state.currentBaseLayer);
          state.currentBaseLayer = state.baseLayers[layerType];
          state.currentBaseLayer.addTo(state.map);
          div.querySelectorAll('button[data-l="hk"], button[data-l="sat"], button[data-l="topo"], button[data-l="street"]')
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