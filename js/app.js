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
  
  // 配置 API 端點
  const API_ENDPOINT = 'https://script.google.com/macros/s/AKfycby5Wby6nj8MPOdw5io10CakB877gY8qf3HKeckPz5MVb-to8QxUYfEH3pN_y-6hHvXj/exec';
  
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
  
  // 地圖物件
  let map = null;
  let treeLayer = null;
  let prjLayer = null;
  let baseLayers = {};
  
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
    
    // 樹木和地盤圖層
    treeLayer = L.layerGroups().addTo(map);
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
      
      buildSelect();
      drawProjects();
      drawTrees();
      
      const stats = ApiService.getStats();
      console.log('✅ 資料載入完成', stats);
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
   * 繪製地盤標記
   */
  function drawProjects() {
    prjLayer.clearLayers();
    PROJECTS.forEach(function(p) {
      if (String(p.project_id) === String(curProject)) return;
      const lat = +p.lat, lng = +p.lng;
      if (!lat || !lng) return;
      
      const hk = CoordUtils.toHK80(lat, lng);
      const count = TREES.filter(function(t) { return String(t.project_id) === String(p.project_id); }).length;
      
      L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: '<div class="prjIcon">🚩</div>',
          iconSize: [34, 24],
          iconAnchor: [17, 12]
        })
      })
      .addTo(prjLayer)
      .bindPopup(
        '<b>🚩 ' + p.name + '</b><br>' +
        '此地盤樹木：' + count + ' 棵<br>' +
        (hk ? 'HK80：N ' + CoordUtils.format1(hk.N) + ' / E ' + CoordUtils.format1(hk.E) + '<br>' : '') +
        '<button onclick="App.selectProject(\'' + p.project_id + '\')">📍 前往地盤查看樹木</button>'
      );
    });
  }
  
  /**
   * 選擇地盤
   */
  function selectProject(pid) {
    curProject = pid;
    if (map) map.closePopup();
    buildSelect();
    
    if (pid) {
      const p = PROJECTS.find(function(x) { return String(x.project_id) === String(pid); });
      if (p) map.flyTo([+p.lat, +p.lng], 18);
    }
    
    drawProjects();
    drawTrees();
  }
  
  /**
   * 繪製樹木標記
   */
  function drawTrees() {
    treeLayer.clearLayers();
    
    if (!curProject) {
      updateStatus('👉 請先選擇地盤，即可查看樹木');
      return;
    }
    
    const list = TREES.filter(function(t) { return String(t.project_id) === String(curProject); });
    
    list.forEach(function(t) {
      const lat = +t.lat, lng = +t.lng;
      if (!lat || !lng) return;
      
      const color = Config.TREE_STATUS_COLORS[t.status] || Config.TREE_STATUS_COLORS.Unknown;
      const hk = CoordUtils.toHK80(lat, lng);
      
      const html = '<div class="treeIcon">' +
                   '<span class="lbl">' + t.tree_id + '</span>' +
                   '<span class="dot" style="background:' + color + '"></span>' +
                   '</div>';
      
      L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: html,
          iconSize: [70, 42],
          iconAnchor: [35, 40],
          popupAnchor: [0, -34]
        })
      })
      .addTo(treeLayer)
      .bindPopup(
        '<b>' + t.tree_id + ' ' + t.name + '</b><br>' +
        '<i>' + t.species + '</i><br>' +
        '<b>Status:</b> ' + t.status + '<br>' +
        '<b>DBH:</b> ' + (t.dbh || '-') + ' cm | <b>Height:</b> ' + (t.height || '-') + ' m<br>' +
        '<b>Spread:</b> ' + (t.spread || '-') + ' m | <b>Level:</b> ' + (t.level || '-') + ' m<br>' +
        (hk ? '<b>HK80：</b>N ' + CoordUtils.format1(hk.N) + ' / E ' + CoordUtils.format1(hk.E) + '<br>' : '') +
        ((t.photo_url && String(t.photo_url).indexOf('...') === -1) ? '<img class="popup-img" src="' + t.photo_url + '"><br>' : '') +
        '<a href="t.html?id=' + encodeURIComponent(t.tree_id) + '&prj=' + encodeURIComponent(t.project_id || '') + '">📋 樹木頁（巡查／簽到）</a>'
      );
    });
    
    const pname = (PROJECTS.find(function(x) { return String(x.project_id) === String(curProject); }) || {}).name;
    updateStatus('✅ 地盤：' + pname + '｜顯示 ' + list.length + ' 棵樹');
  }
  
  /**
   * 顯示面板
   */
  function showPanel(html) {
    $('#panelContent').innerHTML = html;
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
        load();
      }
    } catch (error) {
      alert('❌ 請求失敗：' + error.message);
    }
  }
  
  /**
   * 開啟樹木新增表單
   */
  function openTreeForm() {
    if (!curProject) {
      alert('請先選擇地盤');
      return;
    }
    if (!AuthService.promptAuth()) return;
    
    showPanel(
      '<b>🌳 新增樹木</b>' +
      '<input id="tId" placeholder="樹木編號（留空自動）">' +
      '<input id="tName" placeholder="名稱">' +
      '<input id="tSpecies" placeholder="樹種">' +
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
        name: $('#tName').value,
        species: $('#tSpecies').value,
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
      load();
    }
    
    console.log('🌳 樹木管理系統已啟動（改進版）');
    console.log('📊 API 統計:', ApiService.getStats());
  }
  
  // 公開 API
  return {
    init,
    selectProject,
    openProjectForm,
    doCreateProject,
    openTreeForm,
    doCreateTree,
    closePanel
  };
})();

// 啟動應用
document.addEventListener('DOMContentLoaded', App.init);
