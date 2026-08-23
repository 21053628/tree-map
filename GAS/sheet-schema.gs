/* sheet-schema.gs - 固定 Sheet Schema (Single Source of Truth) */
/* v1.0.0 | 4 張表固定欄位，寫入不再動態新增表頭，未知欄忽略，額外欄保留 */

const SCHEMA_VERSION_ = '1.0.0';

// 固定欄位定義（順序即合約）
// trees 22 欄 | inspections 14 欄 | checkins 8 欄 | projects 8 欄（航拍 6 欄不納入）
const SCHEMA_TREES_  = ['tree_id','name','lat','lng','status','risk','photo_url','description','tree_height','crown_width','dbh','ground_diameter','stem_length','crown_area','crown_volume','project_id','level','hk80_n','hk80_e','client_id','client_created_at','last_client_id'];
const SCHEMA_INS_    = ['inspection_id','time','staff','tree_id','project_id','health','note','photo_url','lat','lng','photos_total','client_id','client_created_at','photo_client_ids'];
const SCHEMA_CHK_    = ['time','staff','tree_id','project_id','lat','lng','client_id','client_created_at'];
const SCHEMA_PRJ_    = ['project_id','name','lat','lng','description','created_at','client_id','client_created_at'];
const SCHEMA_SPECIES_ = ['id','name'];

/**
 * 取得指定 sheet 的固定 schema；支援 SH_* 常數或字面 sheet 名
 */
function getSchema_(sheetName){
  // 優先比對 SH_* 常數（若已載入）
  try {
    if (typeof SH_TREES !== 'undefined' && sheetName === SH_TREES) return SCHEMA_TREES_.slice();
    if (typeof SH_INS   !== 'undefined' && sheetName === SH_INS)   return SCHEMA_INS_.slice();
    if (typeof SH_CHK   !== 'undefined' && sheetName === SH_CHK)   return SCHEMA_CHK_.slice();
    if (typeof SH_PRJ   !== 'undefined' && sheetName === SH_PRJ)   return SCHEMA_PRJ_.slice();
    if (typeof SH_SPECIES !== 'undefined' && sheetName === SH_SPECIES) return SCHEMA_SPECIES_.slice();
  } catch(e) {}
  // 字面名稱相容
  var n = String(sheetName || '').trim();
  if (n === 'trees') return SCHEMA_TREES_.slice();
  if (n === 'inspections') return SCHEMA_INS_.slice();
  if (n === 'checkins') return SCHEMA_CHK_.slice();
  if (n === 'projects') return SCHEMA_PRJ_.slice();
  if (n === 'species') return SCHEMA_SPECIES_.slice();
  return null;
}

function getColIndexMap_(sheetName){
  var schema = getSchema_(sheetName);
  if (!schema) return null;
  var m = {};
  for (var i = 0; i < schema.length; i++) m[schema[i]] = i;
  return m;
}

/**
 * 過濾未知欄位（忽略模式）：僅保留 schema 內的 key
 * 特殊：保留空物件原樣，避免誤判
 */
function stripUnknownFields_(sheetName, obj){
  if (!obj || typeof obj !== 'object') return obj;
  var schema = getSchema_(sheetName);
  if (!schema) return obj;
  var set = {};
  for (var i = 0; i < schema.length; i++) set[schema[i]] = true;
  var out = {};
  var hasUnknown = false;
  for (var k in obj){
    if (!obj.hasOwnProperty(k)) continue;
    if (set[k]) out[k] = obj[k];
    else hasUnknown = true;
  }
  if (hasUnknown) {
    try { console.warn('[FIXED_SCHEMA] strip unknown fields for ' + sheetName + ' keys=' + Object.keys(obj).join(',')); } catch(e) {}
  }
  return out;
}

function isValidHeader_(sheetName, headers){
  var schema = getSchema_(sheetName);
  if (!schema) return true;
  if (!headers || headers.length < schema.length) return false;
  for (var i = 0; i < schema.length; i++){
    if (String(headers[i] || '') !== schema[i]) return false;
  }
  return true;
}
