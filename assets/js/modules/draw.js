/**
 * 繪圖／量測／落點互動模組 [Phase1]（零 vendor）
 * - startMeasure('line'|'area')：量距離／面積
 * - startDrawPolygon(cb)：畫地盤邊界（多邊形）
 * - startPick(cb, hint)：撳一下揀位置（新增／移動樹木）
 */
import { state } from './state.js';
import { updateStatus } from './dom.js';

let mode = null;          // 'line' | 'area' | 'polygon' | 'pick'
let pts = [];
let vertexLayer = null;   // L.layerGroup
let shape = null;         // committed polyline/polygon
let rubber = null;        // preview segment
let finalLayer = null;    // finished result
let pickCb = null;
let polygonCb = null;
let barEl = null;

const LINE_STYLE = { color: '#1565c0', weight: 3, interactive: false };
const AREA_STYLE = { color: '#1565c0', weight: 2, fillColor: '#1565c0', fillOpacity: 0.15, interactive: false };

// 🔥 修復：量測圖形改用 SVG renderer（否則用 map 預設 Canvas renderer，
// 會生成覆蓋全視窗嘅 canvas 並食晒點擊，令下方樹木撳唔到）
let svgRenderer = null;
function getSvgRenderer() {
  if (!svgRenderer) svgRenderer = L.svg({ padding: 0.5 });
  return svgRenderer;
}

export function getMode() { return mode; }

function setCrosshair(on) {
  if (!state.map) return;
  state.map.getContainer().classList.toggle('interact-mode', on);
}

function ensureBar() {
  if (barEl) return barEl;
  barEl = document.createElement('div');
  barEl.className = 'interact-bar';
  barEl.innerHTML =
    '<button class="ib-cancel" type="button">✖ 取消</button>' +
    '<span class="ib-readout"></span>' +
    '<button class="ib-done" type="button">✅ 完成</button>';
  document.body.appendChild(barEl);
  barEl.querySelector('.ib-cancel').addEventListener('click', function () { cancelInteraction(); });
  barEl.querySelector('.ib-done').addEventListener('click', function () { finishShape(); });
  return barEl;
}

function hideBar() {
  if (barEl) { barEl.remove(); barEl = null; }
}

function removeTemp() {
  if (vertexLayer) { state.map.removeLayer(vertexLayer); vertexLayer = null; }
  if (shape) { state.map.removeLayer(shape); shape = null; }
  if (rubber) { state.map.removeLayer(rubber); rubber = null; }
}

function removeFinal() {
  if (finalLayer) { state.map.removeLayer(finalLayer); finalLayer = null; }
}

function render() {
  removeTemp();
  vertexLayer = L.layerGroup().addTo(state.map);
  pts.forEach(function (p) {
    vertexLayer.addLayer(L.circleMarker(p, {
      radius: 5, color: '#fff', weight: 1.5, fillColor: '#1565c0', fillOpacity: 1,
      renderer: getSvgRenderer(),
      interactive: false
    }));
  });
  if (pts.length >= 2) {
    shape = (mode === 'line' ? L.polyline : L.polygon)(pts, Object.assign({}, (mode === 'line' ? LINE_STYLE : AREA_STYLE), { renderer: getSvgRenderer() })).addTo(state.map);
  }
}

function computeLength(latlngs) {
  let total = 0;
  for (let i = 1; i < latlngs.length; i++) total += latlngs[i - 1].distanceTo(latlngs[i]);
  return total;
}

function computeArea(latlngs) {
  if (latlngs.length < 3) return 0;
  const R = 6378137;
  const k = Math.cos(latlngs[0].lat * Math.PI / 180);
  let area = 0;
  for (let i = 0; i < latlngs.length; i++) {
    const a = latlngs[i], b = latlngs[(i + 1) % latlngs.length];
    const x1 = a.lng * Math.PI / 180 * R * k, y1 = a.lat * Math.PI / 180 * R;
    const x2 = b.lng * Math.PI / 180 * R * k, y2 = b.lat * Math.PI / 180 * R;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function fmtLen(m) { return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : m.toFixed(1) + ' m'; }
function fmtArea(m2) { return m2 >= 10000 ? (m2 / 10000).toFixed(3) + ' 公頃' : m2.toFixed(1) + ' ㎡'; }

function bindTooltip(layer, text) {
  layer.bindTooltip(text, { permanent: true, direction: 'top', className: 'measure-tip', offset: [0, -8] }).openTooltip();
}

function onClick(e) {
  if (mode === 'pick') {
    state.map.off('click', onClick);
    const cb = pickCb;
    resetInteraction();
    if (cb) cb(e.latlng);
    return;
  }
  pts.push(e.latlng);
  render();
}

function onMouseMove(e) {
  if (mode === 'pick' || mode === null) return;
  if (!pts.length) return;

  const preview = pts.concat([e.latlng]);
  let text = '';
  if (mode === 'line') {
    text = '📏 ' + fmtLen(computeLength(preview));
  } else if (pts.length >= 2) {
    text = '📐 ' + fmtArea(computeArea(preview)) + '｜周 ' + fmtLen(computeLength(preview));
  } else {
    text = '📐 撳多一點…';
  }
  if (barEl) barEl.querySelector('.ib-readout').textContent = text;

  if (rubber) state.map.removeLayer(rubber);
  rubber = L.polyline([pts[pts.length - 1], e.latlng], { color: '#1565c0', weight: 2, dashArray: '4 6', opacity: 0.6, renderer: getSvgRenderer(), interactive: false }).addTo(state.map);
}

function finishShape() {
  const m = mode;
  if (m === 'line') {
    if (pts.length < 2) { updateStatus('⚠️ 至少撳兩點先可以量距離'); return; }
    const donePts = pts.slice();
    const len = computeLength(donePts);
    removeFinal();
    finalLayer = L.polyline(donePts, Object.assign({}, LINE_STYLE, { renderer: getSvgRenderer() })).addTo(state.map);
    bindTooltip(finalLayer, '📏 ' + fmtLen(len));
    updateStatus('✅ 量距完成：' + fmtLen(len));
    resetInteraction();
    return;
  }
  if (m === 'area' || m === 'polygon') {
    if (pts.length < 3) { updateStatus('⚠️ 至少撳三點先可以量面積'); return; }
    const donePts = pts.slice();
    const area = computeArea(donePts);
    const len = computeLength(donePts);
    removeFinal();
    finalLayer = L.polygon(donePts, Object.assign({}, AREA_STYLE, { renderer: getSvgRenderer() })).addTo(state.map);
    bindTooltip(finalLayer, '📐 ' + fmtArea(area) + '｜周 ' + fmtLen(len));
    const cb = polygonCb;
    resetInteraction();
    if (m === 'polygon' && cb) cb(donePts, area);
    else updateStatus('✅ 量測完成：' + fmtArea(area));
    return;
  }
}

function resetInteraction() {
  removeTemp();
  setCrosshair(false);
  hideBar();
  state.map.off('click', onClick);
  state.map.off('mousemove', onMouseMove);
  if (state.map.doubleClickZoom) state.map.doubleClickZoom.enable();
  mode = null;
  pickCb = null;
  polygonCb = null;
  pts = [];
}

export function cancelInteraction() {
  if (!mode) return;
  removeFinal();
  resetInteraction();
  updateStatus('✅ 已取消');
}

export function clearAllDrawings() {
  removeFinal();
  if (mode) resetInteraction();
  state.drawBoundary = null;
  updateStatus('🗑️ 已清除所有量測／繪圖');
}

function begin(m, opts) {
  if (mode) resetInteraction();
  removeFinal();
  mode = m;
  pts = [];
  setCrosshair(true);
  state.map.on('click', onClick);
  state.map.on('mousemove', onMouseMove);
  if (state.map.doubleClickZoom) state.map.doubleClickZoom.disable();
  if (m !== 'pick') ensureBar();
  if (opts && opts.hint) updateStatus(opts.hint);
}

export function startMeasure(kind) {
  begin(kind, { hint: kind === 'line' ? '📏 量距：撳地圖加點，撳「完成」結束' : '📐 量面積：撳地圖加點，撳「完成」結束' });
}

export function startDrawPolygon(cb) {
  polygonCb = cb;
  begin('polygon', { hint: '🖍 畫邊界：撳地圖加角點，撳「完成」閉合' });
}

export function startPick(cb, hint) {
  pickCb = cb;
  begin('pick', { hint: hint || '📍 撳一下選擇位置' });
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && mode) cancelInteraction();
});
