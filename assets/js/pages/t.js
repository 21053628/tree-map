import {
  escapeHtml,
  sanitizeId,
  format1,
  format5
} from '../core/utils.js';
import * as TDUtils from './tree-detail/td-utils.js';
import * as TDPhotos from './tree-detail/td-photos.js';
import * as TDLogs from './tree-detail/td-logs.js';

 // 依賴：config.js（Config）、api.js（ApiService）、auth.js（AuthService）、
 //       tree-detail modules 及 core/utils.js 由本入口直接 import
  const API = (typeof Config !== 'undefined' && Config.API_ENDPOINT)
    ? Config.API_ENDPOINT
    : '';

  // 🔥 [Phase6] 初始化共用 API service，移除各頁散落的 fetch endpoint 設定
  // 注意：api.js 用 const 建立 ApiService（非同 window property），故用 global 變數檢查
  if (typeof ApiService !== 'undefined' && Config.API_ENDPOINT) {
    ApiService.init(Config.API_ENDPOINT);
  }

  const $ = function(s){ return document.querySelector(s); };

  // 🔥 [Phase6] 座標轉換收斂到共用 CoordLazy service（保留 lazy proj4 效能）
  const toHK = window.CoordLazy ? window.CoordLazy.toHK : function(){ return Promise.resolve(null); };
  const toWGS = window.CoordLazy ? window.CoordLazy.toWGS : function(){ return Promise.resolve(null); };

  const f1 = format1;
  const f5 = format5;

  const params = new URLSearchParams(location.search);
  const TD = window.TD;
  TD.id = sanitizeId(params.get('id') || params.get('tree_id') || '');
  TD.prj = sanitizeId(params.get('prj') || params.get('project_id') || '');
  TD.TREE = null;

  window.goBackToMap = function(e){
    try {
      if (document.referrer && document.referrer.indexOf('index.html') !== -1 && history.length > 1) {
        e.preventDefault();
        history.back();
        return false;
      }
    } catch(err){}
    return true;
  };

  // 🔥 [Phase6] 認證收斂到共用 AuthService，刪除內嵌重複登入邏輯。
  // 保留原離線特判：離線且無有效 token 時，直接提示，不要空等網路。
  async function staffOk(){
    if (typeof AuthService !== 'undefined' && AuthService.isAuthenticated()) return true;

    if(!navigator.onLine) {
      alert('📴 離線模式：登入已過期，請連接網路後重新驗證。');
      return false;
    }

    if (typeof AuthService !== 'undefined') {
      return await AuthService.promptAuth('🔒 請輸入工作人員密碼：');
    }
    return false;
  }

  if (!TD.id) {
    $('#app').innerHTML = '<div class="card error">❌ 缺少樹木編號：請由地圖選擇樹木後再開啟此頁。</div>';
  } else {
    fetch(API + '?action=tree&id=' + encodeURIComponent(TD.id) + '&prj=' + encodeURIComponent(TD.prj))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.error === 'OFFLINE') {
          $('#app').innerHTML = '<div class="card error">📴 離線模式：暫無此樹木的快取資料，請連線後再試。</div>';
          return;
        }
        const t = res.data;
        if(!t){
          $('#app').innerHTML = '<div class="card error">❌ 找不到樹木：<b>' + escapeHtml(TD.id) + '</b></div>';
          return;
        }
        TD.TREE = t; render(t); initMiniMap(t); TDLogs.loadLogs();
      })
      .catch(function(err){
        console.error('Fetch error:', err);
        $('#app').innerHTML = '<div class="card error">❌ 後端連線失敗：<br>' + escapeHtml(err.message) + '</div>';
      });
  }

  async function render(t){
    const hkPromise = toHK(t.lat, t.lng);
    var html = '<a class="back" id="backBtn" href="index.html?tree_id=' + encodeURIComponent(t.tree_id) + '&project_id=' + encodeURIComponent(t.project_id || '') + '&lat=' + encodeURIComponent(t.lat) + '&lng=' + encodeURIComponent(t.lng) + '">⬅ 地圖</a>' +
    '<div class="tree-tabs" role="tablist" aria-label="樹木資料分頁">' +
      '<button type="button" class="tree-tab" id="overviewTab" role="tab" aria-selected="true" aria-controls="overviewPanel" tabindex="0">📋 樹木概覽</button>' +
      '<button type="button" class="tree-tab" id="inspectionTab" role="tab" aria-selected="false" aria-controls="inspectionPanel" tabindex="-1">📝 巡查簽到</button>' +
      '<button type="button" class="tree-tab" id="editTab" role="tab" aria-selected="false" aria-controls="editPanel" tabindex="-1">✏️ 編輯資產</button>' +
    '</div>' +
    '<section class="tab-panel" id="overviewPanel" role="tabpanel" aria-labelledby="overviewTab">' +
      '<div class="card">' +
        '<h1>' + escapeHtml(t.tree_id) + ' ' + escapeHtml(t.name) + '</h1>' +
        '<div style="margin-top:8px"><span class="badge" style="background:' + (TDUtils.COLORS[t.status]||'#757575') + '">Status: ' + escapeHtml(t.status) + '</span></div>';
    if(t.project_id){
      html += '<div style="margin-top:6px"><span class="badge" style="background:#1976d2">🚩 地盤：<b>' + escapeHtml(t.project_id) + '</b></span> <span style="font-size:12px;color:#666;margin-left:6px">(NFC 用)</span></div>';
    }
    var mainPhotos = t.photo_url;
    if(mainPhotos){
      if(typeof mainPhotos === 'string' && mainPhotos.indexOf('...') !== -1){
        mainPhotos = null;
      } else if(typeof mainPhotos === 'string'){
        mainPhotos = [mainPhotos];
      }
    }
    if(mainPhotos && mainPhotos.length > 0){
      for(var i = 0; i < mainPhotos.length; i++){
        const isLCP = (i === 0);
        const loadingAttr = isLCP ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
        html += '<div class="image-shell is-loading">' +
          '<div class="image-skeleton sk" aria-hidden="true"></div>' +
          '<img class="tree zoomable-img" src="' + escapeHtml(mainPhotos[i]) + '" alt="' + escapeHtml(t.name) + '" ' + loadingAttr + ' decoding="async" crossorigin="anonymous" referrerpolicy="no-referrer">' +
          '<div class="image-fallback" role="status">圖片暫時無法載入</div>' +
          '</div>';
      }
    }
    html += '<div class="grid">' +
          '<div>Tree Height<b class="numeric">' + (t.tree_height||t.height||'-') + ' m</b></div>' +
          '<div>Crown Width<b class="numeric">' + (t.crown_width||t.spread||'-') + ' m</b></div>' +
          '<div>DBH<b class="numeric">' + (t.dbh||'-') + ' m</b></div>' +
          '<div>Ground Dia.<b class="numeric">' + (t.ground_diameter||'-') + ' m</b></div>' +
          '<div>Stem Length<b class="numeric">' + (t.stem_length||'-') + ' m</b></div>' +
          '<div>Crown Area<b class="numeric">' + (t.crown_area||'-') + ' ㎡</b></div>' +
          '<div>Crown Vol.<b class="numeric">' + (t.crown_volume||'-') + ' m³</b></div>' +
        '</div>' +
        '<div class="sub" style="margin-top:8px">' + escapeHtml(t.description||'') + '</div>' +
        '<div class="sub" style="margin-top:6px">📍 <b>HK80：</b>N <span id="hk80N" class="numeric">—</span> ／ E <span id="hk80E" class="numeric">—</span> ｜ <b>Level：</b><span class="numeric">' + (t.level||'-') + '</span> m</div>' +
        '<div class="sub">WGS84：<span class="numeric">' + f5(t.lat) + ', ' + f5(t.lng) + '</span></div>' +
        '<div id="minimap"></div>' +
      '</div>' +
      '<div class="card"><button class="btn-accent" id="goNfcBtn">📱 一鍵寫入 NFC tag</button></div>' +
      '<div class="card"><b>📋 巡查歷史</b><div id="logs"><div class="log">載入中…</div></div></div>' +
    '</section>' +
    '<section class="tab-panel" id="inspectionPanel" role="tabpanel" aria-labelledby="inspectionTab" hidden>' +
      '<div class="card" id="inspectionContent"><div class="staff-placeholder">需要工作人員驗證才能使用巡查簽到</div></div>' +
    '</section>' +
    '<section class="tab-panel" id="editPanel" role="tabpanel" aria-labelledby="editTab" hidden>' +
      '<div class="card" id="editContent"><div class="staff-placeholder">需要工作人員驗證才能編輯樹木資料</div></div>' +
    '</section>' +
    '<div id="imgModal" class="modal">' +
      '<span class="modal-close">&times;</span>' +
      '<img id="modalImg" src="" alt="放大圖片" crossorigin="anonymous" referrerpolicy="no-referrer">' +
    '</div>';
    $('#app').innerHTML = TDUtils.sanitizeHTML(html);
    setupImageLoadingStates($('#app'));
    setupTabs();

    // 🔥 [CSP] 移除 inline onclick，改為 addEventListener / 事件委派
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
      backBtn.addEventListener('click', function(e){ window.goBackToMap(e); });
    }

    const goNfcBtn = document.getElementById('goNfcBtn');
    if (goNfcBtn) goNfcBtn.addEventListener('click', window.goNFC);

    // 相片放大 + modal 關閉：事件委派（只綁定一次）
    if (!window._tPageDelegated) {
      window._tPageDelegated = true;
      // [Phase11] Esc 關閉相片放大（並還原同步按鈕）
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var modal = document.getElementById('imgModal');
        if (modal && modal.classList.contains('show')) window.closeZoom();
      });
      $('#app').addEventListener('click', function(e){
        const zoomImg = (e.target && e.target.closest) ? e.target.closest('.zoomable-img') : null;
        if (zoomImg) {
          e.stopPropagation();
          window.zoomImage(zoomImg.src);
          return;
        }
        const modal = document.getElementById('imgModal');
        if (modal && modal.classList.contains('show')) {
          if (e.target === modal || (e.target.classList && e.target.classList.contains('modal-close'))) {
            window.closeZoom();
          }
        }
      });
    }

    const hk = await hkPromise;
    if(hk){
      const elN = document.getElementById('hk80N');
      const elE = document.getElementById('hk80E');
      if(elN) elN.textContent = f1(hk.N);
      if(elE) elE.textContent = f1(hk.E);
    }
  }

  function setupImageLoadingStates(root){
    if (!root) return;
    root.querySelectorAll('.image-shell').forEach(function(shell){
      const img = shell.querySelector('img');
      if (!img) return;

      function markLoaded(){
        shell.classList.remove('is-loading', 'is-error');
      }

      function markError(){
        shell.classList.remove('is-loading');
        shell.classList.add('is-error');
      }

      img.addEventListener('load', markLoaded, { once: true });
      img.addEventListener('error', markError, { once: true });

      if (img.complete) {
        if (img.naturalWidth > 0) markLoaded();
        else markError();
      }
    });
  }

  function setupTabs(){
    const tabs = Array.from(document.querySelectorAll('.tree-tab'));
    if (!tabs.length) return;

    let activeTab = tabs[0];

    function setActive(tab){
      const panelId = tab.getAttribute('aria-controls');
      tabs.forEach(function(item){
        const selected = item === tab;
        item.setAttribute('aria-selected', selected ? 'true' : 'false');
        item.setAttribute('tabindex', selected ? '0' : '-1');
      });
      document.querySelectorAll('.tab-panel').forEach(function(panel){
        panel.hidden = panel.id !== panelId;
      });
      activeTab = tab;
    }

    async function selectTab(tab, shouldFocus){
      if (!tab || tab === activeTab) {
        if (shouldFocus && tab) tab.focus();
        return;
      }

      const panelId = tab.getAttribute('aria-controls');
      if (panelId !== 'overviewPanel' && !staffInitialized) {
        const authorized = await staffMode();
        if (!authorized) {
          if (shouldFocus) activeTab.focus();
          return;
        }
      }

      setActive(tab);
      if (shouldFocus) tab.focus();
    }

    tabs.forEach(function(tab, index){
      tab.addEventListener('click', function(){ selectTab(tab, false); });
      tab.addEventListener('keydown', function(e){
        let nextIndex = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          nextIndex = (index + 1) % tabs.length;
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          nextIndex = (index - 1 + tabs.length) % tabs.length;
        } else if (e.key === 'Home') {
          nextIndex = 0;
        } else if (e.key === 'End') {
          nextIndex = tabs.length - 1;
        }
        if (nextIndex !== -1) {
          e.preventDefault();
          selectTab(tabs[nextIndex], true);
        }
      });
    });

    setActive(tabs[0]);
  }

  function initMiniMap(t){
    const lat=+t.lat, lng=+t.lng;
    if(!lat||!lng) return;

    let retries = 0;
    function tryInit() {
      if (!window.L) {
        if (retries < 50) { retries++; setTimeout(tryInit, 100); }
        return;
      }

      requestAnimationFrame(function() {
        requestAnimationFrame(function() {
          const minimapEl = document.getElementById('minimap');
          if (!minimapEl) return;

          if (minimapEl.offsetWidth === 0 || minimapEl.offsetHeight === 0) {
            setTimeout(function(){ tryInit(); }, 150);
            return;
          }

          const mm = L.map('minimap',{zoomControl:false, attributionControl:false,
                         dragging:false, scrollWheelZoom:false, doubleClickZoom:false})
                       .setView([lat,lng], 18);
          L.tileLayer('https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/wgs84/{z}/{x}/{y}.png',{maxZoom:19}).addTo(mm);
          L.tileLayer('https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/tc/wgs84/{z}/{x}/{y}.png',{maxZoom:19}).addTo(mm);
          L.circleMarker([lat,lng],{color:'#fff',weight:2,radius:9,
            fillColor:TDUtils.COLORS[t.status]||'#757575',fillOpacity:.9}).addTo(mm);

          mm.invalidateSize();
        });
      });
    }

    tryInit();
  }

  let staffInitialized = false;
  let staffInitPromise = null;

  async function staffMode(){
    if (staffInitialized) return true;
    if (staffInitPromise) return staffInitPromise;

    staffInitPromise = (async function(){
      if(!await staffOk()) return false;

      const inspectionContent = document.getElementById('inspectionContent');
      const editContent = document.getElementById('editContent');
      if (!inspectionContent || !editContent) return false;

      const hk = await toHK(TD.TREE.lat, TD.TREE.lng);
      inspectionContent.innerHTML =
        '<button id="checkinBtn">✅ 簽到</button>' +
        '<hr><div class="section-title">📝 巡查記錄（狀態會自動同步樹木資料）</div>' +
        '<select id="health"><option>Normal</option><option>Fair</option><option>Poor</option><option>Very Poor</option><option>Dead</option></select>' +
        '<textarea id="note" rows="2" placeholder="備註"></textarea>' +
        '<input type="file" id="photo" class="photo-file-input" accept="image/*" multiple>' +
        '<label class="btn-neutral photo-picker-btn" for="photo" style="margin-top:10px">📷 選擇相片（支援多張／相簿）</label>' +
        '<div id="photoPreviewContainer" class="photo-preview-container" style="display:none">' +
          '<div class="photo-count">已選擇 <b id="photoCount">0</b> 張相片</div>' +
          '<div id="photoPreviewGrid" class="photo-preview-grid"></div>' +
        '</div>' +
        '<button id="submitInspectionBtn" style="margin-top:10px">📤 上傳巡查記錄</button>';

      editContent.innerHTML =
        '<div class="section-title">✏️ 樹木資料（HK80 座標／Level／地盤）</div>' +
        '<div class="form-group"><label class="form-label">🆔 樹木編號</label><input id="eTreeId" value="' + escapeHtml(TD.TREE.tree_id) + '"></div>' +
        '<div class="form-group"><label class="form-label">🌳 樹種</label><input id="eName" list="tree_list" placeholder="選擇樹種（輸入關鍵字搜尋）..."></div>' +
        '<datalist id="tree_list"></datalist>' +
        '<div class="form-group"><label class="form-label">📊 健康狀況</label><select id="eStatus"><option>Normal</option><option>Fair</option><option>Poor</option><option>Very Poor</option><option>Dead</option></select></div>' +
        '<div class="form-group"><label class="form-label">🚩 所屬地盤</label><select id="eProject"></select></div>' +
        '<div class="row2"><div class="form-group"><label class="form-label">Tree Height (m)</label><input id="eHeight" placeholder="樹高" inputmode="decimal"></div><div class="form-group"><label class="form-label">Crown Width (m)</label><input id="eSpread" placeholder="冠寬" inputmode="decimal"></div></div>' +
        '<div class="row2"><div class="form-group"><label class="form-label">DBH (m)</label><input id="eDbh" placeholder="胸徑" inputmode="decimal"></div><div class="form-group"><label class="form-label">Ground Dia. (m)</label><input id="eGroundDia" placeholder="地徑" inputmode="decimal"></div></div>' +
        '<div class="row2"><div class="form-group"><label class="form-label">Stem Length (m)</label><input id="eStemLen" placeholder="幹長" inputmode="decimal"></div><div class="form-group"><label class="form-label">Crown Area (㎡)</label><input id="eCrownArea" placeholder="投影面積" inputmode="decimal"></div></div>' +
        '<div class="form-group"><label class="form-label">Crown Volume (m³)</label><input id="eCrownVol" placeholder="冠幅體積" inputmode="decimal"></div>' +
        '<div class="row2"><div class="form-group"><label class="form-label">HK80 N (Northing)</label><input id="eN" placeholder="北座標" inputmode="decimal"></div><div class="form-group"><label class="form-label">HK80 E (Easting)</label><input id="eE" placeholder="東座標" inputmode="decimal"></div></div>' +
        '<div class="form-group"><label class="form-label">Level (m，高程)</label><input id="eLevel" placeholder="高程" inputmode="decimal"></div>' +
        '<div class="form-group"><label class="form-label">📄 簡介</label><textarea id="eDesc" rows="2" placeholder="樹木簡介"></textarea></div>' +
        '<button id="saveTreeInfoBtn">💾 儲存樹木資料</button>';

      // 🔥 [CSP] 移除 inline onclick，改為 addEventListener
      const checkinBtn = document.getElementById('checkinBtn');
      if (checkinBtn) checkinBtn.addEventListener('click', function(){ checkin(); });

      const submitInspectionBtn = document.getElementById('submitInspectionBtn');
      if (submitInspectionBtn) {
        submitInspectionBtn.addEventListener('click', function(){ submitInspection(); });
      }

      const saveTreeInfoBtn = document.getElementById('saveTreeInfoBtn');
      if (saveTreeInfoBtn) {
        saveTreeInfoBtn.addEventListener('click', function(){ saveTreeInfo(); });
      }

      TDPhotos.initPhotoPreview();

      $('#eStatus').value = TD.TREE.status || 'Normal';
      $('#eName').value = TD.TREE.name || '';
      $('#eHeight').value = TD.TREE.tree_height || TD.TREE.height || '';
      $('#eSpread').value = TD.TREE.crown_width || TD.TREE.spread || '';
      $('#eDbh').value = TD.TREE.dbh || '';
      $('#eGroundDia').value = TD.TREE.ground_diameter || '';
      $('#eStemLen').value = TD.TREE.stem_length || '';
      $('#eCrownArea').value = TD.TREE.crown_area || '';
      $('#eCrownVol').value = TD.TREE.crown_volume || '';
      $('#eN').value = hk ? f1(hk.N) : '';
      $('#eE').value = hk ? f1(hk.E) : '';
      $('#eLevel').value = TD.TREE.level || '';
      $('#eDesc').value = TD.TREE.description || '';

      fetch(API + '?action=projects').then(function(r){ return r.json(); }).then(function(res){
        const opts = (res.data || []).map(function(p){
          return '<option value="' + escapeHtml(p.project_id) + '">🚩 ' + escapeHtml(p.name) + '</option>';
        }).join('');
        $('#eProject').innerHTML = '<option value="">（不屬任何地盤）</option>' + opts;
        $('#eProject').value = TD.TREE.project_id || '';
      });

      if(!window.allTreesLoaded){
        fetch('data/trees_data.json')
          .then(function(r){ return r.json(); })
          .then(function(trees){
            const dataList = document.getElementById('tree_list');
            if (!dataList) return;
            trees.forEach(function(tree){
              const option = document.createElement('option');
              option.value = tree.name;
              dataList.appendChild(option);
            });
            window.allTreesLoaded = true;
          })
          .catch(function(err){ console.error('載入樹木資料失敗:', err); });
      }

      staffInitialized = true;
      return true;
    })();

    try {
      return await staffInitPromise;
    } finally {
      if (!staffInitialized) staffInitPromise = null;
    }
  }

  // ========== [Phase4] 提交前驗證 ==========
  function requireTreeId(){
    if (!TD.id) { alert('⚠️ 缺少樹木編號（tree_id），請由地圖選擇樹木'); return false; }
    return true;
  }

  function requireStaff(v){
    if (!v || !String(v).trim()) { alert('⚠️ 工作人員姓名（staff）必填'); return false; }
    return true;
  }

  async function checkin(){
    if (!requireTreeId()) return;
    const staff = prompt('工作人員姓名：');
    if (!requireStaff(staff)) return;
    const meta = ApiService.newClientMeta();
    try {
      const r = await post({type:'checkin', staff:staff, tree_id:TD.id, prj:TD.prj,
        client_id: meta.client_id, client_created_at: meta.client_created_at});
      alert(r.ok ? '✅ 簽到成功！' : '❌ 失敗：' + r.error);
      if(r.ok && r.queued) { /* 離線暫存不刷新 */ }
      else if(r.ok) { setTimeout(function(){ location.reload(); }, 800); }
    } catch(err) {
      alert('❌ 連線錯誤：' + err.message);
    }
  }

  async function submitInspection(){
    if (!requireTreeId()) return;
    const staff  = prompt('工作人員姓名：');
    if (!requireStaff(staff)) return;
    if (!TDUtils.isValidHealth($('#health').value)) {
      alert('⚠️ 樹木健康狀態（health）不合法：' + $('#health').value);
      return;
    }
    if (TD.selectedPhotos.length > TDUtils.MAX_PHOTOS) {
      alert('⚠️ 相片數量超出上限（最多 ' + TDUtils.MAX_PHOTOS + ' 張）');
      return;
    }

    const health = $('#health').value;
    const note = $('#note').value;
    const meta = ApiService.newClientMeta();

    // 沒有相片：純文字記錄（保持原有 photo_base64:'' 行為）
    if (TD.selectedPhotos.length === 0) {
      try {
        const r = await post({type:'inspection', staff:staff, tree_id:TD.id, prj:TD.prj,
          health:health, note:note, photo_base64:'',
          client_id: meta.client_id, client_created_at: meta.client_created_at});
        alert(r.ok ? '✅ 已上傳！' : '❌ 失敗：' + r.error);
        if(r.ok && !r.queued) { setTimeout(function(){ location.reload(); }, 1000); }
      } catch(err) {
        alert('❌ 連線錯誤：' + err.message);
      }
      return;
    }

    // [Phase5] 逐張壓縮；失敗／超大的相片略過，不會拖垮整筆文字記錄
    const photosData = [];
    const skipped = [];
    for(let i = 0; i < TD.selectedPhotos.length; i++){
      try {
        const b64 = await TDUtils.compress(TD.selectedPhotos[i]);
        if (b64 && b64.length > TDUtils.MAX_PHOTO_CHARS) { skipped.push(i + 1); continue; }
        photosData.push(b64);
      } catch(err) {
        skipped.push(i + 1);
      }
    }
    if (skipped.length) {
      alert('⚠️ 第 ' + skipped.join('、') + ' 張相片處理失敗，已略過；其餘 ' + photosData.length + ' 張繼續上傳');
    }
    if (photosData.length === 0) {
      alert('❌ 沒有相片可上傳（全部處理失敗）');
      return;
    }

    // [Phase5] 兩階段上傳（需後端支援 inspection_photo + inspection 回傳 inspection_id）
    // 離線時不使用兩階段（拿不到 inspection_id），直接落入單一 POST 排隊
    const splitPhotos = navigator.onLine && (typeof Config !== 'undefined' && Config.INSPECTION_SPLIT_PHOTOS === true);
    if (splitPhotos) {
      try {
        const r = await post({
          type:'inspection', staff:staff, tree_id:TD.id, prj:TD.prj,
          health:health, note:note, photo_base64:'', photos_total: photosData.length,
          photos_pending: photosData.length,
          client_id: meta.client_id, client_created_at: meta.client_created_at
        });
        if (r.queued) {
          alert('📥 文字記錄已離線暫存（兩階段相片需後端回傳 inspection_id，請連線後重試）');
          return;
        }
        if (r.ok && r.inspection_id) {
          const done = await uploadPhotos(r.inspection_id, photosData);
          alert('✅ 文字記錄已上傳；相片 ' + done + '/' + photosData.length + ' 張已處理');
          TD.selectedPhotos = []; setTimeout(function(){ location.reload(); }, 1000);
        } else if (r.ok) {
          alert('⚠️ 文字記錄已上傳，但後端未回傳 inspection_id，相片未能上傳');
          TD.selectedPhotos = []; setTimeout(function(){ location.reload(); }, 1000);
        } else {
          alert('❌ 失敗：' + r.error);
        }
      } catch(err) {
        alert('❌ 連線錯誤：' + err.message);
      }
      return;
    }

    // 預設：單一 POST（後端未支援兩階段，保留現有行為）
    const payload = {
      type:'inspection', staff:staff, tree_id:TD.id, prj:TD.prj,
      health:health, note:note, photo_base64: photosData,
      client_id: meta.client_id, client_created_at: meta.client_created_at
    };
    try {
      const r = await post(payload);
      alert(r.ok ? '✅ 已上傳 ' + photosData.length + ' 張相片！' : '❌ 失敗：' + r.error);
      if(r.ok && !r.queued) { TD.selectedPhotos = []; setTimeout(function(){ location.reload(); }, 1000); }
    } catch(err) {
      alert('❌ 連線錯誤：' + err.message);
    }
  }
  // [Phase5] 兩階段相片上傳：逐張傳（各自有 client_id，失敗由 offline queue 獨立重試）
  async function uploadPhotos(inspectionId, photosData){
    const total = photosData.length;
    let done = 0;
    for(let i = 0; i < total; i++){
      const pm = ApiService.newClientMeta();
      const r = await post({
        type:'inspection_photo', inspection_id: inspectionId,
        tree_id:TD.id, prj:TD.prj, photo_base64: photosData[i], photo_index: i + 1,
        client_id: pm.client_id, client_created_at: pm.client_created_at
      });
      if (r && (r.ok || r.queued)) done++;
      updatePhotoProgress(done, total);
    }
    return done;
  }

  // [Phase5] 顯示「x/N 張相片已上傳」
  function updatePhotoProgress(done, total){
    const el = $('#photoCount');
    if (el) el.textContent = done + '/' + total;
    if (typeof pwaToast === 'function') pwaToast('📷 ' + done + '/' + total + ' 張相片已處理');
  }

  async function saveTreeInfo(){
    if (!requireTreeId()) return;
    if (!TDUtils.isValidHealth($('#eStatus').value)) {
      alert('⚠️ 樹木健康狀態（status）不合法：' + $('#eStatus').value);
      return;
    }
    const newId = ($('#eTreeId') ? $('#eTreeId').value.trim() : '');
    if (!newId) { alert('⚠️ 樹木編號不可為空'); return; }
    if (newId.length > 64 || !/^[\p{L}\p{N}._-]+$/u.test(newId)) {
      alert('⚠️ 樹木編號格式不正確（只可用英數、中文、點、底線、連字號）'); return;
    }
    let lat = TD.TREE.lat, lng = TD.TREE.lng;
    const N = $('#eN').value, E = $('#eE').value;
    if(N || E){
      if (!TDUtils.isValidHK80(N, E)) {
        alert('⚠️ HK80 位置錯誤：請輸入香港範圍內的 HK80 N/E 座標。');
        return;
      }
      const w = await toWGS(N, E);
      if(!w){ alert('HK80 座標轉換失敗，請檢查 N/E 數值'); return; }
      lat = w.lat.toFixed(6); lng = w.lng.toFixed(6);
    }
    const meta = ApiService.newClientMeta();
    try {
      const r = await post({type:'update_tree', tree_id:TD.id, new_tree_id:newId, prj:TD.prj,
        name:$('#eName').value, status:$('#eStatus').value,
        project_id:$('#eProject').value,
        tree_height:$('#eHeight').value, crown_width:$('#eSpread').value,
        dbh:$('#eDbh').value, ground_diameter:$('#eGroundDia').value,
        stem_length:$('#eStemLen').value, crown_area:$('#eCrownArea').value,
        crown_volume:$('#eCrownVol').value, level:$('#eLevel').value,
        lat:lat, lng:lng, description:$('#eDesc').value,
        client_id: meta.client_id, client_created_at: meta.client_created_at});
      if (r.ok && !r.queued) {
        if (newId !== TD.id) {
          const url = new URL(location.href);
          url.searchParams.set('id', newId);
          if (TD.prj) url.searchParams.set('prj', TD.prj);
          history.replaceState(null, '', url.toString());
          alert('✅ 已更新！樹木編號已改為 ' + newId + '。\n⚠️ 如該樹已寫入 NFC 標籤，請重新寫入新編號。');
        } else {
          alert('✅ 已更新！');
        }
        setTimeout(function(){ location.reload(); }, 800);
      } else if (r.ok && r.queued) {
        alert('📥 已離線暫存（編號改名會於連線同步後生效）');
      } else {
        alert('❌ 失敗：' + r.error);
      }
    } catch(err) {
      alert('❌ 連線錯誤：' + err.message);
    }
  }

  // 🔥 [Phase6] 寫入收斂到共用 ApiService（佢內部處理 auth + token 注入 + 排隊）。
  // 離線／網路不穩時，offline.js 已 hook ApiService.post 做安全暫存。
  async function post(payload){
    if (typeof ApiService === 'undefined') {
      throw new Error('API 服務未初始化');
    }

    // 離線時直接交給離線佇列（與 offline.js hook 行為一致）
    if(!navigator.onLine && typeof OfflineQueue !== 'undefined') {
      await OfflineQueue.push(payload);
      if(typeof pwaToast !== 'undefined') pwaToast('📥 離線暫存：有網路時自動上傳');
      return { ok: true, queued: true };
    }

    return ApiService.post(payload);
  }

  window.staffMode = staffMode;
  window.checkin = checkin;
  window.submitInspection = submitInspection;
  window.saveTreeInfo = saveTreeInfo;
  window.removePhoto = TDPhotos.removePhoto;

  window.zoomImage = function(src, event){
    if(event && event.stopPropagation) event.stopPropagation();
    const modal = document.getElementById('imgModal');
    const modalImg = document.getElementById('modalImg');
    modalImg.src = src;
    modal.classList.add('show');
    // [Phase11] 通知同步面板自動隱藏
    try { window.dispatchEvent(new CustomEvent('treemap:photozoom', { detail: { open: true } })); } catch (e) {}
  };

  window.closeZoom = function(){
    document.getElementById('imgModal').classList.remove('show');
    // [Phase11] 通知同步面板還原
    try { window.dispatchEvent(new CustomEvent('treemap:photozoom', { detail: { open: false } })); } catch (e) {}
  };

  window.downloadPhoto = function(url, treeId, timeStr, photoIndex){
    if(url && url.indexOf('drive.google.com') !== -1){
      window.open(url, '_blank');
      return;
    }
    fetch(url, { mode: 'cors', credentials: 'omit' })
      .then(function(r){
        if(!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      })
      .then(function(blob){
        var link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        var suffix = photoIndex ? '_' + photoIndex : '';
        link.download = 'inspection_' + treeId + '_' + timeStr.replace(/[: ]/g,'-') + suffix + '.jpg';
        link.click();
        URL.revokeObjectURL(link.href);
      })
      .catch(function(err){
        window.open(url, '_blank');
        alert('⚠️ 自動下載失敗，已在新分頁開啟圖片，請手動右鍵保存。\n錯誤：' + err.message);
      });
  };

  // 一鍵跳去 nfc.html，自動帶同樹木 URL
  window.goNFC = function(){
    const treeUrl = location.origin + location.pathname +
      '?id=' + encodeURIComponent(TD.id) + '&prj=' + encodeURIComponent(TD.prj);
    location.href = 'nfc.html?url=' + encodeURIComponent(treeUrl);
  };

