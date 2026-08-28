/**
 * 統一快取 TTL 策略 - 單一真實來源（ES Module）
 * 後端對應：GAS/cache-policy.gs
 * 方案 A 輕量統一：三檔對齊，保留全清，僅打通失效
 *
 * 使用：主線程以 <script type="module"> 載入；Service Worker（sw.js）以 ESM import 載入
 * 後端 GAS 透過 CacheService 對應 ttl。
 */

const POLICY = {
  bootstrap:   { ttl: 300, swMaxAge: 3600000, memoryTtl: 60*1000 },
  projects:    { ttl: 300, swMaxAge: 600000,  memoryTtl: 120*1000 },
  trees:       { ttl: 300, swMaxAge: 600000,  memoryTtl: 60*1000 },
  inspections: { ttl: 120, swMaxAge: 300000,  memoryTtl: 30*1000 },
  viewport:    { ttl: 120, swMaxAge: 300000,  memoryTtl: 30*1000 },
  species:     { ttl: 86400, swMaxAge: 3600000, memoryTtl: 3600*1000 },
  boundaries:  { ttl: 300, swMaxAge: 600000, memoryTtl: 60*1000 },
  snapshot:    { ttl: 24*3600*1000, maxAgeDays: 7 },
  // 數量型快取（不以時間 TTL 驅動）
  tiles:       { countLimit: 800 },
  images:      { countLimit: 300 },
  runtime:     { countLimit: 100 }
};

function getMemoryTtl(action) {
  // action: 'bootstrap'|'projects'|'trees'|'inspections'|'viewport'|'species' → memoryTtl
  const key = String(action || '').toLowerCase();
  if (key === 'bootstrap') return POLICY.bootstrap.memoryTtl;
  if (key === 'projects') return POLICY.projects.memoryTtl;
  if (key === 'trees') return POLICY.trees.memoryTtl;
  if (key === 'inspections') return POLICY.inspections.memoryTtl;
  if (key === 'species') return POLICY.species.memoryTtl;
  if (key === 'boundaries') return POLICY.boundaries.memoryTtl;
  if (key.indexOf('viewport') !== -1 || key.indexOf('bbox') !== -1) return POLICY.viewport.memoryTtl;
  return 60*1000;
}

function getSwMaxAge(action) {
  const key = String(action || '').toLowerCase();
  if (key === 'bootstrap') return POLICY.bootstrap.swMaxAge;
  if (key === 'projects') return POLICY.projects.swMaxAge;
  if (key === 'trees') return POLICY.trees.swMaxAge;
  if (key === 'inspections') return POLICY.inspections.swMaxAge;
  if (key === 'species') return POLICY.species.swMaxAge;
  if (key === 'boundaries') return POLICY.boundaries.swMaxAge;
  if (key.indexOf('viewport') !== -1) return POLICY.viewport.swMaxAge;
  return 600000;
}

function getTtlSeconds(action) {
  const key = String(action || '').toLowerCase();
  if (POLICY[key] && typeof POLICY[key].ttl === 'number') return POLICY[key].ttl;
  return 300;
}

export const CachePolicy = {
  POLICY,
  getMemoryTtl,
  getSwMaxAge,
  getTtlSeconds
};

