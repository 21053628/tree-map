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