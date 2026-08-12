/**
 * 地圖初始化模組
 * - Leaflet 初始化
 * - 底圖切換（支援 maxNativeZoom 放大）
 * - 航拍圖疊加層（單圖／切片雙模式）
 * - 圖例
 * v2.41 - 修正航拍圖 zIndex，確保地段圖層（lot layer）顯示喺最頂
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

  // 🔥 [v2.33] 底圖加 maxNativeZoom：原生只到 19，放大到 22 會朦，但航拍圖超清就彌補
  state.baseLayers = {
    hk: L.layerGroup([
      L.tileLayer('https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/wgs84/{z}/{x}/{y}.png',
        { attribution: '© 地政總署 LandsD HKSAR', maxNativeZoom: 19, maxZoom: Config.MAP.MAX_ZOOM }),
      L.tileLayer('https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/tc/wgs84/{z}/{x}/{y}.png',
        { maxNativeZoom: 19, maxZoom: Config.MAP.MAX_ZOOM })
    ]),
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© Esri World Imagery', maxNativeZoom: 19, maxZoom: Config.MAP.MAX_ZOOM }),
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      { attribution: '© OpenTopoMap (CC-BY-SA)', maxNativeZoom: 17, maxZoom: Config.MAP.MAX_ZOOM }),
    street: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      { attribution: '© OpenStreetMap', maxNativeZoom: 19, maxZoom: Config.MAP.MAX_ZOOM })
  };

  state.baseLayers.hk.addTo(state.map);
  state.currentBaseLayer = state.baseLayers.hk;

  state.lotLayer = L.layerGroup();

  // 🔥 [v2.33] layer bar 加入「🛰 航拍」按鈕
  const layerBar = L.control({ position: isMobile ? 'bottomright' : 'bottomleft' });
  layerBar.onAdd = function () {
    const div = L.DomUtil.create('div', 'layerbar');
    div.innerHTML = '<button data-l="hk" class="on">政府</button>' +
      '<button data-l="sat">衛星</button>' +
      '<button data-l="topo">地形</button>' +
      '<button data-l="street">街道</button>' +
      '<button data-l="lot">🗺️ 地段</button>' +
      '<button data-l="aerial">🛰 航拍</button>';
    L.DomEvent.disableClickPropagation(div);

    div.querySelectorAll('button').forEach((b) => {
      b.onclick = function () {
        const layerType = b.dataset.l;
        if (layerType === 'lot') {
          toggleLotLayer();
        } else if (layerType === 'aerial') {
          // 🔥 [v2.33] 航拍圖 toggle
          toggleAerial();
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

// 🔥 [v2.33] 航拍圖 toggle 函數
export function toggleAerial() {
  state.aerialEnabled = !state.aerialEnabled;
  const btn = document.querySelector('.layerbar button[data-l="aerial"]');
  if (btn) btn.classList.toggle('on', state.aerialEnabled);
  refreshAerial();
  updateStatus(state.aerialEnabled ? '✅ 已開啟航拍圖層' : '✅ 已關閉航拍圖層');
}

// 🔥 [v2.33] 航拍圖刷新：根據當前地盤自動對位
export function refreshAerial() {
  // 移除舊疊加層
  if (state.aerialLayer) {
    state.map.removeLayer(state.aerialLayer);
    state.aerialLayer = null;
  }
  if (!state.aerialEnabled || !state.curProject) return;

  // 搵當前地盤嘅航拍配置
  const p = state.PROJECTS.find((x) => String(x.project_id) === String(state.curProject));
  if (!p || !p.aerial_url || !p.aerial_n1 || !p.aerial_e1 || !p.aerial_n2 || !p.aerial_e2) {
    updateStatus('⚠️ 此地盤未配置航拍圖（請喺 projects 表填寫）');
    return;
  }

  // HK80 → WGS84 轉換四角
  const sw = CoordUtils.toWGS84(+p.aerial_n1, +p.aerial_e1); // 左下角
  const ne = CoordUtils.toWGS84(+p.aerial_n2, +p.aerial_e2); // 右上角
  if (!sw || !ne) {
    updateStatus('❌ 航拍座標轉換失敗');
    return;
  }
  const bounds = L.latLngBounds([sw.lat, sw.lng], [ne.lat, ne.lng]);

  // 根據 aerial_type 選擇模式（image / tiles）
  const mode = String(p.aerial_type || 'image').toLowerCase();

  if (mode === 'tiles') {
    // 切片模式：超清 + 極速（只載可見範圍）
    // 🔥 [v2.34] maxNativeZoom 改 22，配合 8000px 縮圖
    state.aerialLayer = L.tileLayer(p.aerial_url, {
      bounds: bounds,
      minNativeZoom: 17,
      maxNativeZoom: 22,
      maxZoom: Config.MAP.MAX_ZOOM,
      opacity: 0.9,
      zIndex: 250,   // 🔥 [v2.41] 改低：夾喺底圖(200)同地段(400)之間，確保地段線顯示喺最頂
      noWrap: true
    }).addTo(state.map);
  } else {
    // 🏆 單張原圖模式（示範用呢個）
    state.aerialLayer = L.imageOverlay(p.aerial_url, bounds, {
      opacity: 0.9,
      interactive: false, // 唔擋地圖點擊
      zIndex: 250      // 🔥 [v2.41] 改低：夾喺底圖(200)同地段(400)之間，確保地段線顯示喺最頂
    }).addTo(state.map);
  }
}