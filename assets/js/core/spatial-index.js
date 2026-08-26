/**
 * 空間索引模組 — 均勻格網 (Uniform Grid)
 * 視口查詢由 O(N) 降至 O(K + C)，K=視口內數, C=命中格子數
 * 香港範圍 lat 22.15-22.55, lng 113.85-114.45，格子 0.01° ≈ 1.1km
 * 零依賴，與 Leaflet LatLngBounds 兼容，支援半徑/最近鄰查詢
 */
import { state } from '../modules/state.js';

const DEFAULT_CELL_SIZE = 0.01;
const DEFAULT_CELL_SIZE_FINE = 0.005;

export class GridSpatialIndex {
  constructor(cellSize = DEFAULT_CELL_SIZE) {
    this.cellSize = cellSize;
    this.grid = new Map();
    this.all = [];
    this.builtAt = 0;
    this.stats = { cells: 0, maxPerCell: 0, avgPerCell: 0 };
  }
  _cellKey(lat, lng) {
    const cx = Math.floor(lng / this.cellSize);
    const cy = Math.floor(lat / this.cellSize);
    return cx + '_' + cy;
  }
  build(items) {
    const t0 = performance.now();
    this.grid.clear();
    this.all = [];
    if (!items || !items.length) { this.builtAt = performance.now(); return this; }
    let cs = this.cellSize;
    if (items.length > 5000 && this.cellSize === DEFAULT_CELL_SIZE) {
      cs = DEFAULT_CELL_SIZE_FINE;
      this.cellSize = cs;
    }
    let maxPerCell = 0;
    for (let i = 0; i < items.length; i++) {
      const t = items[i];
      const lat = +t.lat, lng = +t.lng;
      if (isNaN(lat) || isNaN(lng)) continue;
      this.all.push(t);
      const key = Math.floor(lng / cs) + '_' + Math.floor(lat / cs);
      let bucket = this.grid.get(key);
      if (!bucket) { bucket = []; this.grid.set(key, bucket); }
      bucket.push(t);
      if (bucket.length > maxPerCell) maxPerCell = bucket.length;
    }
    const cells = this.grid.size;
    this.stats = { cells, maxPerCell, avgPerCell: cells ? (this.all.length / cells).toFixed(1) : 0, buildMs: (performance.now() - t0).toFixed(1) };
    this.builtAt = performance.now();
    return this;
  }
  insert(item) {
    const lat = +item.lat, lng = +item.lng;
    if (isNaN(lat) || isNaN(lng)) return;
    this.all.push(item);
    const key = this._cellKey(lat, lng);
    let bucket = this.grid.get(key);
    if (!bucket) { bucket = []; this.grid.set(key, bucket); }
    bucket.push(item);
  }
  remove(predicate) {
    let removed = 0;
    this.all = this.all.filter(t => { if (predicate(t)) { removed++; return false; } return true; });
    if (removed) this.build(this.all);
    return removed;
  }
  clear() { this.grid.clear(); this.all = []; this.stats = { cells: 0, maxPerCell: 0, avgPerCell: 0 }; }
  size() { return this.all.length; }
  query(bounds, opts) {
    const exact = !(opts && opts.exact === false);
    if (!bounds) return this.all.slice();
    let south, north, west, east;
    if (typeof bounds.getSouth === 'function') {
      south = bounds.getSouth(); north = bounds.getNorth();
      west = bounds.getWest(); east = bounds.getEast();
    } else { south = bounds.south; north = bounds.north; west = bounds.west; east = bounds.east; }
    if (south == null || isNaN(south)) return this.all.slice();
    const cs = this.cellSize;
    const minX = Math.floor(west / cs), maxX = Math.floor(east / cs);
    const minY = Math.floor(south / cs), maxY = Math.floor(north / cs);
    const out = [];
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const bucket = this.grid.get(cx + '_' + cy);
        if (!bucket) continue;
        if (!exact) { for (let i = 0; i < bucket.length; i++) out.push(bucket[i]); }
        else { for (let i = 0; i < bucket.length; i++) { const t = bucket[i]; const la = +t.lat, ln = +t.lng; if (la >= south && la <= north && ln >= west && ln <= east) out.push(t); } }
      }
    }
    return out;
  }
  queryWithFilter(bounds, filterFn) {
    const base = this.query(bounds, { exact: true });
    if (!filterFn) return base;
    const out = [];
    for (let i = 0; i < base.length; i++) if (filterFn(base[i])) out.push(base[i]);
    return out;
  }
  queryRadius(centerLat, centerLng, radiusM) {
    if (centerLat == null || centerLng == null || !(radiusM > 0)) return [];
    const latDelta = radiusM / 111000;
    const lngDelta = radiusM / (111000 * Math.cos(centerLat * Math.PI / 180) || 1);
    const bounds = { south: centerLat - latDelta, north: centerLat + latDelta, west: centerLng - lngDelta, east: centerLng + lngDelta };
    const candidates = this.query(bounds, { exact: false });
    const out = [];
    for (let i = 0; i < candidates.length; i++) { const t = candidates[i]; const d = haversineM(centerLat, centerLng, +t.lat, +t.lng); if (d <= radiusM) out.push(t); }
    return out;
  }
  nearest(lat, lng, k = 1) {
    if (!this.all.length) return [];
    let r = 200; let res = [];
    for (let iter = 0; iter < 10; iter++) { res = this.queryRadius(lat, lng, r); if (res.length >= k) break; r *= 2.2; if (r > 50000) break; }
    res.sort((a, b) => haversineM(lat, lng, +a.lat, +a.lng) - haversineM(lat, lng, +b.lat, +b.lng));
    return res.slice(0, k);
  }
}
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}
export function buildAllSpatialIndexes() {
  const t0 = performance.now();
  const map = new Map();
  state.treeSearchIndex.forEach((list, pid) => {
    const idx = new GridSpatialIndex();
    idx.build(list);
    map.set(String(pid), idx);
  });
  if (!map.size && state.TREES && state.TREES.length) {
    const idx = new GridSpatialIndex();
    idx.build(state.TREES);
    map.set('_all', idx);
  }
  state.spatialIndexCache = map;
  state.perfMetrics.spatialIndexBuildTime = performance.now() - t0;
  try {
    const totalCells = Array.from(map.values()).reduce((s, v) => s + v.stats.cells, 0);
    console.log('[SpatialIndex] 建成 ' + map.size + ' 個地盤, 共 ' + totalCells + ' 格, 耗時 ' + state.perfMetrics.spatialIndexBuildTime.toFixed(1) + 'ms');
  } catch (e) { /* intentionally ignored: optional fallback failure */ }
  return map;
}
export function clearAllSpatialIndexes() {
  if (state.spatialIndexCache instanceof Map) state.spatialIndexCache.clear();
  else state.spatialIndexCache = new Map();
}
export function getSpatialIndex(pid) {
  if (!state.spatialIndexCache) return null;
  if (state.spatialIndexCache instanceof Map) return state.spatialIndexCache.get(String(pid)) || null;
  return null;
}
export function querySpatialIndex(pid, bounds, filterFn) {
  const idx = getSpatialIndex(pid);
  if (idx) {
    if (filterFn) return idx.queryWithFilter(bounds, filterFn);
    return idx.query(bounds);
  }
  const list = state.treeSearchIndex.get(String(pid)) || state.TREES || [];
  if (!bounds) {
    if (!filterFn) return list.slice();
    return list.filter(filterFn);
  }
  let south, north, west, east;
  if (typeof bounds.getSouth === 'function') { south = bounds.getSouth(); north = bounds.getNorth(); west = bounds.getWest(); east = bounds.getEast(); }
  else return filterFn ? list.filter(filterFn) : list.slice();
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const la = +t.lat, ln = +t.lng;
    if (isNaN(la) || isNaN(ln)) continue;
    if (la < south || la > north || ln < west || ln > east) continue;
    if (filterFn && !filterFn(t)) continue;
    out.push(t);
  }
  return out;
}
export function getSpatialStats() {
  if (!state.spatialIndexCache || !(state.spatialIndexCache instanceof Map)) return { projects: 0, totalTrees: 0, totalCells: 0 };
  let totalTrees = 0, totalCells = 0;
  const perProject = {};
  state.spatialIndexCache.forEach((idx, pid) => {
    totalTrees += idx.size(); totalCells += idx.stats.cells;
    perProject[pid] = { trees: idx.size(), cells: idx.stats.cells, maxPerCell: idx.stats.maxPerCell, avgPerCell: idx.stats.avgPerCell, buildMs: idx.stats.buildMs };
  });
  return { projects: state.spatialIndexCache.size, totalTrees, totalCells, perProject, buildTime: state.perfMetrics.spatialIndexBuildTime };
}
export function upsertToIndex(pid, tree) {
  const idx = getSpatialIndex(pid);
  if (idx) idx.insert(tree);
}
export function removeFromIndex(pid, predicate) {
  const idx = getSpatialIndex(pid);
  if (idx) return idx.remove(predicate);
  return 0;
}

