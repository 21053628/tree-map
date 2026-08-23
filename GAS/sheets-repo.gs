/* ---------- 底層工具（固定 Schema v1 + 未知欄忽略 + 額外欄保留） ---------- */
function getSheetByNameRobust_(name){
  try{
    var sid=(typeof SPREADSHEET_ID!=='undefined'&&SPREADSHEET_ID)?SPREADSHEET_ID:null;
    if(!sid&&typeof getEnv_==='function') sid=getEnv_('SPREADSHEET_ID','');
    if(sid){ try{ var ss=SpreadsheetApp.openById(sid); var sh=ss.getSheetByName(name); if(sh) return sh; }catch(e){ try{ console.warn('[rows_] openById failed '+e); }catch(_){} } }
  }catch(e){}
  try{ return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }catch(e){ try{ console.warn('[rows_] getActive failed '+e); }catch(_){} return null; }
}

/**
 * 批次更新樹木欄位（固定 Schema：未知欄忽略，不動態新增表頭）
 */
function updateTreeFields_(treeId, prj, fieldUpdates) {
  const sheet = getSheetByNameRobust_(SH_TREES);
  if (!sheet) return;
  if (!fieldUpdates || typeof fieldUpdates !== 'object') return;
  let updates = fieldUpdates;
  if (typeof stripUnknownFields_ === 'function') {
    updates = stripUnknownFields_(SH_TREES, fieldUpdates);
    if (!updates || Object.keys(updates).length === 0) return;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const lastCol = sheet.getLastColumn();
  let headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(k){ return String(k||'').replace(/^\ufeff/, '').trim(); }) : [];
  const idIdx = headers.indexOf('tree_id');
  const prjIdx = headers.indexOf('project_id');
  if (idIdx === -1) return;
  let rowIndex = -1;
  const ids = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (typeof isSameId_ === 'function' ? !isSameId_(String(ids[i][0]), String(treeId)) : String(ids[i][0]) !== String(treeId)) continue;
    if (prj && prjIdx !== -1) {
      const prjVal = sheet.getRange(2 + i, prjIdx + 1).getValue();
      if (String(prjVal || '') !== String(prj)) continue;
    }
    rowIndex = 2 + i;
    break;
  }
  if (rowIndex === -1) return;
  Object.keys(updates).forEach(function(field) {
    const colIdx = headers.indexOf(field);
    if (colIdx !== -1) sheet.getRange(rowIndex, colIdx + 1).setValue(updates[field]);
    else try { console.warn('[FIXED_SCHEMA] updateTreeFields_ skip missing col: ' + field); } catch(e) {}
  });
}

/**
 * 更新巡查記錄欄位（固定 Schema：支援 append 語法，未知欄忽略）
 */
function updateInspectionFields_(inspectionId, fieldUpdates) {
  const sheet = getSheetByNameRobust_(SH_INS);
  if (!sheet) return;
  if (!fieldUpdates || typeof fieldUpdates !== 'object') return;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const lastCol = sheet.getLastColumn();
  let headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(k){ return String(k||'').replace(/^\ufeff/, '').trim(); }) : [];
  const insIdIdx = headers.indexOf('inspection_id');
  if (insIdIdx === -1) return;
  let rowIndex = -1;
  const ids = sheet.getRange(2, insIdIdx + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(inspectionId)) { rowIndex = 2 + i; break; }
  }
  if (rowIndex === -1) return;
  Object.keys(fieldUpdates).forEach(function(field) {
    if (field === 'photo_url_append') {
      const pIdx = headers.indexOf('photo_url');
      if (pIdx !== -1) {
        let existing = String(sheet.getRange(rowIndex, pIdx + 1).getValue() || '');
        sheet.getRange(rowIndex, pIdx + 1).setValue(existing ? (existing + ',' + fieldUpdates[field]) : fieldUpdates[field]);
      } else try { console.warn('[FIXED_SCHEMA] photo_url missing'); } catch(e) {}
    } else if (field === 'photo_client_ids_append') {
      const pIdx = headers.indexOf('photo_client_ids');
      if (pIdx !== -1) {
        let existing = String(sheet.getRange(rowIndex, pIdx + 1).getValue() || '');
        sheet.getRange(rowIndex, pIdx + 1).setValue(existing ? (existing + ',' + fieldUpdates[field]) : fieldUpdates[field]);
      } else try { console.warn('[FIXED_SCHEMA] photo_client_ids missing'); } catch(e) {}
    } else {
      if (typeof getSchema_ === 'function') {
        var schema = getSchema_(SH_INS);
        if (schema && schema.indexOf(field) === -1) {
          try { console.warn('[FIXED_SCHEMA] updateInspectionFields_ skip unknown: ' + field); } catch(e) {}
          return;
        }
      }
      const colIdx = headers.indexOf(field);
      if (colIdx !== -1) sheet.getRange(rowIndex, colIdx + 1).setValue(fieldUpdates[field]);
      else try { console.warn('[FIXED_SCHEMA] skip missing col: ' + field); } catch(e) {}
    }
  });
}

/**
 * 按表頭追加行（固定 Schema：未知欄忽略，空表時初始化固定表頭，額外欄保留）
 */
function appendByHeader_(sheetName, obj){
  const sheet = getSheetByNameRobust_(sheetName);
  if (!sheet) { console.error('Sheet not found:', sheetName); return; }
  if (!obj || typeof obj !== 'object') return;
  let clean = obj;
  if (typeof stripUnknownFields_ === 'function') clean = stripUnknownFields_(sheetName, obj);
  let lastCol = sheet.getLastColumn();
  let headers = [];
  if (lastCol > 0) headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(k){ return String(k||'').replace(/^\ufeff/, '').trim(); });
  while (headers.length > 0 && String(headers[headers.length - 1] || '').trim() === '') headers.pop();
  if (headers.length === 0) lastCol = 0;
  if (lastCol === 0 || headers.length === 0) {
    let schema = null;
    if (typeof getSchema_ === 'function') schema = getSchema_(sheetName);
    if (schema && schema.length > 0) {
      sheet.getRange(1, 1, 1, schema.length).setValues([schema]);
      headers = schema.slice();
    } else {
      headers = Object.keys(clean);
      if (headers.length > 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    lastCol = headers.length;
  } else {
    if (typeof isValidHeader_ === 'function' && typeof getSchema_ === 'function') {
      if (!isValidHeader_(sheetName, headers)) {
        try { console.warn('[FIXED_SCHEMA] header mismatch for ' + sheetName + ' extra cols retained'); } catch(e) {}
      }
    }
  }
  const row = headers.map(function(h){ return clean.hasOwnProperty(h) ? clean[h] : ''; });
  sheet.appendRow(row);
}

/**
 * 精準讀取指定 inspection 的 photo_url（唔全表掃描，只讀 id 欄 + 目標 cell）
 */
function getInspectionPhotoUrl_(inspectionId) {
  const sheet = getSheetByNameRobust_(SH_INS);
  if (!sheet) return '';
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return '';
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return '';
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(k){ return String(k||'').replace(/^\ufeff/, '').trim(); });
  const insIdIdx = headers.indexOf('inspection_id');
  const photoUrlIdx = headers.indexOf('photo_url');
  if (insIdIdx === -1 || photoUrlIdx === -1) return '';
  const ids = sheet.getRange(2, insIdIdx + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(inspectionId)) {
      return String(sheet.getRange(2 + i, photoUrlIdx + 1).getValue() || '');
    }
  }
  return '';
}

function rows_(name){
  const sheet = getSheetByNameRobust_(name);
  if (!sheet) { try{ console.warn('[rows_] sheet not found: '+name); }catch(e){} return []; }
  var lastRow=0; try{ lastRow=sheet.getLastRow(); }catch(e){}
  var lastCol=0; try{ lastCol=sheet.getLastColumn(); }catch(e){}
  if(lastRow===0||lastCol===0){ try{ console.warn('[rows_] empty sheet '+name+' lastRow='+lastRow+' lastCol='+lastCol); }catch(e){} return []; }
  const v = sheet.getDataRange().getValues();
  if(v.length === 0) return [];
  const rawH = v.shift();
  const h = rawH.map(function(k){ return String(k||'').replace(/^\ufeff/, '').trim(); });
  if(typeof isValidHeader_==='function' && typeof getSchema_==='function'){
    try{ if(h.length && !isValidHeader_(name, h)) console.warn('[rows_] header mismatch for '+name+' headers='+JSON.stringify(h)); }catch(e){}
  }
  return v.map(function(r){
    const o = {};
    for(let i=0;i<h.length;i++){
      const key=h[i];
      if(!key) continue;
      o[key]=r[i];
    }
    return o;
  });
}

function debugTrees_(){
  var out=[];
  try{ out.push('SH_TREES='+SH_TREES); }catch(e){ out.push('SH_TREES err'); }
  try{ out.push('Active='+SpreadsheetApp.getActiveSpreadsheet().getName()); }catch(e){}
  try{ out.push('Sheets='+SpreadsheetApp.getActiveSpreadsheet().getSheets().map(function(s){return s.getName();}).join(',')); }catch(e){}
  var sh=null; try{ sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_TREES);}catch(e){}
  out.push('getSheetByName null? '+(sh==null));
  if(sh){
    try{ out.push('lastRow='+sh.getLastRow()+' lastCol='+sh.getLastColumn()); }catch(e){}
    try{ out.push('headers='+JSON.stringify(sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0])); }catch(e){}
    try{ out.push('headersTrim='+JSON.stringify(sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();}))); }catch(e){}
  }
  var rows=[]; try{ rows=rows_(SH_TREES); out.push('rows_.length='+rows.length); }catch(e){ out.push('rows_ err '+e); }
  if(rows.length){ try{ out.push('sample='+JSON.stringify(rows[0])); out.push('keys='+Object.keys(rows[0]).join(',')); }catch(e){} }
  try{ out.push('cached trees_all len='+(CacheService.getScriptCache().get(TREES_CACHE_KEY)||'').length); }catch(e){}
  try{ var p='ShingMunRiver'; var strict=rows.filter(function(t){return String(t.project_id)===p;}).length; var trimmed=rows.filter(function(t){return String(t.project_id||'').trim()===p;}).length; out.push('filter strict='+strict+' trimmed='+trimmed); }catch(e){}
  try{ out.push('distinct project_ids='+JSON.stringify([...new Set(rows.map(function(r){return String(r.project_id||'').trim();}))]).slice(0,500)); }catch(e){}
  Logger.log(out.join('\n'));
  return out.join('\n');
}