/*************************************************
 * 樹木 NFC 巡查系統 - 後端（密碼保護版 + HK80 儲存 + 自訂地盤 ID + 冪等性防重 + 相片分離）
 * 查看資料（GET）= 公開；寫入（POST）= 要密碼 Token
 * [v2.59] 🔥 支援 inspection_photo 分離上傳 + inspection_id 生成 + 完美相容舊行為
 *         🔥 [修正] inspection 儲存 photos_total；重複時回傳已存在相片
 *************************************************/
const FOLDER_ID = '1Z0z9p2HC88T8gGy7hdYsq7JzyXhTTGAW';
const SH_TREES = 'trees';
const SH_INS   = 'inspections';
const SH_CHK   = 'checkins';
const SH_PRJ   = 'projects';

const TOKEN_EXPIRY_SECONDS = 21600; // Token 有效期 6 小時

// 🔥 服務端快取設定
const BOOTSTRAP_CACHE_KEY = 'bootstrap_data';
const BOOTSTRAP_CACHE_TTL = 60;
const TREES_CACHE_KEY = 'trees_all';
const PROJECTS_CACHE_KEY = 'projects_all';
const INSPECTIONS_CACHE_KEY = 'inspections_all';
const CACHE_TTL = 60; // 一般唯讀快取 60 秒

/* ---------- 快取清理工具 ---------- */
function clearDataCache_(){
  try {
    const cache = CacheService.getScriptCache();
    cache.remove(BOOTSTRAP_CACHE_KEY);
    cache.remove(TREES_CACHE_KEY);
    cache.remove(PROJECTS_CACHE_KEY);
    cache.remove(INSPECTIONS_CACHE_KEY);
  } catch(e) {}
}

/* ---------- 密碼／Token 工具 ---------- */
function checkPassword_(pw){
  const correct = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if(!correct) return false;
  return String(pw || '') === correct;
}

function createToken_(){
  const token = Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,'');
  CacheService.getScriptCache().put('TOKEN_' + token, '1', TOKEN_EXPIRY_SECONDS);
  return token;
}

function isValidToken_(token){
  if(!token) return false;
  return CacheService.getScriptCache().get('TOKEN_' + token) === '1';
}

/* ---------- 登入 rate-limit（防暴力破解） ---------- */
const LOGIN_MAX_FAILURES = 10;
const LOGIN_LOCK_SECONDS = 600; // 鎖 10 分鐘

function loginFailKey_(){
  try { return 'LOGIN_FAIL_' + Session.getTemporaryActiveUserKey(); }
  catch(e) { return 'LOGIN_FAIL_GLOBAL'; }
}

function loginFailed_(){
  const cache = CacheService.getScriptCache();
  const key = loginFailKey_();
  const fails = parseInt(cache.get(key) || '0', 10) + 1;
  cache.put(key, String(fails), LOGIN_LOCK_SECONDS);
}

function loginAllowed_(){
  const cache = CacheService.getScriptCache();
  return parseInt(cache.get(loginFailKey_()) || '0', 10) < LOGIN_MAX_FAILURES;
}

function resetLoginFailures_(){
  try {
    CacheService.getScriptCache().remove(loginFailKey_());
  } catch(e) {}
}

/* ---------- 只記日期工具 ---------- */
function dateOnly_(){
  const tz = Session.getScriptTimeZone() || 'Asia/Hong_Kong';
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

/* =========================================================
 * WGS84 → HK80 座標轉換（同前端 proj4 同一套參數）
 * ========================================================= */
const WGS_A_  = 6378137.0,  WGS_F_ = 1/298.257223563;
const INTL_A_ = 6378388.0,  INTL_F_ = 1/297.0;
const ARC_    = Math.PI/180/3600;

function deg2rad_(d){ return d*Math.PI/180; }
function rad2deg_(r){ return r*180/Math.PI; }

function geo2xyz_(lat, lng, h, a, f){
  const e2 = f*(2-f);
  const sL = Math.sin(lat), cL = Math.cos(lat);
  const sG = Math.sin(lng), cG = Math.cos(lng);
  const N = a/Math.sqrt(1-e2*sL*sL);
  return [(N+h)*cL*cG, (N+h)*cL*sG, (N*(1-e2)+h)*sL];
}

function xyz2geo_(x, y, z, a, f){
  const e2 = f*(2-f);
  const p = Math.sqrt(x*x+y*y);
  let lat = Math.atan2(z, p*(1-e2));
  for(let i=0;i<10;i++){
    const sL = Math.sin(lat);
    const N = a/Math.sqrt(1-e2*sL*sL);
    const nl = Math.atan2(z + e2*N*sL, p);
    if(Math.abs(nl-lat)<1e-13){ lat=nl; break; }
    lat = nl;
  }
  const sL = Math.sin(lat), cL = Math.cos(lat);
  const N = a/Math.sqrt(1-e2*sL*sL);
  const h = p/cL - N;
  return [lat, Math.atan2(y,x), h];
}

function wgs84ToHk80_(latDeg, lngDeg){
  if(latDeg===''||lngDeg===''||latDeg==null||lngDeg==null||isNaN(+latDeg)||isNaN(+lngDeg)) return null;
  const lat = deg2rad_(+latDeg), lng = deg2rad_(+lngDeg);
  const xyz = geo2xyz_(lat, lng, 0, WGS_A_, WGS_F_);
  const x=xyz[0], y=xyz[1], z=xyz[2];
  const dx=162.619, dy=276.959, dz=161.764;
  const rx=-0.067753*ARC_, ry=2.243649*ARC_, rz=1.158827*ARC_;
  const s=1+1.094246/1e6;
  const X = dx + s*(x + rz*y - ry*z);
  const Y = dy + s*(-rz*x + y + rx*z);
  const Z = dz + s*(ry*x - rx*y + z);
  const g = xyz2geo_(X, Y, Z, INTL_A_, INTL_F_);
  const lat0 = deg2rad_(22.31213333333334), lon0 = deg2rad_(114.1785555555556);
  const k0=1, x0=836694.05, y0=819069.8;
  const a=INTL_A_, f=INTL_F_;
  const e2=f*(2-f), ep2=e2/(1-e2);
  const L=g[0], P=g[1];
  const sL=Math.sin(L), cL=Math.cos(L), tL=Math.tan(L);
  const N=a/Math.sqrt(1-e2*sL*sL);
  const Tt=tL*tL, C=ep2*cL*cL, A=(P-lon0)*cL;
  const e4=e2*e2, e6=e4*e2;
  const M=a*((1-e2/4-3*e4/64-5*e6/256)*L-(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*L)+(15*e4/256+45*e6/1024)*Math.sin(4*L)-(35*e6/3072)*Math.sin(6*L));
  const M0=a*((1-e2/4-3*e4/64-5*e6/256)*lat0-(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*lat0)+(15*e4/256+45*e6/1024)*Math.sin(4*lat0)-(35*e6/3072)*Math.sin(6*lat0));
  const E = k0*N*(A+(1-Tt+C)*A*A*A/6+(5-18*Tt+Tt*Tt+72*C-58*ep2)*A*A*A*A*A/120)+x0;
  const Nn = k0*(M-M0+N*tL*(A*A/2+(5-Tt+9*C+4*C*C)*A*A*A*A/24+(61-58*Tt+Tt*Tt+600*C-330*ep2)*A*A*A*A*A*A/720))+y0;
  return { N: Math.round(Nn*10)/10, E: Math.round(E*10)/10 };
}
/* =========================================================
 * HK80 → WGS84 反向轉換（測量師現場記 HK80 用）
 * ========================================================= */
function hk80ToGeo_(E, N){
  const a=INTL_A_, f=INTL_F_;
  const e2=f*(2-f), ep2=e2/(1-e2);
  const k0=1, x0=836694.05, y0=819069.8;
  const lat0=deg2rad_(22.31213333333334), lon0=deg2rad_(114.1785555555556);
  const M=(N-y0)/k0;
  const e4=e2*e2, e6=e4*e2;
  const mu=M/(a*(1-e2/4-3*e4/64-5*e6/256));
  const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const e12=e1*e1, e13=e12*e1, e14=e13*e1;
  const phi1=mu+(3*e1/2-27*e13/32)*Math.sin(2*mu)+(21*e12/16-55*e14/32)*Math.sin(4*mu)
            +(151*e13/96)*Math.sin(6*mu)+(1097*e14/512)*Math.sin(8*mu);
  const sL=Math.sin(phi1), cL=Math.cos(phi1), tL=Math.tan(phi1);
  const N1=a/Math.sqrt(1-e2*sL*sL);
  const T1=tL*tL, C1=ep2*cL*cL;
  const R1=a*(1-e2)/Math.pow(1-e2*sL*sL,1.5);
  const D=(E-x0)/(k0*N1);
  const D2=D*D, D3=D2*D, D4=D3*D, D5=D4*D, D6=D5*D;
  const lat=phi1-(N1*tL/R1)*(D2/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*D4/24
            +(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D6/720);
  const lng=lon0+(D-(1+2*T1+C1)*D3/6+(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D5/120)/cL;
  return [lat, lng];
}

function hk80ToWgs84_(Nn, Ee){
  if(Nn===''||Ee===''||Nn==null||Ee==null||isNaN(+Nn)||isNaN(+Ee)) return null;
  const g=hk80ToGeo_(+Ee, +Nn);
  const xyz=geo2xyz_(g[0], g[1], 0, INTL_A_, INTL_F_);
  const dx=162.619, dy=276.959, dz=161.764;
  const rx=-0.067753*ARC_, ry=2.243649*ARC_, rz=1.158827*ARC_;
  const s=1+1.094246/1e6;
  const x1=(xyz[0]-dx)/s, y1=(xyz[1]-dy)/s, z1=(xyz[2]-dz)/s;
  const xw=x1-rz*y1+ry*z1;
  const yw=rz*x1+y1-rx*z1;
  const zw=-ry*x1+rx*y1+z1;
  const geo=xyz2geo_(xw, yw, zw, WGS_A_, WGS_F_);
  return { lat: rad2deg_(geo[0]), lng: rad2deg_(geo[1]) };
}

/* =========================================================
 * 地盤 ID 生成器（優化：只讀取 project_id 欄位）
 * ========================================================= */
function getProjectIds_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_PRJ);
  if (!sheet) return [];
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idIdx = headers.indexOf('project_id');
  if (idIdx === -1) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  // 只讀 project_id 一欄，避免成張表讀取
  return sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues().map(row => String(row[0]));
}

function makeProjectId_(name, customId){
  let base = String(customId || '').trim();
  if(!base) base = String(name || '').trim();
  base = base.replace(/\s+/g, '').replace(/[^a-zA-Z0-9_-]/g, '');
  if(!base) base = 'P' + Date.now();
  const existing = getProjectIds_();
  let pid = base, n = 2;
  while(existing.indexOf(pid) !== -1){ pid = base + '_' + n; n++; }
  return pid;
}

/* =========================================================
 * 快取輔助函式
 * ========================================================= */
function getCachedRows_(sheetName, cacheKey, ttl) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }
  const rows = rows_(sheetName);
  try { cache.put(cacheKey, JSON.stringify(rows), ttl || CACHE_TTL); } catch(e) {}
  return rows;
}

/* ---------- GET：公開，高層隨時查看 ---------- */
function doGet(e){
  try {
    const p = (e && e.parameter) || {};
    const action = p.action || 'trees';

    if(action === 'bootstrap'){
      const cache = CacheService.getScriptCache();
      const cached = cache.get(BOOTSTRAP_CACHE_KEY);
      if(cached){
        return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
      }
      const payload = {ok:true, data: { projects: rows_(SH_PRJ), trees: rows_(SH_TREES) }};
      const jsonStr = JSON.stringify(payload);
      try { cache.put(BOOTSTRAP_CACHE_KEY, jsonStr, BOOTSTRAP_CACHE_TTL); }
      catch(e) { console.warn('⚠️ 快取太大，跳過'); }
      return ContentService.createTextOutput(jsonStr).setMimeType(ContentService.MimeType.JSON);
    }

    if(action === 'ping'){
      return json_({ok:true, pong: Date.now()});
    }

    if(action === 'tree'){
      const trees = getCachedRows_(SH_TREES, TREES_CACHE_KEY, CACHE_TTL);
      const list = trees.filter(r => String(r.tree_id) === p.id);
      let t = null;
      if(p.prj){ t = list.find(r => String(r.project_id||'') === p.prj) || null; }
      if(!t) t = list[0] || null;
      return json_({ok:true, data: t});
    }

    if(action === 'inspections'){
      let list = getCachedRows_(SH_INS, INSPECTIONS_CACHE_KEY, CACHE_TTL).filter(r => String(r.tree_id) === p.id);
      if(p.prj){ list = list.filter(r => String(r.project_id||'') === p.prj); }
      return json_({ok:true, data: list});
    }

    if(action === 'projects'){
      const projects = getCachedRows_(SH_PRJ, PROJECTS_CACHE_KEY, CACHE_TTL);
      return json_({ok:true, data: projects});
    }

    let trees = getCachedRows_(SH_TREES, TREES_CACHE_KEY, CACHE_TTL);
    if(p.project){ trees = trees.filter(t => String(t.project_id) === p.project); }
    return json_({ok:true, data: trees});
  } catch (err) {
    console.error('doGet error:', err);
    return json_({ok:false, error:'伺服器讀取錯誤'});
  }
}
/* ---------- 相片上傳工具（在鎖外執行，縮短佔鎖時間） ---------- */
function uploadPhotoBlob_(folder, base64Str, filename){
  const cleanBase64 = String(base64Str).split(',').pop();
  const blob = Utilities.newBlob(Utilities.base64Decode(cleanBase64), 'image/jpeg', filename);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://lh3.googleusercontent.com/d/' + file.getId() + '=w1200';
}

// 多張相片上傳（逐張容錯：單張失敗不影響其他）
function uploadPhotos_(treeId, photoBase64, startIndex){
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const bases = Array.isArray(photoBase64) ? photoBase64 : [photoBase64];
  const urls = [];
  bases.forEach((base64Str, index) => {
    try {
      urls.push(uploadPhotoBlob_(folder, base64Str, treeId + '_' + Date.now() + '_' + (startIndex + index) + '.jpg'));
    } catch(err) { console.error('Photo upload failed:', err); }
  });
  return urls;
}

// 單張相片上傳（嚴格模式：失敗即 throw，供 inspection_photo 回報錯誤）
function uploadPhotoStrict_(treeId, photoBase64, index){
  const folder = DriveApp.getFolderById(FOLDER_ID);
  return uploadPhotoBlob_(folder, photoBase64, treeId + '_' + Date.now() + '_' + index + '.jpg');
}

/* ---------- POST：寫入一定要密碼 Token ---------- */
function doPost(e){
  // 1️⃣ 解析 + 認證（不需鎖定，避免無效請求/登入長期佔鎖）
  if(!e || !e.postData || !e.postData.contents){
    return json_({ok:false, error:'無效請求'});
  }
  let d;
  try {
    d = JSON.parse(e.postData.contents);
  } catch(err) {
    return json_({ok:false, error:'無效的 JSON 請求'});
  }

  if(d.type === 'login'){
    if(!loginAllowed_()){
      return json_({ok:false, error:'嘗試太頻繁，請稍後再試'});
    }
    if(checkPassword_(d.password)){
      resetLoginFailures_();
      return json_({ok:true, token: createToken_()});
    }
    loginFailed_();
    return json_({ok:false, error:'密碼錯誤'});
  }

  if(!isValidToken_(d.token)){
    return json_({ok:false, error:'UNAUTHORIZED'});
  }

  // 🔥 提取前端傳來的冪等性鍵值
  const clientId = d.client_id || '';
  const clientCreatedAt = d.client_created_at || '';

  // 2️⃣ 防重預檢 + 相片上傳（在鎖外執行，縮短佔鎖時間，避免其他寫入 timeout）
  let prePhotoUrls = [];
  let prePhotoUrl = '';
  let preTreeId = '';
  try {
    if(d.type === 'inspection'){
      if (checkDuplicate_(SH_INS, clientId)) {
        const existingInsId = getExistingIdByClientId_(SH_INS, clientId, 'inspection_id');
        const existingPhotos = getExistingFieldByClientId_(SH_INS, clientId, 'photo_url');
        const photoUrls = existingPhotos ? String(existingPhotos).split(',').filter(Boolean) : [];
        return json_({ok: true, duplicate: true, inspection_id: existingInsId, message: '巡查記錄已存在', photo_urls: photoUrls});
      }
      const isDeferred = (+d.photos_total > 0 && (!d.photo_base64 || d.photo_base64 === '' || (Array.isArray(d.photo_base64) && d.photo_base64.length === 0)));
      if(!isDeferred && d.photo_base64){
        prePhotoUrls = uploadPhotos_(d.tree_id, d.photo_base64, 0);
      }
    }
    else if(d.type === 'inspection_photo'){
      if (checkPhotoDuplicate_(SH_INS, clientId)) {
        return json_({ok: true, duplicate: true, message: '相片已存在'});
      }
      if (!d.inspection_id) {
        return json_({ok: false, error: '缺少 inspection_id'});
      }
      if(d.photo_base64){
        prePhotoUrl = uploadPhotoStrict_(d.tree_id, d.photo_base64, d.photo_index || 0);
      }
    }
    else if(d.type === 'create_tree'){
      if (checkDuplicate_(SH_TREES, clientId)) {
        const existingTid = getExistingIdByClientId_(SH_TREES, clientId, 'tree_id');
        return json_({ok: true, duplicate: true, tree_id: existingTid, message: '樹木已存在'});
      }
      preTreeId = d.tree_id || ('T' + Date.now());
      if(d.photo_base64){
        prePhotoUrls = uploadPhotos_(preTreeId, d.photo_base64, 0);
      }
    }
  } catch(err) {
    return json_({ok:false, error:'相片上傳失敗: ' + err.message});
  }

  // 3️⃣ 鎖住「試算表讀寫」段（相片上傳已完成，不再長期佔鎖）
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return json_({ok:false, error:'系統忙碌中，請稍後再試'});
  }

  try {

    if(d.type === 'checkin'){
      if (checkDuplicate_(SH_CHK, clientId)) {
        return json_({ok: true, duplicate: true, message: '簽到記錄已存在'});
      }
      appendByHeader_(SH_CHK, { 
        time: dateOnly_(), staff: d.staff, tree_id: d.tree_id, project_id: d.prj || '', 
        lat: d.lat || '', lng: d.lng || '',
        client_id: clientId, client_created_at: clientCreatedAt
      });
      clearDataCache_();
      return json_({ok:true});
    }
    else if(d.type === 'inspection'){
      if (checkDuplicate_(SH_INS, clientId)) {
        const existingInsId = getExistingIdByClientId_(SH_INS, clientId, 'inspection_id');
        // 🔥 [修正] 重複時回傳已存在相片，方便前端對帳／重試
        const existingPhotos = getExistingFieldByClientId_(SH_INS, clientId, 'photo_url');
        const photoUrls = existingPhotos ? String(existingPhotos).split(',').filter(Boolean) : [];
        return json_({ok: true, duplicate: true, inspection_id: existingInsId, message: '巡查記錄已存在', photo_urls: photoUrls});
      }

      const insId = 'INS-' + Date.now() + '-' + Utilities.getUuid().slice(0,8);
      const photoUrls = prePhotoUrls; // 相片已在鎖外上傳
      const photoUrlString = photoUrls.join(',');

      appendByHeader_(SH_INS, { 
        inspection_id: insId,
        time: dateOnly_(), staff: d.staff, tree_id: d.tree_id, project_id: d.prj || '', 
        health: d.health, note: d.note, photo_url: photoUrlString, lat: d.lat || '', lng: d.lng || '',
        photos_total: (+d.photos_total || 0), // 🔥 [修正] 記錄應有相片數，追蹤補傳進度
        client_id: clientId, client_created_at: clientCreatedAt,
        photo_client_ids: '' // 預留欄位供後續相片使用
      });

      const updates = {};
      if(photoUrls.length > 0) updates.photo_url = photoUrls[0];
      if(d.health) updates.status = d.health;
      if(Object.keys(updates).length > 0) {
        updateTreeFields_(d.tree_id, d.prj, updates);
      }
      clearDataCache_();
      return json_({ok: true, inspection_id: insId, photo_urls: photoUrls});
    }
    else if(d.type === 'inspection_photo'){
      // 🔥 獨立相片防重檢查
      if (checkPhotoDuplicate_(SH_INS, clientId)) {
        return json_({ok: true, duplicate: true, message: '相片已存在'});
      }
      if (!d.inspection_id) {
        return json_({ok: false, error: '缺少 inspection_id'});
      }

      const photoUrl = prePhotoUrl; // 相片已在鎖外上傳

      if (photoUrl) {
        // 更新 inspections 表的 photo_url 同 photo_client_ids
        updateInspectionFields_(d.inspection_id, {
          photo_url_append: photoUrl,
          photo_client_ids_append: clientId
        });
        
        // 檢查是否為第一張相片，若是則更新 trees 的 photo_url
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_INS);
        if (sheet) {
          const data = sheet.getDataRange().getValues();
          const headers = data[0];
          const insIdIdx = headers.indexOf('inspection_id');
          const photoUrlIdx = headers.indexOf('photo_url');
          if (insIdIdx !== -1 && photoUrlIdx !== -1) {
            for (let i = 1; i < data.length; i++) {
              if (String(data[i][insIdIdx]) === String(d.inspection_id)) {
                const urls = String(data[i][photoUrlIdx] || '');
                if (urls.split(',').length === 1) {
                  updateTreeFields_(d.tree_id, d.prj, { photo_url: photoUrl });
                }
                break;
              }
            }
          }
        }
      }
      clearDataCache_();
      return json_({ok: true, photo_url: photoUrl});
    }
    else if(d.type === 'update_tree'){
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_TREES);
      if (sheet && clientId) {
        const data = sheet.getDataRange().getValues();
        if (data.length >= 2) {
          const headers = data[0];
          const idIdx = headers.indexOf('tree_id');
          const prjIdx = headers.indexOf('project_id');
          const clientIdx = headers.indexOf('last_client_id'); 
          
          if (idIdx !== -1 && clientIdx !== -1) {
            for (let i = 1; i < data.length; i++) {
              const idMatch = String(data[i][idIdx]) === String(d.tree_id);
              const prjMatch = (!d.prj || prjIdx === -1) ? true : String(data[i][prjIdx] || '') === String(d.prj);
              if (idMatch && prjMatch) {
                if (String(data[i][clientIdx]) === String(clientId)) {
                  return json_({ok: true, duplicate: true, message: '樹木更新已存在'});
                }
                break;
              }
            }
          }
        }
      }

      const updates = {};
      if(d.hk80_n && d.hk80_e && (d.lat === undefined || d.lat === '' || d.lng === undefined || d.lng === '')){
        const w = hk80ToWgs84_(d.hk80_n, d.hk80_e);
        if(w){
          if(d.lat === undefined || d.lat === '') d.lat = +w.lat.toFixed(6);
          if(d.lng === undefined || d.lng === '') d.lng = +w.lng.toFixed(6);
        }
      }

      ['name','status','tree_height','crown_width','dbh','ground_diameter','stem_length','crown_area','crown_volume','description','risk','project_id','lat','lng','level'].forEach(function(f){
        if(d[f] !== undefined && d[f] !== ''){
          updates[f] = d[f];
        }
      });

      if(d.lat !== undefined && d.lat !== '' && d.lng !== undefined && d.lng !== ''){
        const hk = wgs84ToHk80_(d.lat, d.lng);
        if(hk){
          updates.hk80_n = hk.N;
          updates.hk80_e = hk.E;
        }
      }

      if (clientId) {
        updates['last_client_id'] = clientId;
      }

      if(Object.keys(updates).length > 0) {
        updateTreeFields_(d.tree_id, d.prj, updates);
      }
      clearDataCache_();
      return json_({ok:true});
    }
    else if(d.type === 'create_project'){
      if (checkDuplicate_(SH_PRJ, clientId)) {
        const existingPid = getExistingIdByClientId_(SH_PRJ, clientId, 'project_id');
        return json_({ok: true, duplicate: true, project_id: existingPid, message: '地盤已存在'});
      }
      const pid = makeProjectId_(d.name, d.custom_id);
      appendByHeader_(SH_PRJ, { 
        project_id: pid, name: d.name, lat: d.lat, lng: d.lng, description: d.description || '', created_at: dateOnly_(),
        client_id: clientId, client_created_at: clientCreatedAt
      });
      clearDataCache_();
      return json_({ok:true, project_id: pid});
    }
    else if(d.type === 'create_tree'){
      if (checkDuplicate_(SH_TREES, clientId)) {
        const existingTid = getExistingIdByClientId_(SH_TREES, clientId, 'tree_id');
        return json_({ok: true, duplicate: true, tree_id: existingTid, message: '樹木已存在'});
      }
      const tid = preTreeId;
      let lat = d.lat, lng = d.lng, hkN = d.hk80_n, hkE = d.hk80_e;
      if((lat === undefined || lat === '') && hkN && hkE){ const w = hk80ToWgs84_(hkN, hkE); if(w){ lat = +w.lat.toFixed(6); lng = +w.lng.toFixed(6); } }
      if((hkN === undefined || hkN === '') && lat && lng){ const hk = wgs84ToHk80_(lat, lng); if(hk){ hkN = hk.N; hkE = hk.E; } }
      
      const photoUrls = prePhotoUrls; // 相片已在鎖外上傳

      appendByHeader_(SH_TREES, {
        tree_id: tid, name: d.name || '新樹木', lat: lat, lng: lng, status: d.status || 'Normal', risk: '',
        photo_url: photoUrls.length > 0 ? photoUrls[0] : '', description: d.description || '',
        tree_height: d.tree_height || '', crown_width: d.crown_width || '', dbh: d.dbh || '', ground_diameter: d.ground_diameter || '',
        stem_length: d.stem_length || '', crown_area: d.crown_area || '', crown_volume: d.crown_volume || '',
        project_id: d.project_id || '', level: d.level || '', hk80_n: hkN || '', hk80_e: hkE || '',
        client_id: clientId, client_created_at: clientCreatedAt
      });
      clearDataCache_();
      return json_({ok:true, tree_id: tid, photo_urls: photoUrls});
    }

    // 未支援的寫入型別：明確回報錯誤，不要靜默成功（避免前端誤以為成功）
    return json_({ok:false, error:'不支援的操作: ' + d.type});
  } catch (error) {
    console.error('Error in doPost:', error);
    return json_({ok:false, error:'伺服器寫入錯誤: ' + error.message});
  } finally {
    lock.releaseLock();
  }
}
/* ---------- 批量回填工具（保持不變） ---------- */
function backfillLatLng(){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_TREES);
  if(!sheet) return '❌ 找不到 trees 表';
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1,1,1,lastCol).getValues()[0];
  const nIdx = header.indexOf('hk80_n'), eIdx = header.indexOf('hk80_e');
  const latIdx = header.indexOf('lat'), lngIdx = header.indexOf('lng');
  if(nIdx === -1 || eIdx === -1) return '❌ 找不到 hk80_n/hk80_e 欄';
  if(latIdx === -1 || lngIdx === -1) return '❌ 找不到 lat/lng 欄';
  const lastRow = sheet.getLastRow();
  if(lastRow < 2) return '⚠️ 沒有資料需要回填';
  const data = sheet.getRange(2,1,lastRow-1,lastCol).getValues();
  let count = 0;
  for(let i=0;i<data.length;i++){
    const Nn = data[i][nIdx], Ee = data[i][eIdx];
    const hasHK = Nn !== '' && Ee !== '' && !isNaN(+Nn) && !isNaN(+Ee);
    const hasLL = data[i][latIdx] !== '' && data[i][lngIdx] !== '';
    if(hasHK && !hasLL){
      const w = hk80ToWgs84_(Nn, Ee);
      if(w){ data[i][latIdx] = +w.lat.toFixed(6); data[i][lngIdx] = +w.lng.toFixed(6); count++; }
    }
  }
  sheet.getRange(2,1,lastRow-1,lastCol).setValues(data);
  clearDataCache_();
  return '✅ 完成，已為 ' + count + ' 棵樹補上 WGS84 lat/lng';
}

function backfillHK80(){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_TREES);
  if(!sheet) return '❌ 找不到 trees 表';
  let lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1,1,1,lastCol).getValues()[0];
  let nIdx = header.indexOf('hk80_n');
  let eIdx = header.indexOf('hk80_e');
  if(nIdx === -1){ nIdx = lastCol; lastCol++; sheet.getRange(1, nIdx+1).setValue('hk80_n'); }
  if(eIdx === -1){ eIdx = lastCol; lastCol++; sheet.getRange(1, eIdx+1).setValue('hk80_e'); }
  const latIdx = header.indexOf('lat'), lngIdx = header.indexOf('lng');
  if(latIdx === -1 || lngIdx === -1) return '❌ 找不到 lat/lng 欄';
  const lastRow = sheet.getLastRow();
  if(lastRow < 2) return '⚠️ 沒有資料需要回填';
  const data = sheet.getRange(2,1,lastRow-1,lastCol).getValues();
  let count = 0;
  for(let i=0;i<data.length;i++){
    const hk = wgs84ToHk80_(data[i][latIdx], data[i][lngIdx]);
    if(hk){ data[i][nIdx]=hk.N; data[i][eIdx]=hk.E; count++; }
  }
  sheet.getRange(2,1,lastRow-1,lastCol).setValues(data);
  clearDataCache_();
  return '✅ 完成，已為 ' + count + ' 棵樹補上 HK80 座標';
}
/* ---------- 底層工具（優化版 + 動態表頭 + 防重輔助） ---------- */

/**
 * 🔥 檢查 client_id 是否已存在於指定的 Sheet 中
 */
function checkDuplicate_(sheetName, clientId) {
  if (!clientId) return false;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return false;
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return false;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const clientIdIdx = headers.indexOf('client_id');
  if (clientIdIdx === -1) return false; 
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const colData = sheet.getRange(2, clientIdIdx + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < colData.length; i++) {
    if (String(colData[i][0]) === String(clientId)) return true;
  }
  return false;
}

/**
 * 🔥 檢查相片 client_id 是否已存在 (掃描 photo_client_ids 欄位)
 */
function checkPhotoDuplicate_(sheetName, clientId) {
  if (!clientId) return false;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return false;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return false;
  const headers = data[0];
  const photoClientIdsIdx = headers.indexOf('photo_client_ids');
  if (photoClientIdsIdx === -1) return false;
  for (let i = 1; i < data.length; i++) {
    const idsStr = String(data[i][photoClientIdsIdx] || '');
    if (idsStr.split(',').indexOf(clientId) !== -1) return true;
  }
  return false;
}

/**
 * 🔥 [修正] 泛用：根據 client_id 取得指定欄位值（供重複時回傳原資料）
 */
function getExistingFieldByClientId_(sheetName, clientId, fieldName) {
  if (!clientId) return '';
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return '';
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return '';
  const headers = data[0];
  const cIdx = headers.indexOf('client_id');
  const fIdx = headers.indexOf(fieldName);
  if (cIdx === -1 || fIdx === -1) return '';
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][cIdx]) === String(clientId)) {
      return data[i][fIdx];
    }
  }
  return '';
}

/**
 * 🔥 根據 client_id 獲取已存在的 ID (用於 create_project / create_tree 返回原 ID)
 */
function getExistingIdByClientId_(sheetName, clientId, idFieldName) {
  return getExistingFieldByClientId_(sheetName, clientId, idFieldName);
}
/**
 * 批次更新樹木欄位（支援動態新增表頭）
 */
function updateTreeFields_(treeId, prj, fieldUpdates) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_TREES);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const lastCol = sheet.getLastColumn();
  let headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const idIdx = headers.indexOf('tree_id');
  const prjIdx = headers.indexOf('project_id');
  if (idIdx === -1) return;

  // 只讀 tree_id 一欄定位目標列
  let rowIndex = -1;
  const ids = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) !== String(treeId)) continue;
    if (prj && prjIdx !== -1) {
      const prjVal = sheet.getRange(2 + i, prjIdx + 1).getValue();
      if (String(prjVal || '') !== String(prj)) continue;
    }
    rowIndex = 2 + i;
    break;
  }
  if (rowIndex === -1) return;

  // 動態新增表頭（少見，只在有新欄位時觸發）
  const objKeys = Object.keys(fieldUpdates);
  const newHeaders = objKeys.filter(k => headers.indexOf(k) === -1);
  if (newHeaders.length > 0) {
    const startCol = headers.length + 1;
    sheet.getRange(1, startCol, 1, newHeaders.length).setValues([newHeaders]);
    // 為既有列補空字串，保持表格矩形
    sheet.getRange(2, startCol, lastRow - 1, newHeaders.length).setValue('');
    headers = headers.concat(newHeaders);
  }

  // 只更新目標列的格子（不再整表重寫）
  objKeys.forEach(field => {
    const colIdx = headers.indexOf(field);
    if (colIdx !== -1) sheet.getRange(rowIndex, colIdx + 1).setValue(fieldUpdates[field]);
  });
}

/**
 * 🔥 更新巡查記錄欄位（支援 append 語法與動態新增表頭）
 */
function updateInspectionFields_(inspectionId, fieldUpdates) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_INS);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const lastCol = sheet.getLastColumn();
  let headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const insIdIdx = headers.indexOf('inspection_id');
  if (insIdIdx === -1) return;

  // 只讀 inspection_id 一欄定位目標列
  let rowIndex = -1;
  const ids = sheet.getRange(2, insIdIdx + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(inspectionId)) { rowIndex = 2 + i; break; }
  }
  if (rowIndex === -1) return;

  // 準備實際要寫入/檢查的欄位名稱
  const actualFields = {};
  Object.keys(fieldUpdates).forEach(field => {
    if (field === 'photo_url_append') actualFields['photo_url'] = fieldUpdates[field];
    else if (field === 'photo_client_ids_append') actualFields['photo_client_ids'] = fieldUpdates[field];
    else actualFields[field] = fieldUpdates[field];
  });

  const objKeys = Object.keys(actualFields);
  const newHeaders = objKeys.filter(k => headers.indexOf(k) === -1);
  if (newHeaders.length > 0) {
    const startCol = headers.length + 1;
    sheet.getRange(1, startCol, 1, newHeaders.length).setValues([newHeaders]);
    sheet.getRange(2, startCol, lastRow - 1, newHeaders.length).setValue('');
    headers = headers.concat(newHeaders);
  }

  Object.keys(fieldUpdates).forEach(field => {
    if (field === 'photo_url_append') {
      const pIdx = headers.indexOf('photo_url');
      if (pIdx !== -1) {
        let existing = String(sheet.getRange(rowIndex, pIdx + 1).getValue() || '');
        sheet.getRange(rowIndex, pIdx + 1).setValue(existing ? (existing + ',' + fieldUpdates[field]) : fieldUpdates[field]);
      }
    } else if (field === 'photo_client_ids_append') {
      const pIdx = headers.indexOf('photo_client_ids');
      if (pIdx !== -1) {
        let existing = String(sheet.getRange(rowIndex, pIdx + 1).getValue() || '');
        sheet.getRange(rowIndex, pIdx + 1).setValue(existing ? (existing + ',' + fieldUpdates[field]) : fieldUpdates[field]);
      }
    } else {
      const colIdx = headers.indexOf(field);
      if (colIdx !== -1) sheet.getRange(rowIndex, colIdx + 1).setValue(fieldUpdates[field]);
    }
  });
}

/**
 * 按表頭追加行（支援動態新增表頭）
 */
function appendByHeader_(sheetName, obj){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) { console.error('Sheet not found:', sheetName); return; }
  
  let lastCol = sheet.getLastColumn();
  let headers = [];
  if (lastCol > 0) {
    headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  }
  
  const newHeaders = [];
  const objKeys = Object.keys(obj);
  for (let i = 0; i < objKeys.length; i++) {
    if (headers.indexOf(objKeys[i]) === -1) newHeaders.push(objKeys[i]);
  }
  
  if (newHeaders.length > 0) {
    const startCol = lastCol + 1;
    sheet.getRange(1, startCol, 1, newHeaders.length).setValues([newHeaders]);
    headers = headers.concat(newHeaders);
    lastCol = headers.length;
  }
  
  const row = headers.map(h => obj.hasOwnProperty(h) ? obj[h] : '');
  sheet.appendRow(row);
}

function rows_(name){
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) return [];
  const v = sheet.getDataRange().getValues();
  if(v.length === 0) return [];
  const h = v.shift();
  return v.map(r => { const o = {}; h.forEach((k,i) => o[k] = r[i]); return o; });
}

function json_(o){
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}







