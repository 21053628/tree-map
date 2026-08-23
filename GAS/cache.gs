/* ---------- 快取清理工具（統一失效入口，方案 A 全清） ---------- */
function clearDataCache_(){
  try {
    const cache = CacheService.getScriptCache();
    cache.remove(BOOTSTRAP_CACHE_KEY);
    cache.remove(TREES_CACHE_KEY);
    cache.remove(PROJECTS_CACHE_KEY);
    cache.remove(INSPECTIONS_CACHE_KEY);
    try { cache.remove(SPECIES_CACHE_KEY); } catch(e) {}
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
    try{ CacheService.getScriptCache().remove(cacheKey); }catch(e){}
    const r = rows_(sheetName); try{ console.log('[cache] bypass '+cacheKey+' rows='+r.length); }catch(e){} return r;
  }
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    if (cached === '[]' || cached === '"[]"') { try { cache.remove(cacheKey); } catch(e) {} }
    else { try { return JSON.parse(cached); } catch(e) {} }
  }
  const rows = rows_(sheetName);
  if (!rows || rows.length === 0) { try { cache.remove(cacheKey); } catch(e) {} try { console.warn('[cache] empty rows not cached key=' + cacheKey + ' sheet=' + sheetName); } catch(e) {} return rows; }
  const jsonStr = JSON.stringify(rows);
  // 100KB 單值限制：超 90KB 警告（方案 A 不分片，僅打點避免無感知擊穿）
  if (jsonStr.length > 90*1024) { try { console.warn('[cache] large payload skip? size=' + jsonStr.length + ' key=' + cacheKey); } catch(e) {} }
  var effTtl = ttl;
  if (!effTtl) {
    if (cacheKey === INSPECTIONS_CACHE_KEY) effTtl = (typeof INSPECTIONS_TTL !== 'undefined' ? INSPECTIONS_TTL : (typeof getCacheTtl_==='function'?getCacheTtl_('inspections'):120));
    else effTtl = (typeof CACHE_TTL !== 'undefined' ? CACHE_TTL : (typeof getCacheTtl_==='function'?getCacheTtl_('trees'):300));
  }
  try { cache.put(cacheKey, jsonStr, effTtl); } catch(e) { console.warn('⚠️ 快取太大跳過（size=' + jsonStr.length + '）'); }
  return rows;
}