/** Geometry helpers for accurate HK80 site boundary editing. */
import { isValidHK80, toHK80Async, toWGS84Async } from './coordinates.js';

export const HK80_POINT_TOLERANCE_M = 0.2;
const DEG = Math.PI / 180;

export function normalizeGeometry(geometry) {
  if (typeof geometry === 'string') {
    try { geometry = JSON.parse(geometry); } catch (e) { return null; }
  }
  if (!geometry || geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) return null;
  const ring = geometry.coordinates[0];
  if (!Array.isArray(ring)) return null;
  return { type: 'Polygon', coordinates: [ring.map((p) => [Number(p[0]), Number(p[1])])], ...(geometry.properties && typeof geometry.properties === 'object' ? { properties: geometry.properties } : {}) };
}

export function latLngsToGeometry(latlngs) {
  const ring = (latlngs || []).map((p) => [Number(p.lng), Number(p.lat)]);
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0].slice());
  return { type: 'Polygon', coordinates: [ring] };
}

export function geometryToLatLngs(geometry) {
  const normalized = normalizeGeometry(geometry);
  if (!normalized || typeof L === 'undefined') return [];
  return normalized.coordinates[0].slice(0, -1).map((p) => L.latLng(p[1], p[0]));
}

function point_(n, e) { return { n: Number(n), e: Number(e) }; }
function pointEqual_(a, b, tolerance = HK80_POINT_TOLERANCE_M) { return Boolean(a && b) && Math.abs(Number(a.n) - Number(b.n)) <= tolerance && Math.abs(Number(a.e) - Number(b.e)) <= tolerance; }
function arcDelta_(startAngle, endAngle, direction) {
  let delta = endAngle - startAngle;
  if (direction === 'ccw') while (delta <= 0) delta += Math.PI * 2;
  else while (delta >= 0) delta -= Math.PI * 2;
  return delta;
}
function legacyArcMidpoint_(segment) {
  const { start, end, center } = segment;
  if (!center || !start || !end) return null;
  const startAngle = Math.atan2(start.n - center.n, start.e - center.e);
  const endAngle = Math.atan2(end.n - center.n, end.e - center.e);
  const delta = arcDelta_(startAngle, endAngle, segment.direction === 'ccw' ? 'ccw' : 'cw');
  const angle = startAngle + delta / 2;
  const radius = Math.hypot(start.e - center.e, start.n - center.n);
  return point_(center.n + radius * Math.sin(angle), center.e + radius * Math.cos(angle));
}
function segmentCopy_(segment) {
  const copy = { type: segment.type === 'arc' ? 'arc' : 'line', start: point_(segment.start.n, segment.start.e), end: point_(segment.end.n, segment.end.e) };
  if (copy.type === 'arc') copy.midpoint = point_(segment.midpoint.n, segment.midpoint.e);
  return copy;
}

export function normalizeHK80Segments(definition) {
  const raw = Array.isArray(definition) ? definition : definition?.segments;
  if (!Array.isArray(raw)) return [];
  return raw.map((segment) => {
    if (!segment?.start || !segment?.end) return null;
    const normalized = { type: segment.type === 'arc' ? 'arc' : 'line', start: point_(segment.start.n, segment.start.e), end: point_(segment.end.n, segment.end.e) };
    if (normalized.type === 'arc') normalized.midpoint = segment.midpoint ? point_(segment.midpoint.n, segment.midpoint.e) : legacyArcMidpoint_(segment);
    return normalized;
  }).filter(Boolean);
}

export function getBoundaryHK80Segments(geometry) { return normalizeHK80Segments(normalizeGeometry(geometry)?.properties?.boundary_definition); }

function circumcenter_(a, b, c) {
  // Translate to the first point before calculating. HK80 values are around
  // 800,000, so using their squares directly loses precision in JavaScript.
  const ax = a.e, ay = a.n, bx = b.e - ax, by = b.n - ay, cx = c.e - ax, cy = c.n - ay;
  const determinant = 2 * (bx * cy - by * cx);
  if (Math.abs(determinant) < 1e-9) return null;
  const bb = bx * bx + by * by, cc = cx * cx + cy * cy;
  const relativeX = (bb * cy - cc * by) / determinant;
  const relativeY = (cc * bx - bb * cx) / determinant;
  // Formula uses E as x and N as y; return back in HK80 N/E order.
  return point_(ay + relativeY, ax + relativeX);
}

function arcConstruction_(segment) {
  const center = segment.midpoint ? circumcenter_(segment.start, segment.midpoint, segment.end) : segment.center;
  if (!center) return null;
  const startAngle = Math.atan2(segment.start.n - center.n, segment.start.e - center.e);
  const endAngle = Math.atan2(segment.end.n - center.n, segment.end.e - center.e);
  const radius = Math.hypot(segment.start.e - center.e, segment.start.n - center.n);
  const endRadius = Math.hypot(segment.end.e - center.e, segment.end.n - center.n);
  if (!Number.isFinite(radius) || radius < 0.01 || Math.abs(radius - endRadius) > HK80_POINT_TOLERANCE_M) return null;
  let delta;
  let midpointAngle = null;
  if (segment.midpoint) {
    midpointAngle = Math.atan2(segment.midpoint.n - center.n, segment.midpoint.e - center.e);
    const candidates = ['ccw', 'cw'].map((direction) => {
      const candidateDelta = arcDelta_(startAngle, endAngle, direction);
      const midpointDelta = arcDelta_(startAngle, midpointAngle, direction);
      return { candidateDelta, midpointDelta };
    });
    const chosen = candidates.find((candidate) => Math.sign(candidate.midpointDelta) === Math.sign(candidate.candidateDelta) && Math.abs(candidate.midpointDelta) > 1e-9 && Math.abs(candidate.midpointDelta) < Math.abs(candidate.candidateDelta) - 1e-9);
    if (!chosen) return null;
    delta = chosen.candidateDelta;
  } else {
    delta = segment.direction === 'ccw' ? arcDelta_(startAngle, endAngle, 'ccw') : arcDelta_(startAngle, endAngle, 'cw');
  }
  let midpointRatio = null;
  if (midpointAngle !== null) {
    const midpointDelta = delta > 0 ? arcDelta_(startAngle, midpointAngle, 'ccw') : arcDelta_(startAngle, midpointAngle, 'cw');
    midpointRatio = midpointDelta / delta;
    if (!(midpointRatio > 1e-9 && midpointRatio < 1 - 1e-9)) return null;
  }
  return { center, startAngle, delta, radius, midpointRatio };
}

export function sampleArcHK80(segment, maxAngleDeg = 1) {
  const construction = arcConstruction_(segment);
  if (!construction) return [];
  const { center, startAngle, delta, radius, midpointRatio } = construction;
  const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.max(0.1, maxAngleDeg) * DEG)));
  const ratios = [];
  for (let i = 0; i <= count; i += 1) ratios.push(i / count);
  if (midpointRatio !== null && !ratios.some((ratio) => Math.abs(ratio - midpointRatio) < 1e-9)) ratios.push(midpointRatio);
  ratios.sort((a, b) => a - b);
  return ratios.map((ratio) => {
    if (midpointRatio !== null && Math.abs(ratio - midpointRatio) < 1e-9) return point_(segment.midpoint.n, segment.midpoint.e);
    const angle = startAngle + delta * ratio;
    return point_(center.n + radius * Math.sin(angle), center.e + radius * Math.cos(angle));
  });
}

export function snapHK80Segments(segments, tolerance = HK80_POINT_TOLERANCE_M) {
  const list = normalizeHK80Segments(segments);
  for (let i = 1; i < list.length; i += 1) if (pointEqual_(list[i - 1].end, list[i].start, tolerance)) list[i].start = point_(list[i - 1].end.n, list[i - 1].end.e);
  if (list.length && pointEqual_(list[list.length - 1].end, list[0].start, tolerance)) list[list.length - 1].end = point_(list[0].start.n, list[0].start.e);
  return list;
}

export function segmentsToHK80Points(segments) {
  const points = [];
  normalizeHK80Segments(segments).forEach((segment, index) => {
    const part = segment.type === 'arc' ? sampleArcHK80(segment) : [segment.start, segment.end];
    part.forEach((item, itemIndex) => { if (!(index > 0 && itemIndex === 0)) points.push(item); });
  });
  if (points.length > 1 && pointEqual_(points[0], points[points.length - 1])) points.pop();
  return points;
}

export function validateHK80Segments(segments, options) {
  const list = snapHK80Segments(segments);
  const maxPoints = options?.maxPoints || 500;
  if (!list.length) return '至少需要加入 1 段直線或弧線';
  for (let i = 0; i < list.length; i += 1) {
    const segment = list[i];
    const required = [segment.start, segment.end, ...(segment.type === 'arc' ? [segment.midpoint] : [])];
    if (required.some((item) => !item || !Number.isFinite(item.n) || !Number.isFinite(item.e))) return `第 ${i + 1} 段資料不完整`;
    if (required.some((item) => !isValidHK80(item.n, item.e))) return `第 ${i + 1} 段有超出香港範圍的 HK80 座標`;
    if (pointEqual_(segment.start, segment.end, 0.001)) return `第 ${i + 1} 段起點及終點不可相同`;
    if (segment.type === 'arc' && (pointEqual_(segment.midpoint, segment.start, 0.001) || pointEqual_(segment.midpoint, segment.end, 0.001))) return `第 ${i + 1} 段弧線中點不可等於起點或終點`;
    if (segment.type === 'arc' && !arcConstruction_(segment)) return `第 ${i + 1} 段三點無法構成有效圓弧（三點共線或半徑不一致）`;
    if (i > 0 && !pointEqual_(list[i - 1].end, segment.start)) return `第 ${i + 1} 段起點未接上上一段終點`;
  }
  if (!pointEqual_(list[list.length - 1].end, list[0].start)) return '範圍未閉合：最後一段終點要等於第一段起點';
  if (segmentsToHK80Points(list).length > maxPoints) return `弧線展開後超過 ${maxPoints} 個頂點，請縮短弧段或使用較少弧度`;
  return '';
}

export async function hk80SegmentsToLatLngs(segments) {
  const converted = await Promise.all(segmentsToHK80Points(segments).map(async (item) => { const result = await toWGS84Async(item.n, item.e); return result ? { lat: result.lat, lng: result.lng } : null; }));
  return converted.filter(Boolean);
}

export async function geometryToHK80Segments(geometry) {
  const saved = getBoundaryHK80Segments(geometry);
  if (saved.length) return saved;
  const ring = normalizeGeometry(geometry)?.coordinates?.[0]?.slice(0, -1) || [];
  const points = await Promise.all(ring.map(async (p) => { const result = await toHK80Async(Number(p[1]), Number(p[0])); return result ? point_(result.N, result.E) : null; }));
  const valid = points.filter(Boolean);
  if (valid.length < 2) return [];
  return valid.map((start, index) => ({ type: 'line', start, end: valid[(index + 1) % valid.length] }));
}

export function segmentsToGeometry(segments, latLngs) {
  const geometry = latLngsToGeometry(latLngs);
  geometry.properties = { boundary_definition: { version: 2, coordinate_system: 'HK80', segments: snapHK80Segments(segments).map(segmentCopy_) } };
  return geometry;
}

function orientation_(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function onSegment_(a, b, p) { return Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]); }
function segmentsIntersect_(a, b, c, d) {
  const eps = 1e-12; const o1 = orientation_(a, b, c), o2 = orientation_(a, b, d), o3 = orientation_(c, d, a), o4 = orientation_(c, d, b);
  if (((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))) return true;
  return (Math.abs(o1) <= eps && onSegment_(a, b, c)) || (Math.abs(o2) <= eps && onSegment_(a, b, d)) || (Math.abs(o3) <= eps && onSegment_(c, d, a)) || (Math.abs(o4) <= eps && onSegment_(c, d, b));
}
export function polygonAreaM2(latlngs) {
  if (!latlngs || latlngs.length < 3) return 0;
  const radius = 6378137; const cosLat = Math.cos(Number(latlngs[0].lat) * DEG); let area = 0;
  for (let i = 0; i < latlngs.length; i += 1) { const a = latlngs[i], b = latlngs[(i + 1) % latlngs.length]; const ax = Number(a.lng) * DEG * radius * cosLat, ay = Number(a.lat) * DEG * radius; const bx = Number(b.lng) * DEG * radius * cosLat, by = Number(b.lat) * DEG * radius; area += ax * by - bx * ay; }
  return Math.abs(area) / 2;
}
export function validateLatLngs(latlngs, options) {
  const points = latlngs || []; const maxPoints = options?.maxPoints || 500;
  if (points.length < 3) return '至少需要 3 個點'; if (points.length > maxPoints) return '頂點數量不可超過 ' + maxPoints + ' 個';
  const ring = points.map((p) => [Number(p.lng), Number(p.lat)]);
  for (let i = 0; i < ring.length; i += 1) { if (!Number.isFinite(ring[i][0]) || !Number.isFinite(ring[i][1]) || ring[i][0] < -180 || ring[i][0] > 180 || ring[i][1] < -90 || ring[i][1] > 90) return '有無效座標'; const next = ring[(i + 1) % ring.length]; if (Math.abs(ring[i][0] - next[0]) < 1e-10 && Math.abs(ring[i][1] - next[1]) < 1e-10) return '不可有重複或零長度邊'; }
  for (let i = 0; i < ring.length; i += 1) { const a = ring[i], b = ring[(i + 1) % ring.length]; for (let j = i + 1; j < ring.length; j += 1) { if (j === i || j === i + 1 || (i === 0 && j === ring.length - 1)) continue; if (segmentsIntersect_(a, b, ring[j], ring[(j + 1) % ring.length])) return '地盤範圍邊線不可交叉'; } }
  if (polygonAreaM2(points) < 0.01) return '地盤範圍面積不可為零'; return '';
}