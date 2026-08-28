/**
 * 地圖初始化模組
 * v1.0.0-beta - 統一版本號（正式發佈前整合）
 * 歷史：v2.62 - 整理手機版底圖控制；v2.52 - 狀態過濾按鈕；v2.51 - 抽屜動作按鈕；v2.50 - FAB 抽屜
 */
import { state } from './state.js';
import { updateStatus, closePanel } from './dom.js';
import { hideSearch } from './search.js';
import { toggleLotLayer } from './lots.js';
import { toggleTreeLabels, scheduleRedraw } from './trees.js';
import { loadTreesForProject } from './loader.js';
import { toggleFilterPanel, closeFilterPanel } from './filters.js'; // 🔥 [v2.52]
import { startMeasure, cancelInteraction, clearAllDrawings, getMode as getDrawMode } from './draw.js'; // 🔥 [Phase1]
import { toggleGeolocation, locateOnce } from './geolocate.js'; // 🔥 [Phase1]
import { on } from '../core/event-bus.js';
import { openTreeForm } from './forms.js';
import { Config } from '../config.js';
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

  // 🔥 [修復] 地段專用 pane：z-index 350 低於 overlayPane(400)，
  // 確保樹木 Canvas（400）在上層可被點擊，地段 SVG 在下層不遮擋
  if (!state.map.getPane('lotPane')) {
    const lotPane = state.map.createPane('lotPane');
    lotPane.style.zIndex = 350;
  }
  if (!state.map.getPane('companyBoundaryPane')) {
    const boundaryPane = state.map.createPane('companyBoundaryPane');
    boundaryPane.style.zIndex = 360;
  }
  if (!state.siteBoundaryLayer) state.siteBoundaryLayer = L.layerGroup().addTo(state.map);

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
        '<button data-act="siteInfo">📋 地盤資料</button>' +
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
        '</div>' +
        '<div class="drawer-sep"></div>' +
        '<button data-l="filter">' + LAYERS_ICON + ' 篩選</button>' +
        '<button data-l="labels">🔢 樹木數字顯示</button>' +
        '<button data-act="sync">☁️ 同步 <span class="drawer-sync-badge" aria-hidden="true">●</span></button>';
    } else {
      div.innerHTML =
        '<button data-act="addProject" class="drawer-action act-project">＋ 建立地盤</button>' +
        '<button data-act="addTree" class="drawer-action act-tree">🌳 新增樹木</button>' +
        '<button data-act="siteInfo">📋 地盤資料</button>' +
        '<div class="drawer-sep sep-tools"></div>' +
        '<button data-act="measureLine">📏 距離</button>' +
        '<button data-act="measureArea">📐 面積</button>' +
        '<button data-act="locate">📍 定位</button>' +
        '<button data-act="clearDrawings">✕ 清除</button>' +
        '<div class="drawer-sep"></div>' +
        '<button data-l="hk" class="on">政府</button>' +
        '<button data-l="sat">衛星</button>' +
        '<button data-l="labels">🔢</button>' +
        '<button data-l="filter">' + LAYERS_ICON + ' 篩選</button>' +   // 🔥 [v2.52] 狀態過濾按鈕
        '<button data-l="lot">🗺️ 地段</button>';
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
      b.addEventListener('click', function () {
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
          openTreeForm();
          return;
        }
        if (b.dataset.act === 'siteInfo') {
          closeDrawer();
          if (!state.curProject) { updateStatus('⚠️ 請先選擇地盤'); return; }
          import('./site-info.js').then((module) => module.openSiteInfo());
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
      });
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

  // ---- Viewport 按需增量载入（混合模式：仅对大项目启用）----
  let _viewportTimer = null;
  const _loadedBboxKeys = new Set();
  let _lastPidForViewport = '';
  function bboxKey(pid, b){
    const s=b.getSouth().toFixed(2), w=b.getWest().toFixed(2), n=b.getNorth().toFixed(2), e=b.getEast().toFixed(2);
    return pid+':'+s+','+w+','+n+','+e;
  }
  function maybeLoadViewport(){
    try{
      const pid = String(state.curProject||'');
      if(!pid) return;
      const list = state.treeSearchIndex.get(pid) || [];
      // 仅当该地盘树数较多时启用 bbox 增量（避免小项目过度请求）
      const threshold = (Config.MAP && Config.MAP.VIEWPORT_THRESHOLD) ? Config.MAP.VIEWPORT_THRESHOLD : 2000;
      if(list.length < threshold) return;
      if(!state.map) return;
      const b = state.map.getBounds().pad(0.3);
      if(pid !== _lastPidForViewport){ _loadedBboxKeys.clear(); _lastPidForViewport = pid; }
      const k = bboxKey(pid, b);
      if(_loadedBboxKeys.has(k)) return;
      _loadedBboxKeys.add(k);
      loadTreesForProject(pid, { south:b.getSouth(), west:b.getWest(), north:b.getNorth(), east:b.getEast(), appendViewport:true }).catch(function(){ /* intentionally ignored: optional fallback failure */ });
    }catch(e){ /* intentionally ignored: optional fallback failure */ }
  }
  state.map.on('moveend', function () {
    scheduleRedraw();
    clearTimeout(_viewportTimer);
    _viewportTimer = setTimeout(maybeLoadViewport, 400);
  });
  // 切地盘时清 bbox 去重
  try{ on('project:selected', function(pid){ _loadedBboxKeys.clear(); _lastPidForViewport=String(pid||''); }); }catch(e){ /* intentionally ignored: optional fallback failure */ }

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
        html: '<div class="cluster-badge">' + count + '</div>',
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
      '<span class="legend-dot" data-c="' + Config.TREE_STATUS_COLORS.Normal + '">●</span> Normal ' +
      '<span class="legend-dot" data-c="' + Config.TREE_STATUS_COLORS.Fair + '">●</span> Fair ' +
      '<span class="legend-dot" data-c="' + Config.TREE_STATUS_COLORS.Poor + '">●</span> Poor ' +
      '<span class="legend-dot" data-c="' + Config.TREE_STATUS_COLORS["Very Poor"] + '">●</span> Very Poor ' +
      '<span class="legend-dot" data-c="' + Config.TREE_STATUS_COLORS.Dead + '">●</span> Dead';
    d.querySelectorAll('.legend-dot').forEach(function(el){ if(el.dataset.c) el.style.color = el.dataset.c; });
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
    // 🔥 [A11y] 為 popup 關閉按鈕加 aria-label
    setTimeout(function setPopupCloseAria() {
      try {
        var closeBtn = document.querySelector('.leaflet-popup-close-button');
        if (closeBtn && !closeBtn.getAttribute('aria-label')) {
          closeBtn.setAttribute('aria-label', '關閉');
        }
      } catch (e) { /* intentionally ignored: optional fallback failure */ }
    }, 50);
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

