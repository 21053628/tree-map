/* ---------- GET：公開，高層隨時查看 ---------- */
function doGet(e){
  try {
    const p = (e && e.parameter) || {};
    const action = p.action || 'trees';
    if(action === 'bootstrap') return handleGetBootstrap_();
    if(action === 'ping') return handleGetPing_();
    if(action === 'tree') return handleGetTree_(p);
    if(action === 'inspections') return handleGetInspections_(p);
    if(action === 'projects') return handleGetProjects_();
    return handleGetTrees_(p);
  } catch (err) {
    console.error('doGet error:', err);
    return json_({ok:false, error:'伺服器讀取錯誤'});
  }
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
      const sessionToken = createToken_();
      const csrfToken = issueCsrfToken_(sessionToken);
      return json_({ok:true, token: sessionToken, csrf_token: csrfToken});
    }
    loginFailed_();
    return json_({ok:false, error:'密碼錯誤'});
  }

  if(!isValidToken_(d.token)){
    return json_({ok:false, error:'UNAUTHORIZED'});
  }

  // 🔐 CSRF 驗證：非 login 的寫入請求必須攜帶合法 CSRF Token（login 本身除外）
  if(!isValidCsrfToken_(getCsrfTokenFromRequest_(e, d), d.token)){
    return json_({ok:false, error:'CSRF_TOKEN_INVALID'});
  }

  // 🔥 提取前端傳來的冪等性鍵值
  const clientId = d.client_id || '';
  const clientCreatedAt = d.client_created_at || '';

  // 📍 新增／編輯位置必須位於香港範圍；在相片上傳及寫入試算表前先攔截
  if (d.type === 'create_tree' || d.type === 'create_project' || d.type === 'update_tree') {
    const requireLocation = d.type === 'create_tree' || d.type === 'create_project';
    if (!validateLocationForWrite_(d, !requireLocation)) {
      return json_({ok:false, error:hk80LocationError_()});
    }
  }

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

      // 🔥 [Phase8] 用戶指定編號：同地盤重複即拒絕（喺相片上傳前檢查，避免浪費上傳）
      const reqTid = String(d.tree_id == null ? '' : d.tree_id).trim();
      if (reqTid && treeIdExists_(reqTid, d.project_id)) {
        return json_({ok:false, error:'樹木編號 ' + reqTid + ' 已存在於此地盤，請改用其他編號（或留空自動編號）'});
      }

      // 🔥 [Phase8] 自動編號改喺鎖內分配；preTreeId=null 代表需要自動接號
      preTreeId = reqTid || null;
      if(d.photo_base64){
        prePhotoUrls = uploadPhotos_(preTreeId || ('tmp' + Date.now()), d.photo_base64, 0);
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
      return handleCheckin_(d, clientId, clientCreatedAt);
    }
    else if(d.type === 'inspection'){
      return handleInspection_(d, clientId, clientCreatedAt, prePhotoUrls);
    }
    else if(d.type === 'inspection_photo'){
      return handleInspectionPhoto_(d, clientId, prePhotoUrl);
    }
    else if(d.type === 'update_tree'){
      return handleUpdateTree_(d, clientId);
    }
    else if(d.type === 'create_project'){
      return handleCreateProject_(d, clientId, clientCreatedAt);
    }
    else if(d.type === 'create_tree'){
      return handleCreateTree_(d, clientId, clientCreatedAt, prePhotoUrls, preTreeId);
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