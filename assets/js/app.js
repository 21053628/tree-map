/**
 * 樹木管理系統 - 主應用程式模組（改進版）
 * 
 * 改進重點：
 * 1. 模組化架構，避免全域變數污染
 * 2. 使用 Config、CoordUtils、ApiService、AuthService 模組
 * 3. 完整的錯誤處理和載入狀態反馈
 * 4. 程式碼重構，提升可維護性
 */

const App = (function() {
  'use strict';
  
  // 使用 Config 模組中的 API 端點
  const API_ENDPOINT = Config.API_ENDPOINT;
  
  // 初始化模組
  ApiService.init(API_ENDPOINT);
  initConfig(API_ENDPOINT);
  
  // DOM 元素
  let statusEl = null;
  const $ = function(s) { return document.querySelector(s); };
  
  // 應用狀態
  let PROJECTS = [];
  let TREES = [];
  let curProject = '';
  
  // 標記緩存（性能優化）
  let projectMarkersCache = null;
  let treesCache = new Map(); // key: tree_id, value: marker
  
  // 地圖物件
  let map = null;
  let treeLayer = null;
  let prjLayer = null;
  let baseLayers = {};
  let markerCluster = null;
  
  // 性能監控
  let perfMetrics = {
    renderTime: 0,
    cacheHits: 0,
    totalRenders: 0
  };
  
  /**
   * 初始化地圖
   */
  function initMap() {
    if (!window.L) {
      updateStatus('❌ 地圖元件載入失敗：請檢查網路後重新整理');
      return false;
    }
    
    map = L.map('map').setView(Config.MAP.DEFAULT_CENTER, Config.MAP.DEFAULT_ZOOM);
    
    // 底圖圖層
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
    
    // 圖層切換控制
    const layerBar = L.control({position:'bottomleft'});
    layerBar.onAdd = function() {
      const div = L.DomUtil.create('div', 'layerbar');
      div.innerHTML = '<button data-l="hk" class="on">政府</button>' +
                      '<button data-l="sat">衛星</button>' +
                      '<button data-l="topo">地形</button>' +
                      '<button data-l="street">街道</button>';
      L.DomEvent.disableClickPropagation(div);
      div.querySelectorAll('button').forEach(function(b) {
        b.onclick = function() {
          Object.keys(baseLayers).forEach(function(k) { map.removeLayer(baseLayers[k]); });
          baseLayers[b.dataset.l].addTo(map);
          div.querySelectorAll('button').forEach(function(x) { x.classList.toggle('on', x===b); });
        };
      });
      return div;
    };
    layerBar.addTo(map);
    
    // 樹木和地盤圖層（使用 MarkerCluster + 懸停散開效果）
    markerCluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      spiderfyOnMaxZoom: false, // 禁用預設蜘蛛腿，用我們自定義的懸停散開效果
      removeOutsideVisibleBounds: false, // 確保所有標記都在 DOM 中，方便懸停檢測
      disableClusteringAtZoom: 16, // 放大到 16 級後關閉聚類，顯示真實位置
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
    
    // 圖例
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
  
  /**
   * 更新狀態顯示
   */
  function updateStatus(message) {
    if (statusEl) {
      statusEl.textContent = message;
    } else {
      console.log('[Status]', message);
    }
  }
  
  /**
   * 載入資料
   */
  async function load() {
    updateStatus('🗺️ 載入中…');
    
    try {
      const [projectsRes, treesRes] = await Promise.all([
        ApiService.get('projects'),
        ApiService.get('trees')
      ]);
      
      PROJECTS = projectsRes.data || [];
      TREES = treesRes.data || [];
      
      // 重置緩存和狀態
      projectMarkersCache = null;
      treesCache.clear();
      
      buildSelect();
      drawProjects();
      drawTrees();
      
      const stats = ApiService.getStats();
      console.log('✅ 資料載入完成', stats);
      // 返回 Promise 以便鏈式調用
      return Promise.resolve();
    } catch (error) {
      updateStatus('❌ 後端連線失敗：' + error.message);
      console.error('載入失敗:', error);
    }
  }
  
  /**
   * 建立地盤選擇器
   */
  function buildSelect() {
    const sel = $('#projSel');
    sel.innerHTML = '<option value="">🗂️ 全部地盤</option>' +
      PROJECTS.map(function(p) { return '<option value="'+p.project_id+'">🚩 '+p.name+'</option>'; }).join('');
    sel.value = curProject;
    $('#addTreeBtn').style.display = curProject ? 'inline-block' : 'none';
  }
  
  /**
   * 繪製地盤標記（性能優化版）
   */
  function drawProjects() {
    const startTime = performance.now();
    prjLayer.clearLayers();
    
    // 重置緩存 - 確保每次切換地盤時都重新渲染
    projectMarkersCache = null;
    
    const markers = [];
    
    PROJECTS.forEach(function(p) {
      if (String(p.project_id) === String(curProject)) return;
      const lat = +p.lat, lng = +p.lng;
      if (!lat || !lng) return;
      
      const hk = CoordUtils.toHK80(lat, lng);
      const count = TREES.filter(function(t) { return String(t.project_id) === String(p.project_id); }).length;
      
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: '<div class="prjIcon">🚩</div>',
          iconSize: [34, 24],
          iconAnchor: [17, 12]
        })
      });
      
      marker.bindPopup(DOMPurify.sanitize(
        '<b>🚩 ' + p.name + '</b><br>' +
        '此地盤樹木：' + count + ' 棵<br>' +
        (hk ? 'HK80：N ' + CoordUtils.format1(hk.N) + ' / E ' + CoordUtils.format1(hk.E) + '<br>' : '') +
        '<button onclick="App.selectProject(\'' + p.project_id + '\')">📍 前往地盤查看樹木</button>'
      ));
      
      markers.push(marker);
    });
    
    // 批量添加到圖層
    if (markers.length > 0) {
      prjLayer.addLayer(L.layerGroup(markers));
    }
    
    perfMetrics.totalRenders++;
    perfMetrics.renderTime = performance.now() - startTime;
    console.log('📊 地盤渲染耗時:', perfMetrics.renderTime.toFixed(2), 'ms');
  }
  
  /**
   * 選擇地盤（優化動畫效果）
   */
  function selectProject(pid) {
    curProject = pid;
    
    // 先關閉 popup，避免干擾地圖操作
    if (map) {
      map.closePopup();
      // 等待 popup 完全關閉後再執行飛行動畫
      setTimeout(function() {
        performFlyTo(pid);
      }, 50);
    } else {
      performFlyTo(pid);
    }
  }
  
  /**
   * 執行飛行動畫
   */
  function performFlyTo(pid) {
    // 清空樹木緩存，確保切換地盤時不會殘留舊標記
    treesCache.clear();
    
    if (pid) {
      const p = PROJECTS.find(function(x) { return String(x.project_id) === String(pid); });
      if (p) {
        // 使用 flyTo 實現平滑飛行動畫，縮放到最大可用級別
        map.flyTo([+p.lat, +p.lng], Config.MAP.MAX_ZOOM, {
          duration: 1.2, // 動畫持續時間（秒）
          easeLineProxy: 0.25 // 平滑曲線
        });
      }
    } else {
      // 如果選擇「全部地盤」，縮放到默認視圖
      map.flyTo(Config.MAP.DEFAULT_CENTER, Config.MAP.DEFAULT_ZOOM, {
        duration: 1.0,
        easeLineProxy: 0.25
      });
    }
    
    // 先繪製地盤，再繪製樹木，確保層級正確
    drawProjects();
    drawTrees();
  }
  
  /**
   * 繪製樹木標記（真實位置顯示 + 懸停自動散開效果）
   * 所有樹木永遠顯示在真實 HK80 座標上，滑鼠移到重疊區域時自動散開
   */
  function drawTrees() {
    const startTime = performance.now();
    treeLayer.clearLayers();
    
    if (!curProject) {
      updateStatus('👉 請先選擇地盤，即可查看樹木');
      return;
    }
    
    const list = TREES.filter(function(t) { return String(t.project_id) === String(curProject); });
    const markers = [];
    
    // 第一步：按實際距離分組，找出重疊的樹木（解決極近距離問題）
    const coordGroups = [];
    const used = new Array(list.length).fill(false);
    
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      
      const group = [list[i]];
      used[i] = true;
      const center = list[i];
      
      for (let j = i + 1; j < list.length; j++) {
        if (used[j]) continue;
        const other = list[j];
        
        // 使用 Leaflet 計算實際距離（米）
        const dist = map.distance(
          [center.lat, center.lng],
          [other.lat, other.lng]
        );
        
        // 如果距離少於 2 米，視為重疊群組
        if (dist < 2) {
          group.push(other);
          used[j] = true;
        }
      }
      coordGroups.push(group);
    }
    
    // 第二步：為每棵樹計算偏移後的座標（用於懸停散開）
    const offsetMap = new Map(); // key: tree_id, value: {original: [lat, lng], offset: [lat, lng]}
    const offsetRadius = 0.00008; // 約 8 米偏移半徑
    
    coordGroups.forEach(function(trees) {
      if (trees.length === 1) {
        // 只有一棵樹，不需要偏移
        const t = trees[0];
        offsetMap.set(t.tree_id, {
          original: [+t.lat, +t.lng],
          offset: null // 無須偏移
        });
      } else {
        // 多棵樹重疊，計算圓形排列座標
        const baseLat = +trees[0].lat;
        const baseLng = +trees[0].lng;
        const angleStep = (2 * Math.PI) / trees.length;
        
        trees.forEach(function(t, index) {
          const angle = index * angleStep;
          const offsetLat = baseLat + offsetRadius * Math.cos(angle);
          const offsetLng = baseLng + offsetRadius * Math.sin(angle);
          offsetMap.set(t.tree_id, {
            original: [+t.lat, +t.lng],
            offset: [offsetLat, offsetLng]
          });
        });
      }
    });
    
    // 第三步：批量創建標記（使用原始座標，保證位置準確）
    list.forEach(function(t) {
      const coords = offsetMap.get(t.tree_id);
      if (!coords) return;
      
      // 永遠使用原始座標渲染標記
      const lat = coords.original[0];
      const lng = coords.original[1];
      
      const color = Config.TREE_STATUS_COLORS[t.status] || Config.TREE_STATUS_COLORS.Unknown;
      const hk = CoordUtils.toHK80(lat, lng);
      
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
      
      // 儲存偏移資訊到 marker 物件
      marker._originalPos = coords.original;
      marker._offsetPos = coords.offset;
      marker._isOffset = false; // 目前是否處於偏移狀態
      
      // 綁定懸停事件：滑鼠移入時散開，移出時 1.5 秒後恢復（優化動畫時間）
      let mouseOutTimer = null;
      
      marker.on('mouseover', function(e) {
        // 清除任何待處理的收回計時器
        if (mouseOutTimer) {
          clearTimeout(mouseOutTimer);
          mouseOutTimer = null;
        }
        
        if (marker._offsetPos && !marker._isOffset) {
          // 將此群組的所有標記散開
          const groupId = findGroupId(t.tree_id, coordGroups);
          if (groupId !== -1) {
            const group = coordGroups[groupId];
            group.forEach(function(tree) {
              const m = treesCache.get(tree.tree_id);
              if (m && m._offsetPos && !m._isOffset) {
                // 使用平滑動畫移動到偏移位置
                if (m._icon) {
                  L.DomUtil.addClass(m._icon, 'leaflet-marker-dragging');
                }
                m.setLatLng(m._offsetPos);
                m._isOffset = true;
              }
            });
          }
        }
      });
      
      marker.on('mouseout', function(e) {
        // 設定 1.5 秒延遲後才收回（加快回應速度）
        mouseOutTimer = setTimeout(function() {
          if (marker._isOffset) {
            // 將此群組的所有標記恢復原位
            const groupId = findGroupId(t.tree_id, coordGroups);
            if (groupId !== -1) {
              const group = coordGroups[groupId];
              group.forEach(function(tree) {
                const m = treesCache.get(tree.tree_id);
                if (m && m._isOffset) {
                  // 使用平滑動畫飛回原位
                  if (m._icon) {
                    L.DomUtil.removeClass(m._icon, 'leaflet-marker-dragging');
                  }
                  m.setLatLng(m._originalPos);
                  m._isOffset = false;
                }
              });
            }
          }
        }, 1500); // 1.5 秒延遲
      });
      
      // 在 popup 中顯示原始座標（真實 HK80 座標）
      const originalHk = CoordUtils.toHK80(+t.lat, +t.lng);
      
      marker.bindPopup(DOMPurify.sanitize(
        '<b>' + t.tree_id + ' ' + t.name + '</b><br>' +
        '<b>Status:</b> ' + t.status + '<br>' +
        '<b>DBH:</b> ' + (t.dbh || '-') + ' cm | <b>Height:</b> ' + (t.height || '-') + ' m<br>' +
        '<b>Spread:</b> ' + (t.spread || '-') + ' m | <b>Level:</b> ' + (t.level || '-') + ' m<br>' +
        (originalHk ? '<b>HK80：</b>N ' + CoordUtils.format1(originalHk.N) + ' / E ' + CoordUtils.format1(originalHk.E) + '<br>' : '') +
        ((t.photo_url && String(t.photo_url).indexOf('...') === -1) ? '<img class="popup-img" src="' + t.photo_url + '"><br>' : '') +
        '<a href="t.html?id=' + encodeURIComponent(t.tree_id) + '&prj=' + encodeURIComponent(t.project_id || '') + '">📋 樹木頁（巡查／簽到）</a>'
      ));
      
      markers.push(marker);
      treesCache.set(t.tree_id, marker);
    });
    
    // 批量添加到圖層（MarkerClusterGroup 直接加 marker）
    if (markers.length > 0) {
      treeLayer.addLayers(markers);
    }
    
    perfMetrics.totalRenders++;
    perfMetrics.renderTime = performance.now() - startTime;
    
    const pname = (PROJECTS.find(function(x) { return String(x.project_id) === String(curProject); }) || {}).name;
    updateStatus('✅ 地盤：' + pname + '｜顯示 ' + list.length + ' 棵樹｜渲染耗時 ' + perfMetrics.renderTime.toFixed(1) + 'ms');
    console.log('📊 樹木渲染耗時:', perfMetrics.renderTime.toFixed(2), 'ms, 數量:', list.length);
  }
  
  /**
   * 輔助函數：根據 tree_id 查找所屬群組索引
   */
  function findGroupId(treeId, groups) {
    for (let i = 0; i < groups.length; i++) {
      for (let j = 0; j < groups[i].length; j++) {
        if (String(groups[i][j].tree_id) === String(treeId)) {
          return i;
        }
      }
    }
    return -1;
  }
  
  /**
   * 顯示面板
   */
  function showPanel(html) {
    $('#panelContent').innerHTML = DOMPurify.sanitize(html);
    $('#panel').style.display = 'block';
    document.body.classList.add('panel-open');
  }
  
  /**
   * 關閉面板
   */
  function closePanel() {
    $('#panel').style.display = 'none';
    document.body.classList.remove('panel-open');
  }
  
  /**
   * 開啟地盤建立表單
   */
  function openProjectForm() {
    if (!AuthService.promptAuth()) return;
    
    showPanel(
      '<b>＋ 建立地盤</b>' +
      '<input id="pName" placeholder="地盤名稱（e.g. Naichung 泥涌）">' +
      '<div class="row2"><input id="pN" placeholder="HK80 N" inputmode="decimal"><input id="pE" placeholder="HK80 E" inputmode="decimal"></div>' +
      '<button onclick="App.doCreateProject()">💾 建立</button>' +
      '<button class="x" onclick="App.closePanel()">✖ 關閉</button>'
    );
  }
  
  /**
   * 建立地盤
   */
  async function doCreateProject() {
    const name = $('#pName').value;
    const N = $('#pN').value;
    const E = $('#pE').value;
    
    if (!name || !N || !E) {
      alert('請填寫完整');
      return;
    }
    
    const w = CoordUtils.toWGS84(N, E);
    if (!w) {
      alert('HK80 座標轉換失敗');
      return;
    }
    
    try {
      const r = await ApiService.post({
        type: 'create_project',
        name: name,
        lat: w.lat.toFixed(6),
        lng: w.lng.toFixed(6)
      });
      
      alert(r.ok ? '✅ 地盤已建立！' : '❌ ' + r.error);
      if (r.ok) {
        closePanel();
        // 清空緩存並重新載入，確保新地盤正確顯示
        projectMarkersCache = null;
        treesCache.clear();
        load();
      }
    } catch (error) {
      alert('❌ 請求失敗：' + error.message);
    }
  }
  
  /**
   * 開啟樹木新增表單
   */
  /**
   * 開啟新增樹木表單（加入樹木選擇器）
   */
  function openTreeForm() {
    if (!curProject) {
      alert('請先選擇地盤');
      return;
    }
    if (!AuthService.promptAuth()) return;
    
    // 載入樹木清單到 datalist（使用 trees_data.json）
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
      '<select id="tStatus">' +
        '<option>Normal</option><option>Fair</option><option>Poor</option>' +
        '<option>Very Poor</option><option>Dead</option>' +
      '</select>' +
      '<div class="row2"><input id="tHeight" placeholder="Height (m)" inputmode="decimal">' +
      '<input id="tSpread" placeholder="Spread (m)" inputmode="decimal"></div>' +
      '<input id="tDbh" placeholder="DBH (cm)" inputmode="decimal">' +
      '<div class="row2"><input id="tN" placeholder="HK80 N" inputmode="decimal">' +
      '<input id="tE" placeholder="HK80 E" inputmode="decimal"></div>' +
      '<input id="tLevel" placeholder="Level (m)" inputmode="decimal">' +
      '<button onclick="App.doCreateTree()">💾 建立樹木</button>' +
      '<button class="x" onclick="App.closePanel()">✖ 關閉</button>'
    );
  }
  
  
  /**
   * 建立樹木
   */
  async function doCreateTree() {
    const N = $('#tN').value;
    const E = $('#tE').value;
    
    if (!N || !E) {
      alert('請填寫 HK80 座標 N/E');
      return;
    }
    
    const w = CoordUtils.toWGS84(N, E);
    if (!w) {
      alert('HK80 座標轉換失敗');
      return;
    }
    
    try {
      const r = await ApiService.post({
        type: 'create_tree',
        tree_id: $('#tId').value,
        project_id: curProject,
        name: $('#tName').value,  // tName 現在包含樹種資料（如 "Acacia dealbata 銀荊"）
        status: $('#tStatus').value,
        height: $('#tHeight').value,
        spread: $('#tSpread').value,
        dbh: $('#tDbh').value,
        level: $('#tLevel').value,
        lat: w.lat.toFixed(6),
        lng: w.lng.toFixed(6)
      });
      
      alert(r.ok ? '✅ 樹木 ' + r.tree_id + ' 已建立' : '❌ ' + r.error);
      if (r.ok) {
        closePanel();
        // 清空緩存並重新載入，確保新樹木正確顯示
        treesCache.clear();
        load();
      }
    } catch (error) {
      alert('❌ 請求失敗：' + error.message);
    }
  }
  
  /**
   * 初始化應用
   */
  function init() {
    statusEl = document.getElementById('status');
    
    if (initMap()) {
      // 預熱座標快取（非阻塞）
      if ('requestIdleCallback' in window) {
        requestIdleCallback(function() {
          CoordUtils.preheatCache();
        });
      } else {
        setTimeout(function() {
          CoordUtils.preheatCache();
        }, 100);
      }
      
      load().then(function() {
        // 檢查 URL 是否有 tree_id 參數（來自 NFC 掃描）
        checkURLParams();
      });
    }
    
    console.log('🌳 樹木管理系統已啟動（改進版）');
    console.log('📊 API 統計:', ApiService.getStats());
    console.log('📊 座標快取統計:', CoordUtils.getCacheStats());
  }
  
  /**
   * 檢查 URL 參數，支援 NFC 掃描跳轉
   */
  function checkURLParams() {
    const params = new URLSearchParams(window.location.search);
    const treeId = params.get('tree_id');
    const projectId = params.get('project_id');
    
    if (treeId) {
      // 如果有 tree_id 參數，自動定位到該樹木
      setTimeout(function() {
        locateTree(treeId, projectId);
      }, 500);
    }
  }
  
  /**
   * 定位到特定樹木
   */
  function locateTree(treeId, projectId) {
    // 如果提供了 project_id，先選擇地盤
    if (projectId && String(curProject) !== String(projectId)) {
      selectProject(projectId);
    }
    
    // 尋找樹木：優先使用 tree_id + project_id 組合匹配
    let tree = null;
    if (projectId) {
      // 如果有 project_id，精確匹配 tree_id 和 project_id
      tree = TREES.find(function(t) { 
        return String(t.tree_id) === String(treeId) && String(t.project_id) === String(projectId); 
      });
    }
    
    // 如果沒找到或沒有提供 project_id，只匹配 tree_id
    if (!tree) {
      tree = TREES.find(function(t) { return String(t.tree_id) === String(treeId); });
    }
    
    if (!tree) {
      updateStatus('❌ 找不到樹木：' + treeId);
      return;
    }
    
    // 如果樹木不在當前選中的地盤，切換到該地盤
    if (String(tree.project_id) !== String(curProject)) {
      selectProject(tree.project_id);
    }
    
    // 飛到樹木位置（優化動畫）
    map.flyTo([+tree.lat, +tree.lng], 19, {
      duration: 1.2,
      easeLinearity: 0.25
    });
    
    // 找到對應的 marker 並開啟 popup
    const marker = treesCache.get(treeId);
    if (marker) {
      setTimeout(function() {
        marker.openPopup();
        updateStatus('✅ 已定位到樹木：' + treeId);
      }, 1200);
    }
    
    // 清除 URL 參數（避免重新整理時重複執行）
    if (window.history && window.history.replaceState) {
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    }
  }
  
  /**
   * 獲取性能指標
   * @returns {object}
   */
  function getPerfMetrics() {
    return {
      renderTime: perfMetrics.renderTime,
      cacheHits: perfMetrics.cacheHits,
      totalRenders: perfMetrics.totalRenders,
      apiStats: ApiService.getStats(),
      coordCacheStats: CoordUtils.getCacheStats()
    };
  }
  
  // 公開 API
  return {
    init,
    selectProject,
    openProjectForm,
    doCreateProject,
    openTreeForm,
    doCreateTree,
    closePanel,
    clearCache,
    getPerfMetrics,
    locateTree
  };

  /**
   * 清除緩存（用於數據更新後）
   */
  function clearCache() {
    projectMarkersCache = null;
    treesCache.clear();
    console.log('🗑️ 緩存已清除');
  }
})();

// 啟動應用
document.addEventListener('DOMContentLoaded', App.init);
