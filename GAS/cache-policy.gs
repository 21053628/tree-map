/* =========================================================
 * 統一快取 TTL 策略 - 單一真實來源
 * 前端對應：assets/js/core/cache-policy.js
 * 方案 A 輕量統一：三檔對齊，不做分片，保留全清
 * ========================================================= */
const CACHE_POLICY = {
  bootstrap:   { ttl: 300, swMaxAge: 3600000, memoryTtl: 60*1000 },   // 首屏聚合
  projects:    { ttl: 300, swMaxAge: 600000,  memoryTtl: 120*1000 },
  trees:       { ttl: 300, swMaxAge: 600000,  memoryTtl: 60*1000 },
  inspections: { ttl: 120, swMaxAge: 300000,  memoryTtl: 30*1000 },   // 分頁短 TTL
  viewport:    { ttl: 120, swMaxAge: 300000,  memoryTtl: 30*1000 },
  species:     { ttl: 86400, swMaxAge: 3600000,  memoryTtl: 3600*1000 }, // 靜態物種長 TTL
  snapshot:    { ttl: 24*3600*1000, maxAgeDays: 7 }                   // IndexedDB 快照
};

// 兼容讀取：優先 ScriptProperties 覆蓋，否則回退至 CACHE_POLICY
function getCacheTtl_(name){
  try {
    if (CACHE_POLICY && CACHE_POLICY[name] && typeof CACHE_POLICY[name].ttl === 'number') return CACHE_POLICY[name].ttl;
  } catch(e) {}
  return 300;
}
