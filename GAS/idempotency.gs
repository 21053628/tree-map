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