/*************************************************
 * 樹木編號工具：同地盤唯一性檢查＋自動接號
 * - treeIdExists_(treeId, projectId)：同地盤內是否已存在
 * - nextTreeId_(projectId)：該地盤最大純數字編號＋1
 * - normalizeTreeId_(treeId)：純數字轉 Number，保持 Sheet 內類型一致
 *************************************************/

/* 一次過讀取 trees 表嘅 (tree_id, project_id) 配對 */
function getTreeIdProjectPairs_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_TREES);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idIdx = headers.indexOf('tree_id');
  const prjIdx = headers.indexOf('project_id');
  if (idIdx === -1) return [];
  const vals = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const out = [];
  for (let i = 0; i < vals.length; i++) {
    out.push({
      tid: String(vals[i][idIdx] == null ? '' : vals[i][idIdx]).trim(),
      pid: prjIdx !== -1 ? String(vals[i][prjIdx] == null ? '' : vals[i][prjIdx]).trim() : ''
    });
  }
  return out;
}

/* 編號比較：純數字用數値比較（避免 "07" vs "7" 誤判），其餘用字串比較 */
function isSameId_(a, b) {
  if (a === b) return true;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return parseInt(a, 10) === parseInt(b, 10);
  return false;
}

/* 同地盤內 tree_id 是否已存在 */
function treeIdExists_(treeId, projectId) {
  const tid = String(treeId == null ? '' : treeId).trim();
  if (!tid) return false;
  const pid = String(projectId == null ? '' : projectId).trim();
  const rows = getTreeIdProjectPairs_();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].pid === pid && isSameId_(rows[i].tid, tid)) return true;
  }
  return false;
}

/* 自動接號：該地盤最大純數字 tree_id ＋ 1（無數字編號時由 1 開始） */
function nextTreeId_(projectId) {
  const pid = String(projectId == null ? '' : projectId).trim();
  const rows = getTreeIdProjectPairs_();
  let max = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].pid !== pid) continue;
    if (/^\d+$/.test(rows[i].tid)) {
      const n = parseInt(rows[i].tid, 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

/* 純數字寫入為 Number，保持 Sheet 欄位類型一致 */
function normalizeTreeId_(treeId) {
  const s = String(treeId == null ? '' : treeId).trim();
  return /^\d+$/.test(s) ? Number(s) : s;
}

/* [Phase10] 樹木編號改名支援 */
function treeIdTaken_(treeId, projectId) {
  const tid = String(treeId == null ? '' : treeId).trim();
  if (!tid) return false;
  const pid = String(projectId == null ? '' : projectId).trim();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SH_TREES);
  if (!sheet || sheet.getLastRow() < 2) return false;
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf('tree_id');
  const prjIdx = headers.indexOf('project_id');
  if (idIdx === -1) return false;
  for (let i = 1; i < data.length; i++) {
    const cur = String(data[i][idIdx] == null ? '' : data[i][idIdx]).trim();
    const curPid = prjIdx !== -1 ? String(data[i][prjIdx] == null ? '' : data[i][prjIdx]).trim() : '';
    if (curPid !== pid) continue;
    if (cur === tid) return true;
    if (/^\d+$/.test(cur) && /^\d+$/.test(tid) && parseInt(cur,10) === parseInt(tid,10)) return true;
  }
  return false;
}

function renameTreeReferences_(oldId, newId, prj) {
  const pid = String(prj == null ? '' : prj).trim();
  [SH_INS, SH_CHK].forEach(function (name) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 2) return;
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    const idIdx = headers.indexOf('tree_id');
    const prjIdx = headers.indexOf('project_id');
    if (idIdx === -1) return;
    const ids = sheet.getRange(2, idIdx + 1, sheet.getLastRow() - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) !== String(oldId)) continue;
      if (pid && prjIdx !== -1) {
        const rowPid = String(sheet.getRange(2 + i, prjIdx + 1).getValue() || '').trim();
        if (rowPid !== pid) continue;
      }
      sheet.getRange(2 + i, idIdx + 1).setValue(newId);
    }
  });
}
