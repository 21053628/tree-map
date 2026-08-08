/**
 * 樹木管理系統 - 主應用程式模組（終極效能優化版 v2.3 - 修復新增樹木後地圖亂彈）
 * 
 * 🚀 優化重點：
 * 1. [殺手1] Popup 懶載入 (Lazy Load)
 * 2. [殺手2] 修正 removeOutsideVisibleBounds
 * 3. [殺手3] 預先計算 treeCountMap / treeMap
 * 4. [殺手4] 空間索引距離計算加入緯度 cos 修正
 * 5. [體驗] mouseout 延遲縮短至 300ms
 * 6. [體驗] 底圖切換優化
 * 7. [UI] 移除狀態列的「渲染耗時」顯示
 * 8. [v2.1] 新增樹木即刻顯示
 * 9. [v2.2] 修復 NFC / t.html 返回地圖時動畫打架導致彈錯位嘅問題
 * 10. [v2.3] 修復新增樹木後，MarkerCluster 重新渲染與 flyTo 動畫打架導致地圖亂彈嘅問題
 */

const App = (function() {
  'use strict';
  
  const API_ENDPOINT = Config.API_ENDPOINT;
  ApiService.init(API_ENDPOINT);
  initConfig(API_ENDPOINT);
  
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
  
  let perfMetrics = {
    renderTime: 0,
    cacheHits: 0,
    totalRenders: 0,
    spatialIndexBuildTime: 0
  };
  
  let resizeTimer = null;
  let loadDebounceTimer = null;
  
  let activeGroupId = -1;
  let mouseOutTimer = null;
  let coordGroupsRef = [];
  
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
    
    const layerBar = L.control({position: isMobile ? 'bottomright' : 'bottomleft'});
    layerBar.onAdd = function() {
      const div = L.DomUtil.create('div', 'layerbar');
      div.innerHTML = '<button data-l="hk" class="on">政府</button>' +
                      '<button data-l="sat">衛星</button>' +
                      '<button data-l="topo">地形</button>' +
                      '<button data-l="street">街道</button>';
      L.DomEvent.disableClickPropagation(div);
      
      div.querySelectorAll('button').forEach(function(b) {
        b.onclick = function() {
          if (currentBaseLayer) map.removeLayer(currentBaseLayer);
          currentBaseLayer = baseLayers[b.dataset.l];
          currentBaseLayer.addTo(map);
          div.querySelectorAll('button').forEach(function(x) { x.classList.toggle('on', x===b); });
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
    
    return true;
  }
  
  function updateStatus(message) {
    if (statusEl) {
      statusEl.textContent = message;
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
        treeMap.set(String(t.tree_id), t);
      });
      
      projectMarkersCache = null;
      treesCache.clear();
      spatialIndexCache = null;
      coordGroupsCache = null;
      
      buildSelect();
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
    sel.innerHTML = '<option value="">🗂️ 全部地盤</option>' +
      PROJECTS.map(function(p) { return '<option value="'+p.project_id+'">🚩 '+p.name+'</option>'; }).join('');
    sel.value = curProject;
    $('#addTreeBtn').style.display = curProject ? 'inline-block' : 'none';
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
    curProject = pid;
    buildSelect();
    
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
    
    const cacheKey = curProject;
    let coordGroups, offsetMap, treeToGroupMap;
    
    if (coordGroupsCache && coordGroupsCache.key === cacheKey) {
      perfMetrics.cacheHits++;
      coordGroups = coordGroupsCache.coordGroups;
      offsetMap = coordGroupsCache.offsetMap;
      treeToGroupMap = coordGroupsCache.treeToGroupMap;
    } else {
      buildSpatialIndex(list);
      coordGroups = spatialIndexCache.coordGroups;
      offsetMap = spatialIndexCache.offsetMap;
      treeToGroupMap = spatialIndexCache.treeToGroupMap;
    }
    
    list.forEach(function(t) {
      const coords = offsetMap.get(t.tree_id) || { original: [+t.lat, +t.lng], offset: null };
      
      const lat = coords.original[0];
      const lng = coords.original[1];
      
      const color = Config.TREE_STATUS_COLORS[t.status] || Config.TREE_STATUS_COLORS.Unknown;
      
      const html = '<div class="treeIcon">' +
                   '<span class="lbl">' + t.tree_id + '</span>' +
                   '<span class="dot" style="background:' + color + '"></span>' +
                   '</div>';
      
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: html,
          iconSize: [70, 42],
          iconAnchor: [35, 40],
          popupAnchor: [0, -34]
        })
      });
      
      marker._originalPos = coords.original;
      marker._offsetPos = coords.offset;
      marker._isOffset = false;
      marker._groupId = treeToGroupMap.get(t.tree_id);
      
      marker.on('mouseover', function(e) {
        if (mouseOutTimer) { clearTimeout(mouseOutTimer); mouseOutTimer = null; }
        
        if (marker._offsetPos && !marker._isOffset && marker._groupId !== null) {
          const groupId = marker._groupId;
          const group = coordGroupsRef[groupId];
          if (group) {
            group.forEach(function(tree) {
              const m = treesCache.get(tree.tree_id);
              if (m && m._offsetPos && !m._isOffset) {
                if (m._icon) L.DomUtil.addClass(m._icon, 'leaflet-marker-dragging');
                m.setLatLng(m._offsetPos);
                m._isOffset = true;
              }
            });
          }
          activeGroupId = groupId;
        }
      });
      
      marker.on('mouseout', handleMouseOut);
      
      marker.bindPopup('<div style="text-align:center;padding:10px;color:#666;">載入中...</div>');
      
      marker.on('popupopen', function(e) {
        const originalHk = CoordUtils.toHK80(+t.lat, +t.lng);
        const popupHtml = 
          '<b>' + t.tree_id + ' ' + t.name + '</b><br>' +
          '<b>Status:</b> ' + t.status + '<br>' +
          '<b>DBH:</b> ' + (t.dbh || '-') + ' cm | <b>Height:</b> ' + (t.height || '-') + ' m<br>' +
          '<b>Spread:</b> ' + (t.spread || '-') + ' m | <b>Level:</b> ' + (t.level || '-') + ' m<br>' +
          (originalHk ? '<b>HK80：</b>N ' + CoordUtils.format1(originalHk.N) + ' / E ' + CoordUtils.format1(originalHk.E) + '<br>' : '') +
          ((t.photo_url && String(t.photo_url).indexOf('...') === -1) ? '<img class="popup-img" src="' + t.photo_url + '"><br>' : '') +
          '<a href="t.html?id=' + encodeURIComponent(t.tree_id) + '&prj=' + encodeURIComponent(t.project_id || '') + '">📋 樹木頁（巡查／簽到）</a>';
        
        e.popup.setContent(DOMPurify.sanitize(popupHtml));
      });
      
      markers.push(marker);
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
  
  function buildSpatialIndex(list) {
    const startTime = performance.now();
    
    const gridSize = 0.00002;
    const gridMap = new Map();
    
    const treeCoords = [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const lat = +t.lat;
      const lng = +t.lng;
      treeCoords.push({ lat, lng });
      
      const gridKey = Math.floor(lat / gridSize) + '_' + Math.floor(lng / gridSize);
      if (!gridMap.has(gridKey)) gridMap.set(gridKey, []);
      gridMap.get(gridKey).push(i);
    }
    
    const avgLat = list.length > 0 ? list.reduce((sum, t) => sum + (+t.lat), 0) / list.length : 22.3;
    const lngFactor = Math.cos(avgLat * Math.PI / 180);
    
    const coordGroups = [];
    const used = new Uint8Array(list.length);
    
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      
      const group = [list[i]];
      used[i] = 1;
      const center = treeCoords[i];
      
      const centerGridX = Math.floor(center.lat / gridSize);
      const centerGridY = Math.floor(center.lng / gridSize);
      
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const neighborKey = (centerGridX + dx) + '_' + (centerGridY + dy);
          const neighbors = gridMap.get(neighborKey) || [];
          
          for (let j = 0; j < neighbors.length; j++) {
            const idx = neighbors[j];
            if (used[idx]) continue;
            
            const other = treeCoords[idx];
            const dLat = center.lat - other.lat;
            const dLng = (center.lng - other.lng) * lngFactor;
            const dist = Math.sqrt(dLat * dLat + dLng * dLng) * 111319.5; 
            
            if (dist < 5) {
              group.push(list[idx]);
              used[idx] = 1;
            }
          }
        }
      }
      coordGroups.push(group);
    }
    
    const treeToGroupMap = new Map();
    coordGroups.forEach(function(trees, groupIndex) {
      trees.forEach(function(t) { treeToGroupMap.set(t.tree_id, groupIndex); });
    });
    
    const offsetMap = new Map();
    const offsetRadius = 0.00012;
    
    for (let g = 0; g < coordGroups.length; g++) {
      const trees = coordGroups[g];
      if (trees.length === 1) {
        const t = trees[0];
        offsetMap.set(t.tree_id, { original: [+t.lat, +t.lng], offset: null });
      } else {
        const baseLat = +trees[0].lat;
        const baseLng = +trees[0].lng;
        const angleStep = (2 * Math.PI) / trees.length;
        
        for (let i = 0; i < trees.length; i++) {
          const t = trees[i];
          const angle = i * angleStep;
          const offsetLat = baseLat + offsetRadius * Math.cos(angle);
          const offsetLng = baseLng + offsetRadius * Math.sin(angle);
          offsetMap.set(t.tree_id, { original: [+t.lat, +t.lng], offset: [offsetLat, offsetLng] });
        }
      }
    }
    
    coordGroupsRef = coordGroups;
    
    window.handleMouseOut = function() {
      if (mouseOutTimer) clearTimeout(mouseOutTimer);
      mouseOutTimer = setTimeout(function() {
        if (activeGroupId !== -1) {
          const group = coordGroupsRef[activeGroupId];
          if (group) {
            group.forEach(function(tree) {
              const m = treesCache.get(tree.tree_id);
              if (m && m._isOffset) {
                if (m._icon) L.DomUtil.removeClass(m._icon, 'leaflet-marker-dragging');
                m.setLatLng(m._originalPos);
                m._isOffset = false;
              }
            });
          }
          activeGroupId = -1;
        }
      }, 300);
    };
    
    spatialIndexCache = { coordGroups, offsetMap, treeToGroupMap };
    coordGroupsCache = { key: curProject, coordGroups, offsetMap, treeToGroupMap };
    
    perfMetrics.spatialIndexBuildTime = performance.now() - startTime;
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
        await load(); // 統一使用 await
      }
    } catch (error) { alert('❌ 請求失敗：' + error.message); }
  }
  
  async function openTreeForm() {
    if (!curProject) { alert('請先選擇地盤'); return; }
    
    const authResult = AuthService.promptAuth();
    if (authResult instanceof Promise) { if (!await authResult) return; }
    else { if (!authResult) return; }
    
    if (!window.allTreesLoaded) {
      fetch('data/trees_data.json')
        .then(function(r) { return r.json(); })
        .then(function(trees) {
          const dataList = document.getElementById('tree_datalist');
          if (dataList) {
            dataList.textContent = '';
            trees.forEach(function(tree) {
              const option = document.createElement('option');
              option.value = tree.name;
              dataList.appendChild(option);
            });
          }
          window.allTreesLoaded = true;
        })
        .catch(function(err) { console.error('載入樹木資料失敗:', err); });
    }
    
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
        await load(); // 重新載入並觸發 MarkerCluster 重繪
        
        const newId = String(r.tree_id);
        // 🔥 優化：使用 O(1) 的 treeMap 查找，更穩妥
        const nt = treeMap.get(newId) || TREES.find(function(t){ return String(t.tree_id) === newId; });
        
        if (nt) {
          // 🔥 [v2.3 修復] 使用 setTimeout 避開 MarkerCluster 重新渲染時的視圖爭奪 (動畫打架)
          // 給 Cluster 400ms 時間完成內部佈局計算，然後我哋再優雅咁飛過去
          setTimeout(function() {
            map.flyTo([+nt.lat, +nt.lng], Math.max(map.getZoom(), 18), { duration: 0.8 });
            
            // 再延遲 900ms 打開 popup，確保 flyTo 動畫完成
            setTimeout(function() {
              const m = treesCache.get(newId);
              if (m) m.openPopup();
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
      
      load().then(function() { checkURLParams(); });
    }
    
    console.log('🌳 樹木管理系統已啟動（終極效能優化版 v2.3）');
  }
  
  function checkURLParams() {
    const params = new URLSearchParams(window.location.search);
    const treeId = params.get('tree_id');
    const projectId = params.get('project_id');
    const lat = params.get('lat');
    const lng = params.get('lng');
    
    if (treeId || (lat && lng)) {
      setTimeout(function() { locateTree(treeId, projectId, lat, lng); }, 600);
    }
  }
  
  function locateTree(treeId, projectId, lat, lng) {
    let tree = null;
    if (treeId) {
      tree = treeMap.get(String(treeId)) || TREES.find(function(t){ return String(t.tree_id) === String(treeId); }) || null;
    }

    const targetPid = projectId || (tree ? tree.project_id : '');
    const targetLat = tree ? +tree.lat : +lat;
    const targetLng = tree ? +tree.lng : +lng;

    if (!targetLat || !targetLng || isNaN(targetLat) || isNaN(targetLng)) {
      updateStatus('❌ 找不到樹木位置：' + (treeId || ''));
      return;
    }

    if (targetPid && String(curProject) !== String(targetPid)) {
      curProject = String(targetPid);
      buildSelect();
      treesCache.clear();
      spatialIndexCache = null;
      coordGroupsCache = null;
      drawProjects();
      drawTrees();
    }

    map.flyTo([targetLat, targetLng], 19, { duration: 1.2 });

    setTimeout(function() {
      const marker = tree ? (treesCache.get(tree.tree_id) || treesCache.get(String(treeId))) : null;
      if (marker) {
        marker.openPopup();
        updateStatus('✅ 已定位到樹木：' + treeId);
      }
    }, 1400);

    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, '', window.location.pathname);
    }
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
    console.log('🗑️ 緩存已清除');
  }
  
  return {
    init, selectProject, openProjectForm, doCreateProject,
    openTreeForm, doCreateTree, closePanel, clearCache,
    getPerfMetrics, locateTree
  };
})();

document.addEventListener('DOMContentLoaded', App.init);