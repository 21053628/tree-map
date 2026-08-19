/* ---------- 快取清理工具 ---------- */
function clearDataCache_(){
  try {
    const cache = CacheService.getScriptCache();
    cache.remove(BOOTSTRAP_CACHE_KEY);
    cache.remove(TREES_CACHE_KEY);
    cache.remove(PROJECTS_CACHE_KEY);
    cache.remove(INSPECTIONS_CACHE_KEY);
  } catch(e) {}
}

/* =========================================================
 * 快取輔助函式
 * ========================================================= */
function getCachedRows_(sheetName, cacheKey, ttl) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }
  const rows = rows_(sheetName);
  try { cache.put(cacheKey, JSON.stringify(rows), ttl || CACHE_TTL); } catch(e) {}
  return rows;
}