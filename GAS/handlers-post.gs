function handleCheckin_(d, clientId, clientCreatedAt){
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

function handleInspection_(d, clientId, clientCreatedAt, prePhotoUrls){
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

function handleInspectionPhoto_(d, clientId, prePhotoUrl){
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

function handleUpdateTree_(d, clientId){
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

  // 🔥 [Phase10] 樹木編號改名（可選欄位 new_tree_id）
  let renamedTo = null;
  const rawNewId = String(d.new_tree_id == null ? '' : d.new_tree_id).trim();
  if (rawNewId && rawNewId !== String(d.tree_id)) {
    if (rawNewId.length > 64 || !/^[\p{L}\p{N}._-]+$/u.test(rawNewId)) {
      return json_({ok:false, error:'樹木編號格式不正確（只可用英數、中文、點、底線、連字號，最多64字元）'});
    }
    if (treeIdTaken_(rawNewId, d.prj)) {
      return json_({ok:false, error:'樹木編號 ' + rawNewId + ' 已存在於此地盤，請改用其他編號'});
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

  if(Object.keys(updates).length > 0) {
    updateTreeFields_(d.tree_id, d.prj, updates);
  }
  if (renamedTo) renameTreeReferences_(d.tree_id, renamedTo, d.prj);
  clearDataCache_();
  return json_(renamedTo ? {ok:true, renamed:true, new_tree_id:renamedTo} : {ok:true});
}

function handleCreateProject_(d, clientId, clientCreatedAt){
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

function handleCreateTree_(d, clientId, clientCreatedAt, prePhotoUrls, preTreeId){
  if (checkDuplicate_(SH_TREES, clientId)) {
    const existingTid = getExistingIdByClientId_(SH_TREES, clientId, 'tree_id');
    return json_({ok: true, duplicate: true, tree_id: existingTid, message: '樹木已存在'});
  }
  // 🔥 [Phase8] 鎖內最終確認＋自動接號（防併發衝突）
  let tid;
  if (preTreeId) {
    if (treeIdExists_(preTreeId, d.project_id)) {
      return json_({ok:false, error:'樹木編號 ' + preTreeId + ' 已存在於此地盤，請改用其他編號（或留空自動編號）'});
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
    client_id: clientId, client_created_at: clientCreatedAt
  });
  clearDataCache_();
  return json_({ok:true, tree_id: tid, photo_urls: photoUrls});
}