(function(){
  'use strict';

  // 依賴：config.js（Config）、api.js（ApiService）、auth.js（AuthService）、
  //       core/global-utils.js（window.TreeUtils）需先載入
  const API = (typeof Config !== 'undefined' && Config.API_ENDPOINT)
    ? Config.API_ENDPOINT
    : '';

  // 🔥 [Phase6] 初始化共用 API service，移除各頁散落嘅 fetch endpoint 設定
  // 注意：api.js 用 const 建立 ApiService（非同 window property），故用 global 變數檢查
  if (typeof ApiService !== 'undefined' && Config.API_ENDPOINT) {
    ApiService.init(Config.API_ENDPOINT);
  }

  const escapeHtml = window.TreeUtils.escapeHtml;

  // DOMPurify 兜底（保留本頁 rely 嘅 inline onclick/onerror，其餘一律淨化）
  function sanitizeHTML(html) {
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(html, { ADD_ATTR: ['onclick', 'onerror'] });
    }
    return html;
  }

  const $ = function(s){ return document.querySelector(s); };

  // 🔥 [Phase6] 座標轉換收斂到共用 CoordLazy service（保留 lazy proj4 效能）
  const toHK = window.CoordLazy ? window.CoordLazy.toHK : function(){ return Promise.resolve(null); };
  const toWGS = window.CoordLazy ? window.CoordLazy.toWGS : function(){ return Promise.resolve(null); };

  const f1 = window.TreeUtils.format1;
  const f5 = window.TreeUtils.format5;

  const params = new URLSearchParams(location.search);
  const sanitizeId = (window.TreeUtils && window.TreeUtils.sanitizeId) || function () { return ''; };
  const id  = sanitizeId(params.get('id') || params.get('tree_id') || '');
  const prj = sanitizeId(params.get('prj') || params.get('project_id') || '');
  let TREE = null;

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

  // 🔥 [Phase6] 認證收斂到共用 AuthService，刪走內嵌重複登入邏輯。
  // 保留原離線特判：離線且無有效 token 時，直接提示，唔好傻等網路。
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

  function fmtTime(v){
    const s = String(v);
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(v);
    if(isNaN(d.getTime())) return s.slice(0,10);
    const p = function(n){ return String(n).padStart(2,'0'); };
    return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate());
  }

  if (!id) {
    $('#app').innerHTML = '<div class="card error">❌ 缺少樹木編號：請由地圖選擇樹木後再開啟此頁。</div>';
  } else {
    fetch(API + '?action=tree&id=' + encodeURIComponent(id) + '&prj=' + encodeURIComponent(prj))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.error === 'OFFLINE') {
          $('#app').innerHTML = '<div class="card error">📴 離線模式：暫無此樹木的快取資料，請連線後再試。</div>';
          return;
        }
        const t = res.data;
        if(!t){
          $('#app').innerHTML = '<div class="card error">❌ 搵唔到樹木：<b>' + escapeHtml(id) + '</b></div>';
          return;
        }
        TREE = t; render(t); initMiniMap(t); loadLogs();
      })
      .catch(function(err){
        console.error('Fetch error:', err);
        $('#app').innerHTML = '<div class="card error">❌ 後端連線失敗：<br>' + escapeHtml(err.message) + '</div>';
      });
  }

  const COLORS = {'Normal':'#2E7D32','Fair':'#7CB342','Poor':'#FFB300','Very Poor':'#E53935','Dead':'#000000'};

  async function render(t){
    const hkPromise = toHK(t.lat, t.lng);
    var html = '<a class="back" href="index.html?tree_id=' + encodeURIComponent(t.tree_id) + '&project_id=' + encodeURIComponent(t.project_id || '') + '&lat=' + encodeURIComponent(t.lat) + '&lng=' + encodeURIComponent(t.lng) + '" onclick="return goBackToMap(event)">⬅ 地圖</a>' +
    '<div class="card">' +
      '<h1>' + escapeHtml(t.tree_id) + ' ' + escapeHtml(t.name) + '</h1>' +
      '<div style="margin-top:8px"><span class="badge" style="background:' + (COLORS[t.status]||'#757575') + '">Status: ' + escapeHtml(t.status) + '</span></div>';
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
        html += '<img class="tree zoomable-img" src="' + escapeHtml(mainPhotos[i]) + '" alt="' + escapeHtml(t.name) + '" ' + loadingAttr + ' decoding="async" crossorigin="anonymous" referrerpolicy="no-referrer" onclick="zoomImage(this.src)">';
      }
    }
    html += '<div class="grid">' +
        '<div>Tree Height<b>' + (t.tree_height||t.height||'-') + ' m</b></div>' +
        '<div>Crown Width<b>' + (t.crown_width||t.spread||'-') + ' m</b></div>' +
        '<div>DBH<b>' + (t.dbh||'-') + ' m</b></div>' +
        '<div>Ground Dia.<b>' + (t.ground_diameter||'-') + ' m</b></div>' +
        '<div>Stem Length<b>' + (t.stem_length||'-') + ' m</b></div>' +
        '<div>Crown Area<b>' + (t.crown_area||'-') + ' ㎡</b></div>' +
        '<div>Crown Vol.<b>' + (t.crown_volume||'-') + ' m³</b></div>' +
      '</div>' +
      '<div class="sub" style="margin-top:8px">' + escapeHtml(t.description||'') + '</div>' +
      '<div class="sub" style="margin-top:6px">📍 <b>HK80：</b>N <span id="hk80N">—</span> ／ E <span id="hk80E">—</span> ｜ <b>Level：</b>' + (t.level||'-') + ' m</div>' +
      '<div class="sub">WGS84：' + f5(t.lat) + ', ' + f5(t.lng) + '</div>' +
      '<div id="minimap"></div>' +
    '</div>' +
    '<div class="card"><button class="sec" style="background:#00897b" onclick="goNFC()">📱 一鍵寫入 NFC tag</button></div>' +
    '<div class="card" id="staffBox"><button class="sec" onclick="staffMode()">🔑 工作人員</button></div>' +
    '<div class="card"><b>📋 巡查歷史</b><div id="logs"><div class="log">載入中…</div></div></div>' +
    '<div id="imgModal" class="modal" onclick="closeZoom()">' +
      '<span class="modal-close">&times;</span>' +
      '<img id="modalImg" src="" alt="放大圖片" crossorigin="anonymous" referrerpolicy="no-referrer">' +
    '</div>';
    $('#app').innerHTML = sanitizeHTML(html);

    const hk = await hkPromise;
    if(hk){
      const elN = document.getElementById('hk80N');
      const elE = document.getElementById('hk80E');
      if(elN) elN.textContent = f1(hk.N);
      if(elE) elE.textContent = f1(hk.E);
    }
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
            fillColor:COLORS[t.status]||'#757575',fillOpacity:.9}).addTo(mm);

          mm.invalidateSize();
        });
      });
    }

    tryInit();
  }

  async function staffMode(){
    if(!await staffOk()) return;
    const hk = await toHK(TREE.lat, TREE.lng);
    $('#staffBox').innerHTML =
      '<button onclick="checkin()">✅ 簽到</button>' +
      '<hr><div class="section-title">📝 巡查記錄（狀態會自動同步樹木資料）</div>' +
      '<select id="health"><option>Normal</option><option>Fair</option><option>Poor</option><option>Very Poor</option><option>Dead</option></select>' +
      '<textarea id="note" rows="2" placeholder="備註"></textarea>' +
      '<input type="file" id="photo" accept="image/*" multiple style="display:none">' +
      '<button onclick="document.getElementById(\'photo\').click()" style="margin-top:10px;background:#546e7a">📷 選擇相片（支援多張／相簿）</button>' +
      '<div id="photoPreviewContainer" class="photo-preview-container" style="display:none">' +
        '<div class="photo-count">已選擇 <b id="photoCount">0</b> 張相片</div>' +
        '<div id="photoPreviewGrid" class="photo-preview-grid"></div>' +
      '</div>' +
      '<button onclick="submitInspection()" style="margin-top:10px">📤 上傳巡查記錄</button>' +
      '<hr><div class="section-title">✏️ 樹木資料（HK80 座標／Level／地盤）</div>' +
      '<div class="form-group"><label class="form-label">🌳 樹種</label><input id="eName" list="tree_list" placeholder="選擇樹種（輸入關鍵字搜尋）..."></div>' +
      '<datalist id="tree_list"></datalist>' +
      '<div class="form-group"><label class="form-label">📊 健康狀況</label><select id="eStatus"><option>Normal</option><option>Fair</option><option>Poor</option><option>Very Poor</option><option>Dead</option></select>' +
      '<div class="form-group"><label class="form-label">🚩 所屬地盤</label><select id="eProject"></select></div>' +
      '<div class="row2"><div class="form-group"><label class="form-label">Tree Height (m)</label><input id="eHeight" placeholder="樹高" inputmode="decimal"></div><div class="form-group"><label class="form-label">Crown Width (m)</label><input id="eSpread" placeholder="冠寬" inputmode="decimal"></div></div>' +
      '<div class="row2"><div class="form-group"><label class="form-label">DBH (m)</label><input id="eDbh" placeholder="胸徑" inputmode="decimal"></div><div class="form-group"><label class="form-label">Ground Dia. (m)</label><input id="eGroundDia" placeholder="地徑" inputmode="decimal"></div></div>' +
      '<div class="row2"><div class="form-group"><label class="form-label">Stem Length (m)</label><input id="eStemLen" placeholder="幹長" inputmode="decimal"></div><div class="form-group"><label class="form-label">Crown Area (㎡)</label><input id="eCrownArea" placeholder="投影面積" inputmode="decimal"></div></div>' +
      '<div class="form-group"><label class="form-label">Crown Volume (m³)</label><input id="eCrownVol" placeholder="冠幅體積" inputmode="decimal"></div>' +
      '<div class="row2"><div class="form-group"><label class="form-label">HK80 N (Northing)</label><input id="eN" placeholder="北座標" inputmode="decimal"></div><div class="form-group"><label class="form-label">HK80 E (Easting)</label><input id="eE" placeholder="東座標" inputmode="decimal"></div></div>' +
      '<div class="form-group"><label class="form-label">Level (m，高程)</label><input id="eLevel" placeholder="高程" inputmode="decimal"></div>' +
      '<div class="form-group"><label class="form-label">📄 簡介</label><textarea id="eDesc" rows="2" placeholder="樹木簡介"></textarea></div>' +
      '<button onclick="saveTreeInfo()">💾 儲存樹木資料</button>';

    initPhotoPreview();

    $('#eStatus').value = TREE.status || 'Normal';
    $('#eName').value = TREE.name || '';
    $('#eHeight').value = TREE.tree_height || TREE.height || '';
    $('#eSpread').value = TREE.crown_width || TREE.spread || '';
    $('#eDbh').value = TREE.dbh || '';
    $('#eGroundDia').value = TREE.ground_diameter || '';
    $('#eStemLen').value = TREE.stem_length || '';
    $('#eCrownArea').value = TREE.crown_area || '';
    $('#eCrownVol').value = TREE.crown_volume || '';
    $('#eN').value = hk ? f1(hk.N) : '';
    $('#eE').value = hk ? f1(hk.E) : '';
    $('#eLevel').value = TREE.level || '';
    $('#eDesc').value = TREE.description || '';

    fetch(API + '?action=projects').then(function(r){ return r.json(); }).then(function(res){
      const opts = (res.data || []).map(function(p){
        return '<option value="' + p.project_id + '">🚩 ' + p.name + '</option>';
      }).join('');
      $('#eProject').innerHTML = '<option value="">（不屬任何地盤）</option>' + opts;
      $('#eProject').value = TREE.project_id || '';
    });

    if(!window.allTreesLoaded){
      fetch('data/trees_data.json')
        .then(function(r){ return r.json(); })
        .then(function(trees){
          const dataList = document.getElementById('tree_list');
          trees.forEach(function(tree){
            const option = document.createElement('option');
            option.value = tree.name;
            dataList.appendChild(option);
          });
          window.allTreesLoaded = true;
        })
        .catch(function(err){ console.error('載入樹木資料失敗:', err); });
    }
  }

  let selectedPhotos = [];

  function initPhotoPreview(){
    const fileInput = $('#photo');

    fileInput.addEventListener('change', function(e){
      const files = Array.from(e.target.files);
      for(let i = 0; i < files.length; i++){
        selectedPhotos.push(files[i]);
      }
      fileInput.value = '';
      updatePhotoPreview();
    });
  }

  function updatePhotoPreview(){
    const previewContainer = $('#photoPreviewContainer');
    const previewGrid = $('#photoPreviewGrid');
    const photoCount = $('#photoCount');
    if(selectedPhotos.length === 0){
      previewContainer.style.display = 'none';
      return;
    }
    previewContainer.style.display = 'block';
    photoCount.textContent = selectedPhotos.length;
    previewGrid.innerHTML = '';
    selectedPhotos.forEach(function(file, index){
      const reader = new FileReader();
      reader.onload = function(e){
        const item = document.createElement('div');
        item.className = 'photo-preview-item';
        const removeBtn = document.createElement('button');
        removeBtn.className = 'photo-preview-remove';
        removeBtn.textContent = '×';
        removeBtn.title = '移除這張相片';
        removeBtn.onclick = function(event){
          event.stopPropagation();
          removePhoto(index);
        };
        const img = document.createElement('img');
        img.className = 'photo-preview-thumb';
        img.src = e.target.result;
        img.loading = 'lazy';
        item.appendChild(img);
        item.appendChild(removeBtn);
        previewGrid.appendChild(item);
      };
      reader.readAsDataURL(file);
    });
  }

  function removePhoto(index){
    selectedPhotos.splice(index, 1);
    updatePhotoPreview();
  }

  async function checkin(){
    const staff = prompt('工作人員姓名：') || '未填';
    try {
      const r = await post({type:'checkin', staff:staff, tree_id:id, prj:prj});
      alert(r.ok ? '✅ 簽到成功！' : '❌ 失敗：' + r.error);
      if(r.ok && r.queued) { /* 離線暫存不刷新 */ }
      else if(r.ok) { setTimeout(function(){ location.reload(); }, 800); }
    } catch(err) {
      alert('❌ 連線錯誤：' + err.message);
    }
  }

  async function submitInspection(){
    const staff  = prompt('工作人員姓名：') || '未填';
    if(selectedPhotos.length === 0){
      try {
        const r = await post({type:'inspection', staff:staff, tree_id:id, prj:prj,
          health:$('#health').value, note:$('#note').value, photo_base64:''});
        alert(r.ok ? '✅ 已上傳！' : '❌ 失敗：' + r.error);
        if(r.ok && !r.queued) { setTimeout(function(){ location.reload(); }, 1000); }
      } catch(err) {
        alert('❌ 連線錯誤：' + err.message);
      }
      return;
    }
    const photosData = [];
    for(let i = 0; i < selectedPhotos.length; i++){
      try {
        const b64 = await compress(selectedPhotos[i]);
        photosData.push(b64);
      } catch(err) {
        alert('❌ 壓縮圖片失敗：' + err.message);
        return;
      }
    }
    const payload = {
      type:'inspection', staff:staff, tree_id:id, prj:prj,
      health:$('#health').value, note:$('#note').value, photo_base64: photosData
    };
    try {
      const r = await post(payload);
      alert(r.ok ? '✅ 已上傳 ' + selectedPhotos.length + ' 張相片！' : '❌ 失敗：' + r.error);
      if(r.ok && !r.queued) { selectedPhotos = []; setTimeout(function(){ location.reload(); }, 1000); }
    } catch(err) {
      alert('❌ 連線錯誤：' + err.message);
    }
  }

  async function saveTreeInfo(){
    let lat = TREE.lat, lng = TREE.lng;
    const N = $('#eN').value, E = $('#eE').value;
    if(N && E){
      const w = await toWGS(N, E);
      if(!w){ alert('HK80 座標轉換失敗，請檢查 N/E 數值'); return; }
      lat = w.lat.toFixed(6); lng = w.lng.toFixed(6);
    }
    try {
      const r = await post({type:'update_tree', tree_id:id, prj:prj,
        name:$('#eName').value, status:$('#eStatus').value,
        project_id:$('#eProject').value,
        tree_height:$('#eHeight').value, crown_width:$('#eSpread').value,
        dbh:$('#eDbh').value, ground_diameter:$('#eGroundDia').value,
        stem_length:$('#eStemLen').value, crown_area:$('#eCrownArea').value,
        crown_volume:$('#eCrownVol').value, level:$('#eLevel').value,
        lat:lat, lng:lng, description:$('#eDesc').value});
      alert(r.ok ? '✅ 已更新！' : '❌ 失敗：' + r.error);
      if(r.ok && !r.queued) setTimeout(function(){ location.reload(); }, 800);
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

  async function compress(file, maxW, q){
    maxW = maxW || 1200; q = q || .8;
    return new Promise(function(resolve, reject){
      const img = new Image();
      img.onload = function(){
        try {
          const s = Math.min(1, maxW / img.width);
          const c = document.createElement('canvas');
          c.width = img.width * s; c.height = img.height * s;
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const dataUrl = c.toDataURL('image/jpeg', q);
          resolve(dataUrl.split(',')[1]);
        } catch(err) {
          reject(err);
        }
      };
      img.onerror = function(){ reject(new Error('圖片載入失敗')); };
      img.src = URL.createObjectURL(file);
    });
  }

  function convertGoogleDriveUrl(url, forDownload){
    if(!url) return url;
    var str = String(url);
    var matchId = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || str.match(/[\?&]id=([a-zA-Z0-9_-]+)/);
    if(matchId && matchId[1]){
      var fileId = matchId[1];
      if(forDownload) return 'https://drive.google.com/uc?export=download&id=' + fileId;
      else return 'https://drive.google.com/uc?export=view&id=' + fileId;
    }
    return str;
  }

  function loadLogs(){
    fetch(API + '?action=inspections&id=' + encodeURIComponent(id) + '&prj=' + encodeURIComponent(prj))
      .then(function(r){ return r.json(); })
      .then(function(res){
        if(res && res.error === 'OFFLINE') {
          $('#logs').innerHTML = '<div class="log">📴 離線模式：暫無巡查記錄快取</div>';
          return;
        }
        const data = res.data || [];
        if(!data.length){ $('#logs').innerHTML = '<div class="log">尚無記錄</div>'; return; }
        var html = '';
        data.reverse().forEach(function(r){
          var photoHtml = '';
          var photos = r.photo_urls || r.photo_url;
          if(!photos){ photos = []; }
          else if(typeof photos === 'string'){
            if(photos.indexOf('[') !== -1 && photos.indexOf(']') !== -1){
              try { photos = JSON.parse(photos); } catch(e) { photos = photos.replace(/^\[|\]$/g, ''); }
            }
            if(typeof photos === 'string' && photos.indexOf(',') !== -1){
              photos = photos.split(',').map(function(url){ return url.trim(); });
            } else if(typeof photos === 'string') {
              photos = [photos];
            }
          }
          if(!Array.isArray(photos)){ photos = []; }
          photos = photos.filter(function(p){ return p && String(p).trim() !== ''; });

          if(photos && photos.length > 0){
            var timeStr = fmtTime(r.time);
            var treeIdEscaped = escapeHtml(r.tree_id||id);
            var A = '&';
            var timeStrForDownload = timeStr.replace(/&/g, A + 'amp;').replace(/'/g, A + 'apos;');

            photoHtml += '<div class="inspection-photo-grid">';
            for(var i = 0; i < photos.length; i++){
              var photoUrl = photos[i];
              var displayUrl = convertGoogleDriveUrl(photoUrl, false);
              var downloadUrl = convertGoogleDriveUrl(photoUrl, true);
              var displayUrlEscaped = escapeHtml(displayUrl);
              var downloadUrlEscaped = escapeHtml(downloadUrl);
              var photoIndex = i + 1;
              photoHtml += '<div class="inspection-photo-item"><img class="inspection-photo-thumb" src="' + displayUrlEscaped + '" loading="lazy" decoding="async" crossorigin="anonymous" referrerpolicy="no-referrer" onclick="event.stopPropagation(); zoomImage(\'' + displayUrlEscaped + '\')" title="點擊放大" onerror="this.parentElement.style.display=\'none\'"><button class="inspection-photo-btn" onclick="event.stopPropagation(); downloadPhoto(\'' + downloadUrlEscaped + '\', \'' + treeIdEscaped + '\', \'' + timeStrForDownload + '\', ' + photoIndex + ')">⬇️ #' + photoIndex + '</button></div>';
            }
            photoHtml += '</div>';
          }
          html += '<div class="log"><span class="ok">' + escapeHtml(r.health) + '</span>｜' +
                 escapeHtml(r.staff) + '｜' + fmtTime(r.time) + '<br>' + escapeHtml(r.note||'') + photoHtml + '</div>';
        });
        $('#logs').innerHTML = sanitizeHTML(html);
      })
      .catch(function(err){
        console.error('Load logs error:', err);
        $('#logs').innerHTML = '<div class="log">載入失敗</div>';
      });
  }

  window.staffMode = staffMode;
  window.checkin = checkin;
  window.submitInspection = submitInspection;
  window.saveTreeInfo = saveTreeInfo;
  window.removePhoto = removePhoto;

  window.zoomImage = function(src, event){
    if(event && event.stopPropagation) event.stopPropagation();
    const modal = document.getElementById('imgModal');
    const modalImg = document.getElementById('modalImg');
    modalImg.src = src;
    modal.classList.add('show');
  };

  window.closeZoom = function(){
    document.getElementById('imgModal').classList.remove('show');
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
        alert('⚠️ 自動下載失敗，已喺新分頁打開圖片，請手動右鍵保存。\n錯誤：' + err.message);
      });
  };

  // 一鍵跳去 nfc.html，自動帶同樹木 URL
  window.goNFC = function(){
    const treeUrl = location.origin + location.pathname +
      '?id=' + encodeURIComponent(id) + '&prj=' + encodeURIComponent(prj);
    location.href = 'nfc.html?url=' + encodeURIComponent(treeUrl);
  };

})();