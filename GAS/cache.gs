/* ---------- 快取分片工具（突破 GAS ScriptCache 100KB 單值上限） ---------- */
const CACHE_CHUNK_MAX_ = 90 * 1024; // 90KB 每片，預留空間低於 100KB 上限

function cachePutChunked_(cacheKey, jsonStr, ttl) {
  try {
    const cache = CacheService.getScriptCache();
    if (!jsonStr || jsonStr.length <= CACHE_CHUNK_MAX_) {
      cache.put(cacheKey, jsonStr, ttl);
      return;
    }
    // 分片：平均分到多個 key，每片 <= CACHE_CHUNK_MAX_
    const pieces = Math.ceil(jsonStr.length / CACHE_CHUNK_MAX_);
    const keys = [];
    for (let i = 0; i < pieces; i++) {
      const chunkKey = cacheKey + '#c' + i;
      keys.push(chunkKey);
      cache.put(chunkKey, jsonStr.slice(i * CACHE_CHUNK_MAX_, (i + 1) * CACHE_CHUNK_MAX_), ttl);
    }
    cache.put(cacheKey + '#meta', String(pieces), ttl);
  } catch (e) {
    try { console.warn('[cache] cachePutChunked_ failed key=' + cacheKey + ' size=' + (jsonStr ? jsonStr.length : 0)); } catch (_) {}
  }
}

function cacheGetChunked_(cacheKey) {
  try {
    const cache = CacheService.getScriptCache();
    // 相容：先檢查未分片嘅舊格式
    const legacy = cache.get(cacheKey);
    if (legacy !== null) return legacy;
    // 檢查分片 meta
    const meta = cache.get(cacheKey + '#meta');
    if (!meta) return null;
    const pieces = parseInt(meta, 10);
    if (!pieces || pieces <= 0 || pieces > 100) return null;
    const keys = [];
    for (let i = 0; i < pieces; i++) keys.push(cacheKey + '#c' + i);
    const vals = cache.getAll(keys);
    let out = '';
    for (let i = 0; i < pieces; i++) {
      const v = vals[cacheKey + '#c' + i];
      if (v === null || v === undefined) return null; // 分片缺失 → 當 miss
      out += v;
    }
    return out;
  } catch (e) { return null; }
}

function cacheRemoveChunked_(cacheKey) {
  try {
    const cache = CacheService.getScriptCache();
    cache.remove(cacheKey); // 清未分片格式
    const meta = cache.get(cacheKey + '#meta');
    if (meta) {
      const pieces = parseInt(meta, 10);
      if (pieces && pieces > 0 && pieces <= 100) {
        const keys = [cacheKey + '#meta'];
        for (let i = 0; i < pieces; i++) keys.push(cacheKey + '#c' + i);
        cache.removeAll(keys);
      }
    }
  } catch (e) {}
}

/* ---------- 快取清理工具（統一失效入口，方案 A 全清） ---------- */
function clearDataCache_(){
  try {
    cacheRemoveChunked_(BOOTSTRAP_CACHE_KEY);
    cacheRemoveChunked_(TREES_CACHE_KEY);
    cacheRemoveChunked_(PROJECTS_CACHE_KEY);
    cacheRemoveChunked_(INSPECTIONS_CACHE_KEY);
    try { cacheRemoveChunked_(SPECIES_CACHE_KEY); } catch(e) {}
  } catch(e) {}
}
/* 依類型精準輔助（為未來 B 方案預留，A 方案仍全清，但呼叫端可傳 type 打點日誌） */
function clearDataCacheFor_(type){
  try { console.log('[cache] invalidate type=' + type); } catch(e) {}
  return clearDataCache_();
}

/* =========================================================
 * 快取輔助函式
 * ========================================================= */
function getCachedRows_(sheetName, cacheKey, ttl, opts) {
  opts = opts || {};
  if(String(opts.nocache)==='1' || String(opts.bypass)==='1' || String(opts.bust)==='1'){
    try{ cacheRemoveChunked_(cacheKey); }catch(e){}
    const r = rows_(sheetName); try{ console.log('[cache] bypass '+cacheKey+' rows='+r.length); }catch(e){} return r;
  }
  const cache = CacheService.getScriptCache();
  // 🔥 [P1 修復] 用 cacheGetChunked_ 支援大 payload 分片快取（>100KB 唔會再擊穿）
  const cached = cacheGetChunked_(cacheKey);
  if (cached) {
    if (cached === '[]' || cached === '"[]"') { try { cacheRemoveChunked_(cacheKey); } catch(e) {} }
    else { try { return JSON.parse(cached); } catch(e) {} }
  }
  const rows = rows_(sheetName);
  if (!rows || rows.length === 0) { try { cacheRemoveChunked_(cacheKey); } catch(e) {} try { console.warn('[cache] empty rows not cached key=' + cacheKey + ' sheet=' + sheetName); } catch(e) {} return rows; }
  const jsonStr = JSON.stringify(rows);
  // 🔥 [P1 修復] 大 payload 改用分片寫入（原本超 100KB 會 cache 失敗，每次請求都重新讀表）
  if (jsonStr.length > 90*1024) { try { console.warn('[cache] large payload chunked size=' + jsonStr.length + ' key=' + cacheKey); } catch(e) {} }
  var effTtl = ttl;
  if (!effTtl) {
    if (cacheKey === INSPECTIONS_CACHE_KEY) effTtl = (typeof INSPECTIONS_TTL !== 'undefined' ? INSPECTIONS_TTL : (typeof getCacheTtl_==='function'?getCacheTtl_('inspections'):120));
    else effTtl = (typeof CACHE_TTL !== 'undefined' ? CACHE_TTL : (typeof getCacheTtl_==='function'?getCacheTtl_('trees'):300));
  }
  cachePutChunked_(cacheKey, jsonStr, effTtl);
  return rows;
}