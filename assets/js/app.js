/**
 * 樹木管理系統 - 主應用程式模組（終極效能優化版 v2.20 - 新增地段索引圖層）
 * 
 * 🚀 優化重點：
 * 1-26. [v2.1 - v2.19 核心優化] 包含極簡狀態圓點、精準定位、搜尋功能、樹種清單競態修復等
 * 27. [v2.20] 新增「地段索引 (Lot Index)」圖層：整合地政總署 iC1000 API，顯示私人地段邊界
 */

const App = (function() {
  'use strict';
  
  const API_ENDPOINT = Config.API_ENDPOINT;
  ApiService.init(API_ENDPOINT);
  
  let statusEl = null;
  const $ = function(s) { return document.querySelector(s); };
  
  let PROJECTS = [];
  let TREES = [];
  let curProject = '';
  
  let treeCountMap = new Map();
  let treeMap = new Map();
  
  let projectMarkersCache = null;
  let treesCache = new Map();
  
  let spatialIndexCache = null;
  let coordGroupsCache = null;
  
  let map = null;
  let treeLayer = null;
  let prjLayer = null;
  let baseLayers = {};
  let markerCluster = null;
  let currentBaseLayer = null;
  
  // 🔥 [v2.20] 地段索引圖層
  let lotLayer = null;
  let lotLayerEnabled = false;
  let lotCache = new Map(); // 快取已載入嘅地段（bbox -> polygons）
  let lotLoadTimer = null;
  
  let isLocating = false; 
  
  // 🔥 [v2.18] 樹種清單快取（模組級，只 fetch 一次）
  let speciesCache = null;
  let speciesPromise = null;
  
  let perfMetrics = {
    renderTime: 0,
    cacheHits: 0,
    totalRenders: 0,
    spatialIndexBuildTime: 0
  };
  
  let resizeTimer = null;
  let loadDebounceTimer = null;

  // 🔥 [v2.19] 簡易 HTML 跳脫（防 XSS）
  function escapeHtml(str){
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // 🔥 [v2.18] 載入樹種資料：Promise 去重 + 快取 + 失敗可重試
  function loadTreeSpecies() {
    if (speciesCache) return Promise.resolve(speciesCache);
    if (speciesPromise) return speciesPromise;
    
    speciesPromise = fetch('data/trees_data.json')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(trees) {
        speciesCache = trees || [];
        console.log('✅ 樹種清單載入完成：' + speciesCache.length + ' 種');
        return speciesCache;
      })
      .catch(function(err) {
        console.error('❌ 載入樹木資料失敗:', err);
        speciesPromise = null; // 允許下次重試
        return [];
      });
    
    return speciesPromise;
  }

  // 🔥 [v2.18] 將快取嘅樹種同步填入 datalist（每次開面板都執行，確保唔會空白）
  function fillSpeciesDatalist() {
    const dataList = document.getElementById('tree_datalist');
    if (!dataList) return;
    dataList.textContent = '';
    (speciesCache || []).forEach(function(tree) {
      const option = document.createElement('option');
      option.value = tree.name;
      dataList.appendChild(option);
    });
  }

  // 🔥 [v2.20] 地段索引：GML 解析器
  function parseGML(gmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gmlText, 'text/xml');
    const polygons = [];
    
    // 搵所有 Polygon 元素
    const polygonElements = xmlDoc.getElementsByTagNameNS('*', 'Polygon');
    
    for (let i = 0; i < polygonElements.length; i++) {
      const poly = polygonElements[i];
      const coords = [];
      
      // 嘗試搵 posList（GML 3.1+ 格式）
      const posList = poly.getElementsByTagNameNS('*', 'posList')[0];
      if (posList && posList.textContent) {
        const points = posList.textContent.trim().split(/\s+/);
        // HK80 座標格式：E1 N1 E2 N2 E3 N3 ...
        for (let j = 0; j < points.length; j += 2) {
          const e = parseFloat(points[j]);
          const n = parseFloat(points[j + 1]);
          if (!isNaN(e) && !isNaN(n)) {
            const wgs = CoordUtils.toWGS84(n, e);
            if (wgs) coords.push([wgs.lat, wgs.lng]);
          }
        }
      } else {
        // 嘗試搵 coordinates（GML 2 格式）
        const coordsEl = poly.getElementsByTagNameNS('*', 'coordinates')[0];
        if (coordsEl && coordsEl.textContent) {
          const points = coordsEl.textContent.trim().split(/\s+/);
          points.forEach(function(pt) {
            const parts = pt.split(',');
            if (parts.length >= 2) {
              const e = parseFloat(parts[0]);
              const n = parseFloat(parts[1]);
              if (!isNaN(e) && !isNaN(n)) {
                const wgs = CoordUtils.toWGS84(n, e);
                if (wgs) coords.push([wgs.lat, wgs.lng]);
              }
            }
          });
        }
      }
      
      if (coords.length >= 3) {
        // 嘗試提取地段號碼（如果有）
        let lotNo = '';
        const nameEl = poly.getElementsByTagNameNS('*', 'name')[0] || 
                       poly.getElementsByTagNameNS('*', 'lotNumber')[0];
        if (nameEl) lotNo = nameEl.textContent.trim();
        
        polygons.push({ coords: coords, lotNo: lotNo });
      }
    }
    
    return polygons;
  }

  // 🔥 [v2.20] 地段索引：載入當前視野嘅地段
  function loadLots() {
    if (!lotLayerEnabled || !map || map.getZoom() < 17) {
      lotLayer.clearLayers();
      return;
    }
    
    const bounds = map.getBounds();
    const sw = CoordUtils.toHK80(bounds.getSouth(), bounds.getWest());
    const ne = CoordUtils.toHK80(bounds.getNorth(), bounds.getEast());
    
    if (!sw || !ne) return;
    
    // 生成 bbox key 用於快取
    const minX = Math.floor(sw.E / 50) * 50;
    const minY = Math.floor(sw.N / 50) * 50;
    const maxX = Math.ceil(ne.E / 50) * 50;
    const maxY = Math.ceil(ne.N / 50) * 50;
    const bboxKey = `${minX},${minY},${maxX},${maxY}`;
    
    // 檢查快取
    if (lotCache.has(bboxKey)) {
      renderLots(lotCache.get(bboxKey));
      return;
    }
    
    // 呼叫地政總署 API
    const url = `https://mapapi.geodata.gov.hk/gs/api/v1.0.0/iC1000/lot?bbox=${minX},${minY},${maxX},${maxY},EPSG:2326`;
    
    fetch(url)
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function(gmlText) {
        const polygons = parseGML(gmlText);
        lotCache.set(bboxKey, polygons);
        renderLots(polygons);
      })
      .catch(function(err) {
        console.error('❌ 載入地段索引失敗:', err);
      });
  }

  // 🔥 [v2.20] 地段索引：渲染地段多邊形
  function renderLots(polygons) {
    lotLayer.clearLayers();
    
    polygons.forEach(function(p) {
      const polygon = L.polygon(p.coords, {
        color: '#1565c0',
        weight: 2,
        opacity: 0.7,
        fillColor: '#1565c0',
        fillOpacity: 0.1
      });
      
      if (p.lotNo) {
        polygon.bindPopup('<b>🗺️ 地段編號：</b>' + escapeHtml(p.lotNo));
      } else {
        polygon.bindPopup('<b>🗺️ 私人地段</b>');
      }
      
      polygon.addTo(lotLayer);
    });
  }

  // 🔥 [v2.20] 地段索引：切換開關
  function toggleLotLayer() {
    lotLayerEnabled = !lotLayerEnabled;
    
    if (lotLayerEnabled) {
      lotLayer.addTo(map);
      loadLots();
      map.on('moveend', debouncedLoadLots);
      updateStatus('✅ 已開啟地段索引圖層');
    } else {
      map.removeLayer(lotLayer);
      map.off('moveend', debouncedLoadLots);
      lotLayer.clearLayers();
      updateStatus('✅ 已關閉地段索引圖層');
    }
    
    // 更新按鈕狀態
    const btn = document.querySelector('.layerbar button[data-l="lot"]');
    if (btn) btn.classList.toggle('on', lotLayerEnabled);
  }

  // 🔥 [v2.20] 地段索引：防抖載入（避免太頻繁請求）
  function debouncedLoadLots() {
    clearTimeout(lotLoadTimer);
    lotLoadTimer = setTimeout(loadLots, 500);
  }

  function initMap() {
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
    
    map = L.map('map', mapOptions).setView(Config.MAP.DEFAULT_CENTER, Config.MAP.DEFAULT_ZOOM);
    
    if (isMobile) {
      L.control.zoom({
        position: 'topleft',
        zoomInText: '+',
        zoomOutText: '−',
        zoomInTitle: '放大',
        zoomOutTitle: '縮小'
      }).addTo(map);
    }
    
    const hkBase = L.tileLayer('https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/wgs84/{z}/{x}/{y}.png',
                   {attribution:'© 地政總署 LandsD HKSAR', maxZoom:Config.MAP.MAX_ZOOM});
    const hkLabel = L.tileLayer('https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/tc/wgs84/{z}/{x}/{y}.png',
                   {maxZoom:Config.MAP.MAX_ZOOM});
    
    baseLayers = {
      hk:     L.layerGroup([hkBase, hkLabel]),
      sat:    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                {attribution:'© Esri World Imagery', maxZoom:Config.MAP.MAX_ZOOM}),
      topo:   L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
                {attribution:'© OpenTopoMap (CC-BY-SA)', maxZoom:17}),
      street: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                {attribution:'© OpenStreetMap', maxZoom:Config.MAP.MAX_ZOOM})
    };
    
    baseLayers.hk.addTo(map);
    currentBaseLayer = baseLayers.hk;
    
    // 🔥 [v2.20] 初始化地段圖層
    lotLayer = L.layerGroup();
    
    const layerBar = L.control({position: isMobile ? 'bottomright' : 'bottomleft'});
    layerBar.onAdd = function() {
      const div = L.DomUtil.create('div', 'layerbar');
      div.innerHTML = '<button data-l="hk" class="on">政府</button>' +
                      '<button data-l="sat">衛星</button>' +
                      '<button data-l="topo">地形</button>' +
                      '<button data-l="street">街道</button>' +
                      '<button data-l="lot">🗺️ 地段</button>';
      L.DomEvent.disableClickPropagation(div);
      
      div.querySelectorAll('button').forEach(function(b) {
        b.onclick = function() {
          const layerType = b.dataset.l;
          
          if (layerType === 'lot') {
            toggleLotLayer();
          } else {
            if (currentBaseLayer) map.removeLayer(currentBaseLayer);
            currentBaseLayer = baseLayers[layerType];
            currentBaseLayer.addTo(map);
            div.querySelectorAll('button[data-l="hk"], button[data-l="sat"], button[data-l="topo"], button[data-l="street"]')
              .forEach(function(x) { x.classList.toggle('on', x.dataset.l === layerType); });
          }
        };
        if (isTouch) {
          b.addEventListener('touchstart', function(e) {
            e.preventDefault();
            b.click();
          }, {passive: false});
        }
      });
      return div;
    };
    layerBar.addTo(map);
    
    markerCluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      spiderfyOnMaxZoom: false,
      removeOutsideVisibleBounds: true,
      disableClusteringAtZoom: 16,
      maxClusterRadius: 20,
      iconCreateFunction: function(cluster) {
        var count = cluster.getChildCount();
        return L.divIcon({
          html: '<div style="background:#e74c3c;color:white;border-radius:50%;width:36px;height:36px;line-height:36px;text-align:center;font-weight:bold;font-size:14px;">' + count + '</div>',
          className: '',
          iconSize: [36, 36]
        });
      }
    });
    treeLayer = markerCluster;
    treeLayer.addTo(map);
    prjLayer  = L.layerGroup().addTo(map);
    
    const legend = L.control({position:'bottomright'});
    legend.onAdd = function() {
      const d = L.DomUtil.create('div', 'legend');
      d.innerHTML = '<b>🚩 地盤｜● Tree Status</b><br>' +
        '<span style="color:'+Config.TREE_STATUS_COLORS.Normal+'">●</span> Normal ' +
        '<span style="color:'+Config.TREE_STATUS_COLORS.Fair+'">●</span> Fair ' +
        '<span style="color:'+Config.TREE_STATUS_COLORS.Poor+'">●</span> Poor ' +
        '<span style="color:'+Config.TREE_STATUS_COLORS['Very Poor']+'">●</span> Very Poor ' +
        '<span style="color:'+Config.TREE_STATUS_COLORS.Dead+'">●</span> Dead';
      return d;
    };
    legend.addTo(map);
    
    map.on('click', function() {
      if (document.body.classList.contains('panel-open')) {
        closePanel();
      }
      hideSearch(); // 🔥 [v2.19] 撳地圖就收埋搜尋結果
    });
    
    return true;
  }
  
  function updateStatus(message) {
    if (statusEl) {
      statusEl.textContent = message;
      
      statusEl.classList.remove('success', 'error');
      if (message.indexOf('✅') !== -1 || message.indexOf('成功') !== -1) {
        statusEl.classList.add('success');
      } else if (message.indexOf('❌') !== -1 || message.indexOf('失敗') !== -1 || message.indexOf('錯誤') !== -1) {
        statusEl.classList.add('error');
      }
      
      clearTimeout(statusEl._hideTimer);
      statusEl._hideTimer = setTimeout(function() {
        statusEl.classList.remove('success', 'error');
      }, 5000);
      
    } else {
      console.log('[Status]', message);
    }
  }
  
  async function load() {
    updateStatus('🗺️ 載入中…');
    
    try {
      const [projectsRes, treesRes] = await Promise.all([
        ApiService.get('projects'),
        ApiService.get('trees')
      ]);
      
      PROJECTS = projectsRes.data || [];
      TREES = treesRes.data || [];
      
      treeCountMap.clear();
      treeMap.clear();
      TREES.forEach(function(t) {
        const pid = String(t.project_id || '');
        treeCountMap.set(pid, (treeCountMap.get(pid) || 0) + 1);
        treeMap.set(pid + '_' + String(t.tree_id), t);
      });
      
      projectMarkersCache = null;
      treesCache.clear();
      spatialIndexCache = null;
      coordGroupsCache = null;
      
      buildSelect();
      hideSearch(); // 🔥 [v2.19] 資料更新後清空舊搜尋結果
      drawProjects();
      drawTrees();
      
      const stats = ApiService.getStats();
      console.log('✅ 資料載入完成', stats);
      return Promise.resolve();
    } catch (error) {
      updateStatus('❌ 後端連線失敗：' + error.message);
      console.error('載入失敗:', error);
    }
  }
  
  function buildSelect() {
    const sel = $('#projSel');
    if (!sel) return;
    
    const inlineOnChange = sel.getAttribute('onchange');
    sel.removeAttribute('onchange');
    sel.onchange = null;
    
    sel.innerHTML = '<option value="">🗂️ 全部地盤</option>' +
      PROJECTS.map(function(p) { return '<option value="'+p.project_id+'">🚩 '+p.name+'</option>'; }).join('');
    sel.value = curProject;
    $('#addTreeBtn').style.display = curProject ? 'inline-block' : 'none';
    
    if (inlineOnChange) {
      sel.setAttribute('onchange', inlineOnChange);
    } else {
      sel.onchange = function() { App.selectProject(this.value); };
    }
  }
  
  // 🔥 [v2.19] 樹木搜尋：只搜尋「當前地盤」，匹配編號／樹種
  function handleSearch(query) {
    const box = $('#searchResults');
    if (!box) return;
    const q = String(query || '').trim().toLowerCase();
    
    if (!curProject) {
      box.innerHTML = '<div class="sr-item sr-hint">👉 請先選擇地盤先可以搜尋</div>';
      box.style.display = 'block';
      return;
    }
    if (!q) { hideSearch(); return; }
    
    const results = [];
    for (let i = 0; i < TREES.length && results.length < 30; i++) {
      const t = TREES[i];
      if (String(t.project_id) !== String(curProject)) continue;
      const idMatch = String(t.tree_id).toLowerCase().indexOf(q) !== -1;
      const nameMatch = String(t.name || '').toLowerCase().indexOf(q) !== -1;
      if (idMatch || nameMatch) results.push(t);
    }
    
    if (!results.length) {
      box.innerHTML = '<div class="sr-item sr-hint">🤷 搵唔到「' + escapeHtml(query) + '」</div>';
      box.style.display = 'block';
      return;
    }
    
    box.innerHTML = results.map(function(t){
      const color = Config.TREE_STATUS_COLORS[t.status] || Config.TREE_STATUS_COLORS.Unknown;
      return '<div class="sr-item" data-id="' + escapeHtml(t.tree_id) + '">' +
             '<span class="sr-dot" style="background:' + color + '"></span>' +
             '<span class="sr-id">' + escapeHtml(t.tree_id) + '</span>' +
             '<span class="sr-name">' + escapeHtml(t.name || '') + '</span>' +
             '</div>';
    }).join('');
    box.style.display = 'block';
  }
  
  // 🔥 [v2.19] 收埋搜尋結果下拉清單
  function hideSearch() {
    const box = $('#searchResults');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  }
  
  // 🔥 [v2.19] 聚焦搜尋到嘅樹：飛去目標樹並彈出資料
  function focusTree(treeId) {
    hideSearch();
    const input = $('#treeSearch');
    if (input) { input.value = ''; input.blur(); }
    locateTree(String(treeId), curProject, null, null);
  }
  
  function drawProjects() {
    const startTime = performance.now();
    prjLayer.clearLayers();
    projectMarkersCache = null;
    
    const markers = [];
    
    PROJECTS.forEach(function(p) {
      if (String(p.project_id) === String(curProject)) return;
      const lat = +p.lat, lng = +p.lng;
      if (!lat || !lng) return;
      
      const hk = CoordUtils.toHK80(lat, lng);
      const count = treeCountMap.get(String(p.project_id)) || 0;
      
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: '<div class="prjIcon">🚩</div>',
          iconSize: [34, 24],
          iconAnchor: [17, 12]
        })
      });
      
      const popupDiv = L.DomUtil.create('div');
      popupDiv.innerHTML = DOMPurify.sanitize(
        '<b>🚩 ' + p.name + '</b><br>' +
        '此地盤樹木：' + count + ' 棵<br>' +
        (hk ? 'HK80：N ' + CoordUtils.format1(hk.N) + ' / E ' + CoordUtils.format1(hk.E) + '<br>' : '')
      );
      const btn = L.DomUtil.create('button', '', popupDiv);
      btn.textContent = '📍 前往地盤查看樹木';
      L.DomEvent.disableClickPropagation(btn);
      btn.onclick = function(e) {
        e.stopPropagation();
        App.selectProject(p.project_id);
      };
      marker.bindPopup(popupDiv);
      
      markers.push(marker);
    });
    
    if (markers.length > 0) {
      prjLayer.addLayer(L.layerGroup(markers));
    }
    
    perfMetrics.totalRenders++;
    perfMetrics.renderTime = performance.now() - startTime;
    console.log('📊 地盤渲染耗時:', perfMetrics.renderTime.toFixed(2), 'ms');
  }
  
  function selectProject(pid) {
    if (isLocating) {
      console.log('[v2.8] selectProject blocked by isLocating lock');
      return; 
    }
    
    curProject = pid;
    buildSelect();
    hideSearch(); // 🔥 [v2.19] 轉地盤時清空搜尋
    saveViewState('', null, null);
    
    if (map) {
      map.closePopup();
      setTimeout(function() { performFlyTo(pid); }, 50);
    } else {
      performFlyTo(pid);
    }
  }
  
  function performFlyTo(pid) {
    treesCache.clear();
    prjLayer.clearLayers();
    
    if (pid) {
      const p = PROJECTS.find(function(x) { return String(x.project_id) === String(pid); });
      if (p) {
        map.flyTo([+p.lat, +p.lng], Config.MAP.MAX_ZOOM, { duration: 1.2, easeLineProxy: 0.25 });
        map.once('moveend', function() { drawProjects(); drawTrees(); });
        return;
      }
    } else {
      map.flyTo(Config.MAP.DEFAULT_CENTER, Config.MAP.DEFAULT_ZOOM, { duration: 1.0, easeLineProxy: 0.25 });
      map.once('moveend', function() { drawProjects(); drawTrees(); });
      return;
    }
    
    drawProjects();
    drawTrees();
  }
  
  function drawTrees() {
    const startTime = performance.now();
    treeLayer.clearLayers();
    
    if (!curProject) {
      updateStatus('👉 請先選擇地盤，即可查看樹木');
      return;
    }
    
    const list = TREES.filter(function(t) { return String(t.project_id) === String(curProject); });
    const markers = [];
    
    list.forEach(function(t) {
      const lat = +t.lat;
      const lng = +t.lng;
      
      const color = Config.TREE_STATUS_COLORS[t.status] || Config.TREE_STATUS_COLORS.Unknown;
      
      // 🔥 [v2.17] 極簡設計：地圖上只顯示狀態色圓點，撳落去先顯示詳細資料
      const html = '<div style="width:16px;height:16px;border-radius:50%;background:' + color + ';border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45);cursor:pointer;transition:transform .15s ease;" onmouseover="this.style.transform=\'scale(1.3)\'" onmouseout="this.style.transform=\'scale(1)\'"></div>';
      
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: html,
          iconSize: [16, 16],
          iconAnchor: [8, 8],      // 🔥 圓點中心精準對齊 GPS 座標
          popupAnchor: [0, -10]
        })
      });
      
      marker._originalPos = [lat, lng];
      
      marker.on('click', function() {
        treesCache.forEach(function(m) { m.setZIndexOffset(0); });
        marker.setZIndexOffset(2000);
      });
      
      marker.bindPopup('<div style="text-align:center;padding:10px;color:#666;">載入中...</div>');
      
      marker.on('popupopen', function(e) {
        const originalHk = CoordUtils.toHK80(+t.lat, +t.lng);
        const popupHtml = 
          '<b>' + t.tree_id + ' ' + t.name + '</b><br>' +
          '<b>Status:</b> <span style="color:' + color + ';font-weight:bold;">' + t.status + '</span><br>' +
          '<b>DBH:</b> ' + (t.dbh || '-') + ' cm | <b>Height:</b> ' + (t.height || '-') + ' m<br>' +
          '<b>Spread:</b> ' + (t.spread || '-') + ' m | <b>Level:</b> ' + (t.level || '-') + ' m<br>' +
          (originalHk ? '<b>HK80：</b>N ' + CoordUtils.format1(originalHk.N) + ' / E ' + CoordUtils.format1(originalHk.E) + '<br>' : '') +
          ((t.photo_url && String(t.photo_url).indexOf('...') === -1) ? '<img class="popup-img" src="' + t.photo_url + '" style="width:100%;height:200px;object-fit:cover;display:block;margin:6px auto 0;border-radius:6px;"><br>' : '') +
          '<a href="t.html?id=' + encodeURIComponent(t.tree_id) + '&prj=' + encodeURIComponent(t.project_id || '') + '">📋 樹木頁（巡查／簽到）</a>';
        
        e.popup.setContent(DOMPurify.sanitize(popupHtml));
        
        setTimeout(function() {
          try {
            var el = e.popup.getElement();
            if (el) {
              var img = el.querySelector('img.popup-img');
              if (img && !img.complete) {
                img.addEventListener('load', function() {
                  if (e.popup && e.popup._map) e.popup.update();
                });
              } else if (e.popup && e.popup._map) {
                e.popup.update();
              }
            }
          } catch (err) {}
        }, 50);
      });
      
      markers.push(marker);
      treesCache.set(curProject + '_' + t.tree_id, marker);
      treesCache.set(t.tree_id, marker);
    });
    
    if (markers.length > 0) {
      treeLayer.addLayers(markers);
    }
    
    perfMetrics.totalRenders++;
    perfMetrics.renderTime = performance.now() - startTime;
    
    const pname = (PROJECTS.find(function(x) { return String(x.project_id) === String(curProject); }) || {}).name;
    updateStatus('✅ 地盤：' + pname + '｜顯示 ' + list.length + ' 棵樹');
  }
  
  function showPanel(html) {
    const panelContent = $('#panelContent');
    panelContent.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ['onclick'] });
    $('#panel').style.display = 'block';
    document.body.classList.add('panel-open');
  }
  
  function closePanel() {
    $('#panel').style.display = 'none';
    document.body.classList.remove('panel-open');
  }
  
  async function openProjectForm() {
    const authResult = AuthService.promptAuth();
    if (authResult instanceof Promise) { if (!await authResult) return; }
    else { if (!authResult) return; }
    
    showPanel(
      '<b>＋ 建立地盤</b>' +
      '<input id="pName" placeholder="地盤名稱（e.g. Naichung 泥涌）">' +
      '<div class="row2"><input id="pN" placeholder="HK80 N" inputmode="decimal"><input id="pE" placeholder="HK80 E" inputmode="decimal"></div>' +
      '<button onclick="App.doCreateProject()">💾 建立</button>' +
      '<button class="x" onclick="App.closePanel()">✖ 關閉</button>'
    );
  }
  
  async function doCreateProject() {
    const name = $('#pName').value;
    const N = $('#pN').value;
    const E = $('#pE').value;
    
    if (!name || !N || !E) { alert('請填寫完整'); return; }
    
    const w = CoordUtils.toWGS84(N, E);
    if (!w) { alert('HK80 座標轉換失敗'); return; }
    
    try {
      const r = await ApiService.post({
        type: 'create_project', name: name,
        lat: w.lat.toFixed(6), lng: w.lng.toFixed(6)
      });
      
      alert(r.ok ? '✅ 地盤已建立！' : '❌ ' + r.error);
      if (r.ok) {
        closePanel();
        projectMarkersCache = null;
        treesCache.clear();
        spatialIndexCache = null;
        coordGroupsCache = null;
        await load();
      }
    } catch (error) { alert('❌ 請求失敗：' + error.message); }
  }
  
  async function openTreeForm() {
    if (!curProject) { alert('請先選擇地盤'); return; }
    
    const authResult = AuthService.promptAuth();
    if (authResult instanceof Promise) { if (!await authResult) return; }
    else { if (!authResult) return; }
    
    showPanel(
      '<b>🌳 新增樹木</b>' +
      '<input id="tId" placeholder="樹木編號（留空自動）">' +
      '<input id="tName" list="tree_datalist" placeholder="選擇樹種（輸入關鍵字搜尋）...">' +
      '<datalist id="tree_datalist"></datalist>' +
      '<select id="tStatus"><option>Normal</option><option>Fair</option><option>Poor</option><option>Very Poor</option><option>Dead</option></select>' +
      '<div class="row2"><input id="tHeight" placeholder="Height (m)" inputmode="decimal"><input id="tSpread" placeholder="Spread (m)" inputmode="decimal"></div>' +
      '<input id="tDbh" placeholder="DBH (cm)" inputmode="decimal">' +
      '<div class="row2"><input id="tN" placeholder="HK80 N" inputmode="decimal"><input id="tE" placeholder="HK80 E" inputmode="decimal"></div>' +
      '<input id="tLevel" placeholder="Level (m)" inputmode="decimal">' +
      '<button onclick="App.doCreateTree()">💾 建立樹木</button>' +
      '<button class="x" onclick="App.closePanel()">✖ 關閉</button>'
    );
    
    // 🔥 [v2.18] 修復競態：showPanel 之後立即用快取填入樹種清單（首次則等 fetch 完成後填入）
    loadTreeSpecies().then(fillSpeciesDatalist);
  }
  
  async function doCreateTree() {
    const N = $('#tN').value;
    const E = $('#tE').value;
    
    if (!N || !E) { alert('請填寫 HK80 座標 N/E'); return; }
    
    const w = CoordUtils.toWGS84(N, E);
    if (!w) { alert('HK80 座標轉換失敗'); return; }
    
    try {
      const r = await ApiService.post({
        type: 'create_tree',
        tree_id: $('#tId').value, project_id: curProject,
        name: $('#tName').value, status: $('#tStatus').value,
        height: $('#tHeight').value, spread: $('#tSpread').value,
        dbh: $('#tDbh').value, level: $('#tLevel').value,
        lat: w.lat.toFixed(6), lng: w.lng.toFixed(6)
      });
      
      alert(r.ok ? '✅ 樹木 ' + r.tree_id + ' 已建立' : '❌ ' + r.error);
      if (r.ok) {
        closePanel();
        treesCache.clear();
        spatialIndexCache = null;
        coordGroupsCache = null;
        await load();
        
        const newId = String(r.tree_id);
        const nt = treeMap.get(curProject + '_' + newId) || TREES.find(function(t){ return String(t.tree_id) === newId && String(t.project_id) === curProject; });
        
        if (nt) {
          setTimeout(function() {
            map.flyTo([+nt.lat, +nt.lng], Math.max(map.getZoom(), 18), { duration: 0.8 });
            
            setTimeout(function() {
              const m = treesCache.get(curProject + '_' + newId) || treesCache.get(newId);
              if (m) {
                treesCache.forEach(function(otherM) { otherM.setZIndexOffset(0); });
                m.setZIndexOffset(2000);
                m.openPopup();
              }
              updateStatus('✅ 已定位到新樹木：' + newId);
            }, 900);
          }, 400); 
        }
      }
    } catch (error) { alert('❌ 請求失敗：' + error.message); }
  }
  
  function init() {
    statusEl = document.getElementById('status');
    
    if (initMap()) {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(function() { CoordUtils.preheatCache(); });
      } else {
        setTimeout(function() { CoordUtils.preheatCache(); }, 100);
      }
      
      // 🔥 [v2.18] 預熱樹種清單（閒時載入，開面板時即刻有）
      loadTreeSpecies();
      
      // 🔥 [v2.19] 搜尋結果點擊（事件委派）＋ 撳外面自動收埋
      const srBox = document.getElementById('searchResults');
      if (srBox) {
        srBox.addEventListener('click', function(e){
          const item = (e.target && e.target.closest) ? e.target.closest('.sr-item[data-id]') : null;
          if (item) focusTree(item.getAttribute('data-id'));
        });
      }
      document.addEventListener('click', function(e){
        if (e.target && e.target.closest && !e.target.closest('.search-wrap')) hideSearch();
      });
      
      load().then(function() { checkURLParams(); });
    }
    
    console.log('🌳 樹木管理系統已啟動（終極效能優化版 v2.20 - 地段索引圖層）');
  }
  
  function checkURLParams() {
    const params = new URLSearchParams(window.location.search);
    let treeId = params.get('tree_id');
    let projectId = params.get('project_id');
    let lat = params.get('lat');
    let lng = params.get('lng');
    
    if (!treeId && !projectId && !lat && !lng) {
      try {
        const saved = JSON.parse(localStorage.getItem('tree_map_last_view'));
        if (saved && saved.project_id) {
          projectId = saved.project_id;
          treeId = saved.tree_id;
          lat = saved.lat;
          lng = saved.lng;
          if (saved.zoom && map) {
             setTimeout(function(){ map.setZoom(saved.zoom); }, 100);
          }
        }
      } catch(e) {}
    }
    
    if (treeId || projectId || (lat && lng)) {
      setTimeout(function() { locateTree(treeId, projectId, lat, lng); }, 600);
    }
  }
  
  function locateTree(treeId, projectId, lat, lng) {
    isLocating = true; 
    
    let tree = null;
    const targetPid = projectId ? String(projectId) : '';
    
    if (treeId) {
      tree = treeMap.get(targetPid + '_' + String(treeId));
      if (!tree) {
        tree = TREES.find(function(t) { 
          return String(t.tree_id) === String(treeId) && 
                 (!targetPid || String(t.project_id) === targetPid); 
        }) || null;
      }
    }

    const finalPid = tree ? String(tree.project_id || '') : targetPid;
    const targetLat = tree ? +tree.lat : (lat ? +lat : null);
    const targetLng = tree ? +tree.lng : (lng ? +lng : null);

    if (finalPid && String(curProject) !== finalPid) {
      curProject = finalPid;
      
      const sel = $('#projSel');
      if (sel) {
        const inlineOnChange = sel.getAttribute('onchange');
        sel.removeAttribute('onchange');
        sel.onchange = null;
        
        let hasOption = false;
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value === finalPid) { hasOption = true; break; }
        }
        if (hasOption) {
          sel.value = finalPid;
        } else {
          buildSelect();
        }
        
        if (inlineOnChange) sel.setAttribute('onchange', inlineOnChange);
        else sel.onchange = function() { App.selectProject(this.value); };
      }
      $('#addTreeBtn').style.display = curProject ? 'inline-block' : 'none';
      
      treesCache.clear();
      spatialIndexCache = null;
      coordGroupsCache = null;
      drawProjects();
      drawTrees();
    }

    if (targetLat && targetLng && !isNaN(targetLat) && !isNaN(targetLng)) {
      map.flyTo([targetLat, targetLng], tree ? 19 : (map.getZoom() || Config.MAP.MAX_ZOOM), { duration: 1.2 });
      
      if (tree) {
        setTimeout(function() {
          const marker = treesCache.get(finalPid + '_' + tree.tree_id) || treesCache.get(tree.tree_id) || treesCache.get(String(treeId));
          if (marker) {
            treesCache.forEach(function(m) { m.setZIndexOffset(0); });
            marker.setZIndexOffset(2000);
            marker.openPopup();
            updateStatus('✅ 已定位到樹木：' + treeId);
          }
        }, 1400);
      }
    } else if (finalPid) {
      const p = PROJECTS.find(function(x) { return String(x.project_id) === finalPid; });
      if (p) {
        map.flyTo([+p.lat, +p.lng], Config.MAP.MAX_ZOOM, { duration: 1.2 });
      }
    }

    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    
    saveViewState(treeId, targetLat, targetLng);
    
    setTimeout(function() { 
      isLocating = false; 
    }, 2000);
  }

  function saveViewState(treeId, lat, lng) {
    try {
      localStorage.setItem('tree_map_last_view', JSON.stringify({
        project_id: curProject,
        tree_id: treeId || '',
        lat: lat || '',
        lng: lng || '',
        zoom: map ? map.getZoom() : Config.MAP.DEFAULT_ZOOM,
        time: Date.now()
      }));
    } catch(e) {}
  }
  
  function getPerfMetrics() {
    return {
      renderTime: perfMetrics.renderTime,
      cacheHits: perfMetrics.cacheHits,
      totalRenders: perfMetrics.totalRenders,
      apiStats: ApiService.getStats(),
      coordCacheStats: CoordUtils.getCacheStats()
    };
  }
  
  function clearCache() {
    projectMarkersCache = null;
    treesCache.clear();
    treeCountMap.clear();
    treeMap.clear();
    spatialIndexCache = null;
    coordGroupsCache = null;
    lotCache.clear(); // 🔥 [v2.20] 清空地段快取
    localStorage.removeItem('tree_map_last_view');
    console.log('🗑️ 緩存已清除');
  }
  
  return {
    init, selectProject, openProjectForm, doCreateProject,
    openTreeForm, doCreateTree, closePanel, clearCache,
    getPerfMetrics, locateTree, handleSearch, focusTree
  };
})();

document.addEventListener('DOMContentLoaded', App.init);