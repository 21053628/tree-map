/* ---------- 底層工具（優化版 + 動態表頭 + 防重輔助） ---------- */

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