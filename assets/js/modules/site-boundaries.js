/** Display and persistence adapter for each project's editable site boundary. */
import { state } from './state.js';
import { updateStatus } from './dom.js';
import { ApiService } from '../api.js';
import { on } from '../core/event-bus.js';
import { geometryToLatLngs } from '../core/site-boundary-geometry.js';

const BOUNDARY_STYLE = {
  color: '#d32f2f', weight: 4, opacity: 0.95,
  fillColor: '#ef5350', fillOpacity: 0.14,
  pane: 'companyBoundaryPane', interactive: false
};

function clearLayer_() {
  if (state.siteBoundaryLayer) state.siteBoundaryLayer.clearLayers();
  state.siteBoundary = null;
}

export function renderSiteBoundary(boundary) {
  if (!state.siteBoundaryLayer || !state.map) return;
  state.siteBoundaryLayer.clearLayers();
  state.siteBoundary = boundary || null;
  if (!boundary || !boundary.geometry) return;
  const points = geometryToLatLngs(boundary.geometry);
  if (points.length < 3) return;
  L.polygon(points, BOUNDARY_STYLE).addTo(state.siteBoundaryLayer);
}

let boundaryRequestId_ = 0;
export async function loadSiteBoundary(projectId, opts) {
  const pid = String(projectId || '').trim();
  const requestId = ++boundaryRequestId_;
  if (!pid || !state.map) { clearLayer_(); return null; }
  try {
    const params = { project: pid };
    if (opts && opts.nocache) params.nocache = String(opts.nocache);
    const response = await ApiService.get('boundaries', params);
    if (requestId !== boundaryRequestId_ || pid !== String(state.curProject || '').trim()) return null;
    const boundary = response && response.data ? response.data : null;
    renderSiteBoundary(boundary);
    return boundary;
  } catch (error) {
    if (requestId !== boundaryRequestId_ || pid !== String(state.curProject || '').trim()) return null;
    clearLayer_();
    updateStatus('⚠️ 地盤範圍載入失敗');
    console.warn('[site-boundaries] load failed', error);
    return null;
  }
}

export function initSiteBoundaryLayer() {
  if (!state.map) return;
  if (!state.map.getPane('companyBoundaryPane')) {
    const pane = state.map.createPane('companyBoundaryPane');
    pane.style.zIndex = 360;
  }
  if (!state.siteBoundaryLayer) state.siteBoundaryLayer = L.layerGroup().addTo(state.map);
  on('project:selected', function (pid) { loadSiteBoundary(pid); });
  if (state.curProject) loadSiteBoundary(state.curProject);
}

export function getCurrentSiteBoundary() { return state.siteBoundary; }
