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