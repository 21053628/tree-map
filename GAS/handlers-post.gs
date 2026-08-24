function handleCheckin_(d, clientId, clientCreatedAt){
  if (checkDuplicate_(SH_CHK, clientId)) {
    return json_({ok: true, duplicate: true, message: 'OK_DUPLICATE'});
  }
  appendByHeader_(SH_CHK, { 
    time: dateOnly_(), staff: d.staff, tree_id: d.tree_id, project_id: d.prj || '', 
    lat: d.lat || '', lng: d.lng || '',
    client_id: clientId, client_created_at: clientCreatedAt
  });
  markDuplicateFast_(clientId);
  clearDataCache_();
  return json_({ok:true});
}

function handleInspection_(d, clientId, clientCreatedAt, prePhotoUrls){
  if (checkDuplicate_(SH_INS, clientId)) {
    const existingInsId = getExistingIdByClientId_(SH_INS, clientId, 'inspection_id');
    // 🔥 [修正] 重複時回傳已存在相片，方便前端對帳／重試
    const existingPhotos = getExistingFieldByClientId_(SH_INS, clientId, 'photo_url');
    const photoUrls = existingPhotos ? String(existingPhotos).split(',').filter(Boolean) : [];
    return json_({ok: true, duplicate: true, inspection_id: existingInsId, message: 'OK_DUPLICATE', photo_urls: photoUrls});
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
  markDuplicateFast_(clientId);

  const updates = {};
  if(photoUrls.length > 0) updates.photo_url = photoUrls[0];
  // 🔥 [P1 修復] 用 != null 取代 truthy 檢查，避免 health 為空字串時漏更新 tree status
  if(d.health != null && d.health !== '') updates.status = d.health;
  if(Object.keys(updates).length > 0) {
    // 🔥 [P0 修復] 巡查改動樹木時一併 bump updated_at，令版本衝突檢測一致
    if(typeof ensureTreeUpdatedAtColumn_ === 'function') ensureTreeUpdatedAtColumn_();
    updates.updated_at = new Date().toISOString();
    updateTreeFields_(d.tree_id, d.prj, updates);
  }
  clearDataCache_();
  return json_({ok: true, inspection_id: insId, photo_urls: photoUrls});
}

function handleInspectionPhoto_(d, clientId, prePhotoUrl){
  // 🔥 獨立相片防重檢查
  if (checkPhotoDuplicate_(SH_INS, clientId)) {
    return json_({ok: true, duplicate: true, message: 'OK_DUPLICATE'});
  }
  if (!d.inspection_id) {
    return typeof errJson_==='function' ? errJson_(ERROR_CODES_.VALIDATION_FAILED, [{field:'inspection_id', code:'REQUIRED'}]) : json_({ok:false, error_code:ERROR_CODES_.VALIDATION_FAILED, error:ERROR_CODES_.VALIDATION_FAILED, details:[{field:'inspection_id', code:'REQUIRED'}]});
  }
  // 🔥 [P0 修復] 驗證 inspection_id 對應的 tree_id 和 project_id 與請求一致，防止跨樹錯配
  if (d.tree_id || d.prj) {
    var insTreeId = getInspectionTreeId_(d.inspection_id);
    var insPrjId = getInspectionProjectId_(d.inspection_id);
    if (insTreeId !== null && d.tree_id && String(insTreeId) !== String(d.tree_id)) {
      return typeof errJson_==='function' ? errJson_(ERROR_CODES_.VALIDATION_FAILED, [{field:'tree_id', code:'INVALID_VALUE'}]) : json_({ok:false, error_code:ERROR_CODES_.VALIDATION_FAILED, error:ERROR_CODES_.VALIDATION_FAILED, details:[{field:'tree_id', code:'INVALID_VALUE'}]});
    }
    if (insPrjId !== null && d.prj && String(insPrjId) !== String(d.prj)) {
      return typeof errJson_==='function' ? errJson_(ERROR_CODES_.VALIDATION_FAILED, [{field:'project_id', code:'INVALID_VALUE'}]) : json_({ok:false, error_code:ERROR_CODES_.VALIDATION_FAILED, error:ERROR_CODES_.VALIDATION_FAILED, details:[{field:'project_id', code:'INVALID_VALUE'}]});
    }
  }

  const photoUrl = prePhotoUrl; // 相片已在鎖外上傳

  if (photoUrl) {
    // 更新 inspections 表的 photo_url 同 photo_client_ids
    updateInspectionFields_(d.inspection_id, {
      photo_url_append: photoUrl,
      photo_client_ids_append: clientId
    });
    markDuplicateFast_(clientId);

    // 檢查是否為第一張相片，若是則更新 trees 的 photo_url
    // 🔥 [Bugfix] 用精準查詢取代全表掃描 getDataRange()
    const existingPhotoUrl = getInspectionPhotoUrl_(d.inspection_id);
    if (existingPhotoUrl !== null) {
      const urlCount = String(existingPhotoUrl).split(',').filter(Boolean).length;
      // 🔥 [P0 修復] 更新 trees 前驗證 tree_id 真係屬於 d.prj，防止跨地盤相片錯配
      if (urlCount === 1 && d.tree_id && d.prj && treeIdExists_(d.tree_id, d.prj)) {
        // 🔥 [P0 修復] 相片更新亦 bump updated_at，令版本衝突檢測一致
        if(typeof ensureTreeUpdatedAtColumn_ === 'function') ensureTreeUpdatedAtColumn_();
        updateTreeFields_(d.tree_id, d.prj, { photo_url: photoUrl, updated_at: new Date().toISOString() });
      }
    }
  }
  clearDataCache_();
  return json_({ok: true, photo_url: photoUrl});
}

function handleUpdateTree_(d, clientId){
  const sheet = getSheetByNameRobust_(SH_TREES);
  let targetFound = false;
  let currentUpdatedAt = '';
  if (sheet) {
    const data = sheet.getDataRange().getValues();
    if (data.length >= 2) {
      const headers = data[0].map(function(k){ return String(k||'').replace(/^\ufeff/, '').trim(); });
      const idIdx = headers.indexOf('tree_id');
      const prjIdx = headers.indexOf('project_id');
      const clientIdx = headers.indexOf('last_client_id');
      const updatedAtIdx = headers.indexOf('updated_at');

      if (idIdx !== -1) {
        for (let i = 1; i < data.length; i++) {
          const idMatch = (typeof isSameId_ === 'function') ? isSameId_(String(data[i][idIdx]), String(d.tree_id)) : String(data[i][idIdx]) === String(d.tree_id);
          const prjMatch = (!d.prj || prjIdx === -1) ? true : String(data[i][prjIdx] || '') === String(d.prj);
          if (idMatch && prjMatch) {
            targetFound = true;
            if (updatedAtIdx !== -1) currentUpdatedAt = String(data[i][updatedAtIdx] || '').trim();
            // 冪等檢查：只有 clientId 存在時先對比 last_client_id
            if (clientId && clientIdx !== -1 && String(data[i][clientIdx]) === String(clientId)) {
              return json_({ok: true, duplicate: true, message: 'OK_DUPLICATE'});
            }
            break;
          }
        }
      }
    }
  }
  // 🔥 [P0 修復] 樹木唔存在時必須回報錯誤（而非靜默 ok:true），
  // 否則離線同步會誤標記為已同步而永久丟失呢筆更新
  if(!targetFound){
    return typeof errJson_==='function' ? errJson_(ERROR_CODES_.CONFLICT, [{field:'tree_id', code:'NOT_FOUND'}]) : json_({ok:false, error_code:ERROR_CODES_.CONFLICT, error:ERROR_CODES_.CONFLICT, details:[{field:'tree_id', code:'NOT_FOUND'}]});
  }

  // 🔥 [P0 修復] 版本衝突檢測：若前端帶咗 base_updated_at，比較 server 當前 updated_at
  // 兩邊都非空且唔一致 → 衝突，回傳最新資料等前端處理
  if(d.base_updated_at !== undefined && d.base_updated_at !== null && String(d.base_updated_at).trim() !== '' && currentUpdatedAt !== ''){
    if(String(d.base_updated_at).trim() !== currentUpdatedAt){
      return typeof errJson_==='function' ? errJson_(ERROR_CODES_.CONFLICT, [{field:'tree_id', code:'VERSION_CONFLICT', current_updated_at: currentUpdatedAt}]) : json_({ok:false, error_code:ERROR_CODES_.CONFLICT, error:ERROR_CODES_.CONFLICT, details:[{field:'tree_id', code:'VERSION_CONFLICT', current_updated_at: currentUpdatedAt}]});
    }
  }

  // 🔥 [P0 修復] 確保 updated_at 欄位存在（舊表會自動附加）
  if(typeof ensureTreeUpdatedAtColumn_ === 'function') ensureTreeUpdatedAtColumn_();

  // 🔥 [Phase10] 樹木編號改名（可選欄位 new_tree_id）
  let renamedTo = null;
  const rawNewId = String(d.new_tree_id == null ? '' : d.new_tree_id).trim();
  if (rawNewId && rawNewId !== String(d.tree_id)) {
    if (rawNewId.length > 64 || !/^[\p{L}\p{N}._-]+$/u.test(rawNewId)) {
      return typeof errJson_==='function' ? errJson_(ERROR_CODES_.VALIDATION_FAILED, [{field:'new_tree_id', code:'INVALID_FORMAT'}]) : json_({ok:false, error_code:ERROR_CODES_.VALIDATION_FAILED, error:ERROR_CODES_.VALIDATION_FAILED, details:[{field:'new_tree_id', code:'INVALID_FORMAT'}]});
    }
    if (treeIdTaken_(rawNewId, d.prj)) {
      return typeof errJson_==='function' ? errJson_(ERROR_CODES_.CONFLICT, [{field:'new_tree_id', code:'ALREADY_EXISTS'}]) : json_({ok:false, error_code:ERROR_CODES_.CONFLICT, error:ERROR_CODES_.CONFLICT, details:[{field:'new_tree_id', code:'ALREADY_EXISTS'}]});
    }
    renamedTo = rawNewId;
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

  if (renamedTo) updates['tree_id'] = renamedTo;

  // 🔥 [P0 修復] 每次寫入都 bump updated_at
  if(Object.keys(updates).length > 0) {
    var now = new Date().toISOString();
    updates['updated_at'] = now;
    updateTreeFields_(d.tree_id, d.prj, updates);
  }
  if (renamedTo) renameTreeReferences_(d.tree_id, renamedTo, d.prj);
  markDuplicateFast_(clientId);
  clearDataCache_();
  return json_(renamedTo ? {ok:true, renamed:true, new_tree_id:renamedTo} : {ok:true});
}

function handleCreateProject_(d, clientId, clientCreatedAt){
  if (checkDuplicate_(SH_PRJ, clientId)) {
    const existingPid = getExistingIdByClientId_(SH_PRJ, clientId, 'project_id');
    return json_({ok: true, duplicate: true, project_id: existingPid, message: 'OK_DUPLICATE'});
  }
  const pid = makeProjectId_(d.name, d.custom_id);
  appendByHeader_(SH_PRJ, { 
    project_id: pid, name: d.name, lat: d.lat, lng: d.lng, description: d.description || '', created_at: dateOnly_(),
    client_id: clientId, client_created_at: clientCreatedAt
  });
  markDuplicateFast_(clientId);
  clearDataCache_();
  return json_({ok:true, project_id: pid});
}

function handleCreateTree_(d, clientId, clientCreatedAt, prePhotoUrls, preTreeId){
  if (checkDuplicate_(SH_TREES, clientId)) {
    const existingTid = getExistingIdByClientId_(SH_TREES, clientId, 'tree_id');
    return json_({ok: true, duplicate: true, tree_id: existingTid, message: 'OK_DUPLICATE'});
  }
  // 🔥 [P0 修復] 驗證 project_id 確實存在於 projects 表，避免建立孤兒樹木
  if (!d.project_id) {
    return typeof errJson_==='function' ? errJson_(ERROR_CODES_.VALIDATION_FAILED, [{field:'project_id', code:'REQUIRED'}]) : json_({ok:false, error_code:ERROR_CODES_.VALIDATION_FAILED, error:ERROR_CODES_.VALIDATION_FAILED, details:[{field:'project_id', code:'REQUIRED'}]});
  }
  var allProjects = getProjectIds_();
  if (allProjects.indexOf(String(d.project_id).trim()) === -1) {
    return typeof errJson_==='function' ? errJson_(ERROR_CODES_.VALIDATION_FAILED, [{field:'project_id', code:'INVALID_VALUE'}]) : json_({ok:false, error_code:ERROR_CODES_.VALIDATION_FAILED, error:ERROR_CODES_.VALIDATION_FAILED, details:[{field:'project_id', code:'INVALID_VALUE'}]});
  }
  // 🔥 [Phase8] 鎖內最終確認＋自動接號（防併發衝突）
  let tid;
  if (preTreeId) {
    // 🔥 [P1 修復] 驗證自訂 tree_id 格式（只容許字母數字._-）
    if (!/^[\p{L}\p{N}._-]+$/u.test(String(preTreeId))) {
      return typeof errJson_==='function' ? errJson_(ERROR_CODES_.VALIDATION_FAILED, [{field:'tree_id', code:'INVALID_FORMAT'}]) : json_({ok:false, error_code:ERROR_CODES_.VALIDATION_FAILED, error:ERROR_CODES_.VALIDATION_FAILED, details:[{field:'tree_id', code:'INVALID_FORMAT'}]});
    }
    if (treeIdExists_(preTreeId, d.project_id)) {
      return typeof errJson_==='function' ? errJson_(ERROR_CODES_.CONFLICT, [{field:'tree_id', code:'ALREADY_EXISTS'}]) : json_({ok:false, error_code:ERROR_CODES_.CONFLICT, error:ERROR_CODES_.CONFLICT, details:[{field:'tree_id', code:'ALREADY_EXISTS'}]});
    }
    tid = normalizeTreeId_(preTreeId);
  } else {
    tid = nextTreeId_(d.project_id); // 例：地盤最大係 6 → 7
  }
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
    client_id: clientId, client_created_at: clientCreatedAt,
    // 🔥 [P0 修復] 初始版本時間戳（appendByHeader_ 會自動建立欄位）
    updated_at: new Date().toISOString()
  });
  markDuplicateFast_(clientId);
  clearDataCache_();
  return json_({ok:true, tree_id: tid, photo_urls: photoUrls});
}