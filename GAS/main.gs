/* ---------- GET：公開，高層隨時查看 ---------- */
function doGet(e){
  try {
    const p = (e && e.parameter) || {};
    const action = p.action || 'trees';
    if (typeof validateGetParams_ === 'function') {
      const v = validateGetParams_(action, p);
      if (v) return v;
    }
    if(action === 'bootstrap'){ if(String(p.nocache)==='1'||String(p.bust)==='1'){ try{ cacheRemoveChunked_(BOOTSTRAP_CACHE_KEY); }catch(e){} } return handleGetBootstrap_(p); }
    if(action === 'ping') return handleGetPing_();
    if(action === 'tree') return handleGetTree_(p);
    if(action === 'inspections') return handleGetInspections_(p);
    if(action === 'projects'){ 
      // support nocache=1 for projects too
      if(String(p.nocache)==='1' || String(p.bust)==='1'){ try{ cacheRemoveChunked_(PROJECTS_CACHE_KEY); }catch(e){} }
      return handleGetProjects_(); 
    }
    if(action === 'species') return handleGetSpecies_();
    if(String(p.nocache)==='1'||String(p.bust)==='1'){ try{ cacheRemoveChunked_(TREES_CACHE_KEY); }catch(e){} }
    return handleGetTrees_(p);
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    if (typeof errJsonWithLog_ === 'function') return errJsonWithLog_(ERROR_CODES_.INTERNAL_READ_ERROR, msg);
    console.error('doGet error:', err);
    return json_({ok:false, error_code: ERROR_CODES_.INTERNAL_READ_ERROR, error: ERROR_CODES_.INTERNAL_READ_ERROR});
  }
}

/* ---------- POST：寫入一定要密碼 Token ---------- */
function doPost(e){
  // 1️⃣ 解析 + 認證（不需鎖定，避免無效請求/登入長期佔鎖）
  if(!e || !e.postData || !e.postData.contents){
    return typeof errJson_ === 'function' ? errJson_(ERROR_CODES_.INVALID_REQUEST) : json_({ok:false, error_code: ERROR_CODES_.INVALID_REQUEST, error: ERROR_CODES_.INVALID_REQUEST});
  }
  let d;
  try {
    d = JSON.parse(e.postData.contents);
  } catch(err) {
    var mj = err && err.message ? err.message : String(err);
    if (typeof errJsonWithLog_ === 'function') return errJsonWithLog_(ERROR_CODES_.INVALID_JSON, mj);
    return json_({ok:false, error_code: ERROR_CODES_.INVALID_JSON, error: ERROR_CODES_.INVALID_JSON});
  }

  // schema validation：先校驗格式（login 也校驗，但不消耗 rate-limit）
  if (typeof validatePostPayload_ === 'function') {
    const vr = validatePostPayload_(d);
    if (vr) return vr;
  }

  if(d.type === 'login'){
    if(!loginAllowed_()){
      return typeof errJson_ === 'function' ? errJson_(ERROR_CODES_.RATE_LIMITED) : json_({ok:false, error_code: ERROR_CODES_.RATE_LIMITED, error: ERROR_CODES_.RATE_LIMITED});
    }
    if(checkPassword_(d.password)){
      resetLoginFailures_();
      const sessionToken = createToken_();
      const csrfToken = issueCsrfToken_(sessionToken);
      return json_({ok:true, token: sessionToken, csrf_token: csrfToken});
    }
    loginFailed_();
    return typeof errJson_ === 'function' ? errJson_(ERROR_CODES_.AUTH_FAILED) : json_({ok:false, error_code: ERROR_CODES_.AUTH_FAILED, error: ERROR_CODES_.AUTH_FAILED});
  }

  if(!isValidToken_(d.token) && d.type !== 'login'){
    return typeof errJson_ === 'function' ? errJson_(ERROR_CODES_.UNAUTHORIZED) : json_({ok:false, error_code: ERROR_CODES_.UNAUTHORIZED, error: ERROR_CODES_.UNAUTHORIZED});
  }

  // 🔐 CSRF 驗證：非 login 的寫入請求必須攜帶合法 CSRF Token（login 本身除外）
  // 🔥 [P0 修復] 改用 peekCsrfToken_（唯讀檢查），成功後由 withCsrfRotation_ 在回傳時旋轉
  var csrfTokenFromReq = '';
  if(d.type !== 'login'){
    csrfTokenFromReq = getCsrfTokenFromRequest_(e, d);
    if(!peekCsrfToken_(csrfTokenFromReq, d.token)){
      return typeof errJson_ === 'function' ? errJson_(ERROR_CODES_.CSRF_INVALID) : json_({ok:false, error_code: ERROR_CODES_.CSRF_INVALID, error: ERROR_CODES_.CSRF_INVALID});
    }
  }

  // 🔥 提取前端傳來的冪等性鍵值
  const clientId = d.client_id || '';
  const clientCreatedAt = d.client_created_at || '';

  // 📍 新增／編輯位置必須位於香港範圍；在相片上傳及寫入試算表前先攔截
  if (d.type === 'create_tree' || d.type === 'create_project' || d.type === 'update_tree') {
    const requireLocation = d.type === 'create_tree' || d.type === 'create_project';
    if (!validateLocationForWrite_(d, !requireLocation)) {
      return typeof errJson_ === 'function' ? errJson_(ERROR_CODES_.INVALID_LOCATION) : json_({ok:false, error_code: ERROR_CODES_.INVALID_LOCATION, error: ERROR_CODES_.INVALID_LOCATION});
    }
  }

  // 🔥 [Bugfix] 快速防重檢查：避免鎖外相片上傳造成孤兒檔案
  // 如果 client_id 最近已成功處理，直接跳過相片上傳（等鎖內 handler 處理 duplicate）
  const skipPhotoUpload = clientId && d.type !== 'login' && checkDuplicateFast_(clientId);

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
        return json_({ok: true, duplicate: true, inspection_id: existingInsId, message: 'OK_DUPLICATE', photo_urls: photoUrls});
      }
      const isDeferred = (+d.photos_total > 0 && (!d.photo_base64 || d.photo_base64 === '' || (Array.isArray(d.photo_base64) && d.photo_base64.length === 0)));
      if(!skipPhotoUpload && !isDeferred && d.photo_base64){
        prePhotoUrls = uploadPhotos_(d.tree_id, d.photo_base64, 0);
      }
    }
    else if(d.type === 'inspection_photo'){
      if (checkPhotoDuplicate_(SH_INS, clientId)) {
        return json_({ok: true, duplicate: true, message: 'OK_DUPLICATE'});
      }
      if (!d.inspection_id) {
        return typeof errJson_ === 'function' ? errJson_(ERROR_CODES_.VALIDATION_FAILED, [{field:'inspection_id', code:'REQUIRED'}]) : json_({ok:false, error_code: ERROR_CODES_.VALIDATION_FAILED, error: ERROR_CODES_.VALIDATION_FAILED, details:[{field:'inspection_id', code:'REQUIRED'}]});
      }
      if(!skipPhotoUpload && d.photo_base64){
        prePhotoUrl = uploadPhotoStrict_(d.tree_id, d.photo_base64, d.photo_index || 0);
      }
    }
    else if(d.type === 'create_tree'){
      if (checkDuplicate_(SH_TREES, clientId)) {
        const existingTid = getExistingIdByClientId_(SH_TREES, clientId, 'tree_id');
        return json_({ok: true, duplicate: true, tree_id: existingTid, message: '樹木已存在'});
      }

      // 🔥 [Phase8] 用戶指定編號：同地盤重複即拒絕（喺相片上傳前檢查，避免浪費上傳）
      const reqTid = String(d.tree_id == null ? '' : d.tree_id).trim();
      if (reqTid && treeIdExists_(reqTid, d.project_id)) {
        return typeof errJson_ === 'function' ? errJson_(ERROR_CODES_.CONFLICT, [{field:'tree_id', code:'ALREADY_EXISTS'}]) : json_({ok:false, error_code: ERROR_CODES_.CONFLICT, error: ERROR_CODES_.CONFLICT, details:[{field:'tree_id', code:'ALREADY_EXISTS'}]});
      }

      // 🔥 [Phase8] 自動編號改喺鎖內分配；preTreeId=null 代表需要自動接號
      preTreeId = reqTid || null;
      if(!skipPhotoUpload && d.photo_base64){
        prePhotoUrls = uploadPhotos_(preTreeId || ('tmp' + Date.now()), d.photo_base64, 0);
      }
    }
  } catch(err) {
    var umsg = err && err.message ? err.message : String(err);
    if (typeof errJsonWithLog_ === 'function') return errJsonWithLog_(ERROR_CODES_.UPLOAD_FAILED, umsg);
    return json_({ok:false, error_code: ERROR_CODES_.UPLOAD_FAILED, error: ERROR_CODES_.UPLOAD_FAILED});
  }

  // 3️⃣ 鎖住「試算表讀寫」段（相片上傳已完成，不再長期佔鎖）
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    var lmsg = err && err.message ? err.message : String(err);
    if (typeof errJsonWithLog_ === 'function') return errJsonWithLog_(ERROR_CODES_.SYSTEM_BUSY, lmsg);
    return json_({ok:false, error_code: ERROR_CODES_.SYSTEM_BUSY, error: ERROR_CODES_.SYSTEM_BUSY});
  }

  try {
    // 🔥 [P0 修復] 鎖內重新驗證 CSRF Token（避免並發競爭：兩個請求在 lock 外 peek 都 pass，
    // 但第一個 rotate 消耗後，第二個在 lock 內才能發現 token 已失效）。
    if (d.type !== 'login' && csrfTokenFromReq) {
      if (!peekCsrfToken_(csrfTokenFromReq, d.token)) {
        return typeof errJson_ === 'function' ? errJson_(ERROR_CODES_.CSRF_INVALID) : json_({ok:false, error_code: ERROR_CODES_.CSRF_INVALID, error: ERROR_CODES_.CSRF_INVALID});
      }
    }

    var _result = null;
    if(d.type === 'checkin'){
      _result = handleCheckin_(d, clientId, clientCreatedAt);
    }
    else if(d.type === 'inspection'){
      _result = handleInspection_(d, clientId, clientCreatedAt, prePhotoUrls);
      // 🔥 [P0 修復] 鎖內發現重複（race）時清理孤兒相片
      if(prePhotoUrls.length && _result && typeof _result.getContent === 'function'){
        try{
          var insRaw = _result.getContent();
          var insObj = JSON.parse(insRaw);
          if(insObj && insObj.duplicate === true) deleteDriveFilesByUrls_(prePhotoUrls);
        }catch(e){}
      }
    }
    else if(d.type === 'inspection_photo'){
      _result = handleInspectionPhoto_(d, clientId, prePhotoUrl);
    }
    else if(d.type === 'update_tree'){
      _result = handleUpdateTree_(d, clientId);
    }
    else if(d.type === 'create_project'){
      _result = handleCreateProject_(d, clientId, clientCreatedAt);
    }
    else if(d.type === 'create_tree'){
      _result = handleCreateTree_(d, clientId, clientCreatedAt, prePhotoUrls, preTreeId);
      // 🔥 [P0 修復] 鎖內失敗（CONFLICT 等）時清理孤兒相片，避免 Drive 積累垃圾
      if(prePhotoUrls.length && _result && typeof _result.getContent === 'function'){
        try{
          var ctRaw = _result.getContent();
          var ctObj = JSON.parse(ctRaw);
          if(!(ctObj && ctObj.ok === true)) deleteDriveFilesByUrls_(prePhotoUrls);
        }catch(e){}
      }
    }

    // 未支援的寫入型別：明確回報錯誤，不要靜默成功（避免前端誤以為成功）
    if (_result === null) {
      if (typeof errJsonWithLog_ === 'function') console.error('[UNSUPPORTED_OPERATION] type=' + d.type);
      return typeof errJson_ === 'function' ? errJson_(ERROR_CODES_.UNSUPPORTED_OPERATION, [{field:'type', code:'UNSUPPORTED'}]) : json_({ok:false, error_code: ERROR_CODES_.UNSUPPORTED_OPERATION, error: ERROR_CODES_.UNSUPPORTED_OPERATION, details:[{field:'type', code:'UNSUPPORTED'}]});
    }

    // 🔥 [P0 修復] 成功時旋轉 CSRF Token 並注入新 token 到回應，前端下次請求使用新 token
    if (d.type !== 'login' && csrfTokenFromReq) {
      try {
        var resRaw = _result.getContent();
        var resObj = JSON.parse(resRaw);
        if (resObj && resObj.ok === true && typeof rotateCsrfToken_ === 'function') {
          var newCsrf = rotateCsrfToken_(csrfTokenFromReq, d.token);
          if (newCsrf) {
            resObj.csrf_token = newCsrf;
            return ContentService.createTextOutput(JSON.stringify(resObj)).setMimeType(ContentService.MimeType.JSON);
          }
        }
      } catch(e) {}
    }
    return _result;
  } catch (error) {
    var wmsg = error && error.message ? error.message : String(error);
    if (typeof errJsonWithLog_ === 'function') return errJsonWithLog_(ERROR_CODES_.INTERNAL_WRITE_ERROR, wmsg);
    console.error('Error in doPost:', error);
    return json_({ok:false, error_code: ERROR_CODES_.INTERNAL_WRITE_ERROR, error: ERROR_CODES_.INTERNAL_WRITE_ERROR});
  } finally {
    lock.releaseLock();
  }
}