/** HK80 survey segment editor shared by the main map and site information page. */
import { state } from './state.js';
import { updateStatus, showToast } from './dom.js';
import { ApiService } from '../api.js';
import { AuthService } from '../auth.js';
import { ErrorCodes } from '../core/error-codes.js';
import { emit } from '../core/event-bus.js';
import { getCurrentSiteBoundary, renderSiteBoundary } from './site-boundaries.js';
import { geometryToHK80Segments, hk80SegmentsToLatLngs, polygonAreaM2, segmentsToGeometry, segmentsToHK80Points, snapHK80Segments, validateHK80Segments, validateLatLngs } from '../core/site-boundary-geometry.js';
import { toWGS84Async } from '../core/coordinates.js';

let activeController_ = null;
const EDIT_STYLE = { color: '#c62828', weight: 4, fillColor: '#ef5350', fillOpacity: 0.18, interactive: false };

function node_(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function input_(label, value) { const wrapper = node_('label', 'sbe-field'); wrapper.appendChild(node_('span', '', label)); const input = node_('input'); input.type = 'number'; input.step = '0.1'; input.inputMode = 'decimal'; input.value = value ?? ''; wrapper.appendChild(input); return { wrapper, input }; }
function pointValues_(point) { return point ? { n: point.n, e: point.e } : { n: '', e: '' }; }
function pointText_(point) { return `N ${Number(point.n).toFixed(1)} / E ${Number(point.e).toFixed(1)}`; }
function makePointFields_(parent, title, point) { parent.appendChild(node_('strong', 'sbe-field-title', title)); const row = node_('div', 'sbe-field-row'); const values = pointValues_(point); const n = input_('N（北向）', values.n), e = input_('E（東向）', values.e); row.append(n.wrapper, e.wrapper); parent.appendChild(row); return { n: n.input, e: e.input }; }
function parsePoint_(fields) { return { n: Number(fields.n.value), e: Number(fields.e.value) }; }
function validNumber_(value) { return value !== '' && Number.isFinite(Number(value)); }
function pointsEqual_(a, b, tolerance = 0.2) { return Boolean(a && b) && Math.abs(Number(a.n) - Number(b.n)) <= tolerance && Math.abs(Number(a.e) - Number(b.e)) <= tolerance; }
function isClosed_(segments) { return Boolean(segments.length && pointsEqual_(segments[segments.length - 1].end, segments[0].start)); }
function reconnectSegments_(segments, closeLoop = false) {
  for (let index = 1; index < segments.length; index += 1) if (segments[index - 1]?.end) segments[index].start = { ...segments[index - 1].end };
  if (closeLoop && segments.length && segments[0]?.start && segments[segments.length - 1]?.end) segments[segments.length - 1].end = { ...segments[0].start };
}
function endpointForNew_(segments) { return segments.length ? segments[segments.length - 1].end : null; }
function closeForm_(controller) { controller.formPanel.hidden = true; controller.formPanel.replaceChildren(); }

function createForm_(controller, type, editIndex) {
  const existing = editIndex === null ? null : controller.segments[editIndex];
  const segment = existing || { type, start: endpointForNew_(controller.segments), end: null };
  const panel = controller.formPanel; panel.replaceChildren(); panel.hidden = false;
  const panelClose = node_('button', 'sbe-panel-close', '×'); panelClose.type = 'button'; panelClose.setAttribute('aria-label', '關閉測量段輸入'); panelClose.addEventListener('click', () => closeForm_(controller)); panel.appendChild(panelClose);
  panel.appendChild(node_('h3', '', existing ? '修改測量段' : (type === 'arc' ? '新增圓弧段' : '新增直線段')));
  panel.appendChild(node_('p', 'sbe-help', type === 'arc' ? '輸入弧線起點、弧線中點及終點。系統會按三點計算圓弧，所有數值必須使用同一 HK80 坐標系統。' : '輸入直線段起點及終點 HK80 N/E。相鄰段端點必須接合。'));
  const fields = { start: makePointFields_(panel, '起點', segment.start), end: makePointFields_(panel, '終點', segment.end) };
  if (type === 'arc') {
    fields.midpoint = makePointFields_(panel, '弧線中點', segment.midpoint);
  }
  const actions = node_('div', 'sbe-form-actions'); const cancel = node_('button', 'sbe-secondary', '取消'); cancel.type = 'button'; const save = node_('button', 'sbe-primary', existing ? '套用此段' : '加入此段'); save.type = 'button'; actions.append(cancel, save); panel.appendChild(actions);
  cancel.addEventListener('click', () => { panel.hidden = true; panel.replaceChildren(); });
  save.addEventListener('click', () => {
    const groups = [fields.start, fields.end, ...(fields.midpoint ? [fields.midpoint] : [])];
    if (!groups.every((group) => validNumber_(group.n.value) && validNumber_(group.e.value))) return showToast('請完整輸入所有 HK80 N/E 數值', 'warning');
    const next = { type, start: parsePoint_(fields.start), end: parsePoint_(fields.end) }; if (type === 'arc') next.midpoint = parsePoint_(fields.midpoint);
    const wasClosed = isClosed_(controller.segments);
    if (editIndex === null) controller.segments.push(next); else controller.segments[editIndex] = next;
    reconnectSegments_(controller.segments, wasClosed); closeForm_(controller); render_(controller); updateStatus('🟥 已更新測量段，請檢查接合及閉合狀態');
  });
}

function createToolbar_(controller) {
  const bar = node_('section', `${controller.toolbarClass} sbe-editor-shell`);
  const heading = node_('div', 'sbe-editor-heading'); heading.append(node_('strong', '', '編輯地盤範圍'), node_('span', '', '拖曳段落排序；地圖即時顯示輸入點')); bar.appendChild(heading);
  const actions = node_('div', 'sbe-editor-actions');
  [['sbe-cancel', '取消'], ['sbe-line', '＋ 直線段'], ['sbe-arc', '＋ 弧線段'], ['sbe-close', '↪ 閉合範圍'], ['sbe-clear', '清除範圍'], ['sbe-save', '保存範圍']].forEach(([className, label]) => { const button = node_('button', className, label); button.type = 'button'; actions.appendChild(button); });
  bar.appendChild(actions);
  const status = node_('span', 'sbe-count'); bar.appendChild(status); document.body.appendChild(bar);
  bar.querySelector('.sbe-cancel').addEventListener('click', () => controller.cancel());
  bar.querySelector('.sbe-line').addEventListener('click', () => createForm_(controller, 'line', null));
  bar.querySelector('.sbe-arc').addEventListener('click', () => createForm_(controller, 'arc', null));
  bar.querySelector('.sbe-close').addEventListener('click', () => {
    if (!controller.segments.length) return showToast('請先加入至少一段', 'warning');
    const first = controller.segments[0].start, last = controller.segments[controller.segments.length - 1].end;
    if (pointsEqual_(first, last)) return showToast('範圍已經閉合', 'info');
    controller.segments.push({ type: 'line', start: { ...last }, end: { ...first } }); reconnectSegments_(controller.segments, true); render_(controller);
  });
  bar.querySelector('.sbe-clear').addEventListener('click', () => controller.deleteBoundary());
  bar.querySelector('.sbe-save').addEventListener('click', () => save_(controller));
  controller.toolbar = bar;
}
function createFormPanel_(controller) { const panel = node_('section', 'sbe-segment-panel'); panel.hidden = true; panel.setAttribute('aria-label', 'HK80 測量段輸入'); controller.toolbar.appendChild(panel); controller.formPanel = panel; }
function reverseSegment_(segment) { return { ...segment, start: { ...segment.end }, end: { ...segment.start } }; }
function connectedSegmentOrder_(segments) {
  if (segments.length < 2) return segments;
  const remaining = segments.slice(); const ordered = [remaining.shift()];
  while (remaining.length) {
    const end = ordered[ordered.length - 1].end; const nextIndex = remaining.findIndex((segment) => pointsEqual_(segment.start, end) || pointsEqual_(segment.end, end));
    if (nextIndex < 0) return segments;
    const next = remaining.splice(nextIndex, 1)[0]; ordered.push(pointsEqual_(next.start, end) ? next : reverseSegment_(next));
  }
  return ordered;
}
function moveSegment_(controller, from, to) {
  if (to < 0 || to >= controller.segments.length || from === to) return;
  const wasClosed = isClosed_(controller.segments); const [segment] = controller.segments.splice(from, 1); controller.segments.splice(to, 0, segment); controller.segments = connectedSegmentOrder_(controller.segments); reconnectSegments_(controller.segments, wasClosed); render_(controller); updateStatus(`🟥 已將第 ${from + 1} 段移到第 ${to + 1} 段，並按端點重新接駁`);
}
function renderList_(controller) {
  controller.list.replaceChildren();
  if (!controller.segments.length) controller.list.appendChild(node_('p', 'sbe-empty', '未加入段落。請按「直線段」或「弧線段」開始輸入測量數據。'));
  controller.segments.forEach((segment, index) => {
    const item = node_('div', 'sbe-segment-item'); item.draggable = true; item.dataset.index = String(index); item.setAttribute('aria-label', `第 ${index + 1} 段，可拖曳排序`); const grip = node_('span', 'sbe-drag-handle', '⠿'); grip.title = '拖曳排序'; grip.setAttribute('aria-hidden', 'true'); item.appendChild(grip); const type = segment.type === 'arc' ? '弧線' : '直線'; const text = segment.type === 'arc' ? `${type}｜${pointText_(segment.start)} → ${pointText_(segment.end)}｜中點 ${pointText_(segment.midpoint)}` : `${type}｜${pointText_(segment.start)} → ${pointText_(segment.end)}`;
    item.appendChild(node_('span', 'sbe-segment-text', `${index + 1}. ${text}`));
    const moveUp = node_('button', 'sbe-small-button sbe-reorder', '↑'); moveUp.type = 'button'; moveUp.disabled = index === 0; moveUp.setAttribute('aria-label', `第 ${index + 1} 段上移`); moveUp.addEventListener('click', () => moveSegment_(controller, index, index - 1));
    const moveDown = node_('button', 'sbe-small-button sbe-reorder', '↓'); moveDown.type = 'button'; moveDown.disabled = index === controller.segments.length - 1; moveDown.setAttribute('aria-label', `第 ${index + 1} 段下移`); moveDown.addEventListener('click', () => moveSegment_(controller, index, index + 1));
    const edit = node_('button', 'sbe-small-button', '修改'); edit.type = 'button'; edit.addEventListener('click', () => createForm_(controller, segment.type, index));
    const remove = node_('button', 'sbe-small-button sbe-remove', '刪除'); remove.type = 'button'; remove.addEventListener('click', () => { const wasClosed = isClosed_(controller.segments); controller.segments.splice(index, 1); reconnectSegments_(controller.segments, wasClosed); render_(controller); });
    item.append(moveUp, moveDown, edit, remove); controller.list.appendChild(item);
    item.addEventListener('dragstart', () => { controller.dragIndex = index; item.classList.add('is-dragging'); });
    item.addEventListener('dragend', () => { controller.dragIndex = null; item.classList.remove('is-dragging'); });
    item.addEventListener('dragover', (event) => { event.preventDefault(); item.classList.add('is-drag-over'); });
    item.addEventListener('dragleave', () => item.classList.remove('is-drag-over'));
    item.addEventListener('drop', (event) => { event.preventDefault(); item.classList.remove('is-drag-over'); const from = controller.dragIndex; if (Number.isInteger(from)) moveSegment_(controller, from, index); });
  });
}
function surveyPoints_(segments) {
  const points = []; const add = (point) => { if (point && !points.some((item) => Math.abs(item.n - point.n) < 0.01 && Math.abs(item.e - point.e) < 0.01)) points.push(point); };
  segments.forEach((segment) => { add(segment.start); if (segment.type === 'arc') add(segment.midpoint); add(segment.end); }); return points;
}
async function renderPreview_(controller) {
  const renderId = ++controller.renderId; const points = segmentsToHK80Points(controller.segments); let latLngs = [];
  try { latLngs = await hk80SegmentsToLatLngs(controller.segments); } catch (error) { console.warn('[site-boundary-editor] preview conversion failed', error); }
  if (renderId !== controller.renderId || controller.closed) return;
  [controller.preview, controller.vertices].forEach((layer) => { if (layer) controller.map.removeLayer(layer); }); controller.preview = controller.vertices = null;
  if (latLngs.length >= 2) controller.preview = L.polygon(latLngs, EDIT_STYLE).addTo(controller.map);
  controller.vertices = L.layerGroup().addTo(controller.map);
  const controlPoints = surveyPoints_(controller.segments);
  const endpointLatLngs = await Promise.all(controlPoints.map((point) => toWGS84Async(point.n, point.e)));
  if (renderId !== controller.renderId || controller.closed) return;
  endpointLatLngs.forEach((point, index) => { if (!point) return; const isMidpoint = controller.segments.some((segment) => segment.type === 'arc' && pointsEqual_(segment.midpoint, controlPoints[index], 0.01)); const icon = L.divIcon({ className: `sbe-point-icon${isMidpoint ? ' sbe-point-icon--midpoint' : ''}`, html: `<span>P${index + 1}</span>`, iconSize: [36, 30], iconAnchor: [18, 15] }); L.marker([point.lat, point.lng], { icon, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(controller.vertices); });
  const problems = validateHK80Segments(controller.segments); const mapProblem = latLngs.length >= 3 ? validateLatLngs(latLngs) : '未有足夠頂點';
  controller.count.textContent = `測量段：${controller.segments.length}｜輸入點：${controlPoints.length}｜展開頂點：${points.length}｜${problems || mapProblem ? '需檢查輸入' : '已閉合'}｜面積：約 ${Math.round(polygonAreaM2(latLngs))} ㎡`;
  // WGS84 預覽係非同步，唔應令已通過 HK80 閉合檢查嘅保存按鈕永久 disabled。
  controller.saveButton.disabled = Boolean(problems || points.length < 3); controller.closeButton.disabled = !controller.segments.length; renderList_(controller);
}
function render_(controller) { controller.segments = snapHK80Segments(controller.segments); renderPreview_(controller); }
function cleanup_(controller) { controller.closed = true; controller.renderId += 1; [controller.preview, controller.vertices].forEach((layer) => { if (layer) controller.map.removeLayer(layer); }); controller.formPanel?.remove(); controller.toolbar?.remove(); controller.list?.remove(); controller.map.getContainer().classList.remove('site-boundary-editing'); if (controller.isMainMap) state.siteBoundaryEditor = false; if (activeController_ === controller) activeController_ = null; }
async function save_(controller) {
  controller.segments = snapHK80Segments(controller.segments);
  const problem = validateHK80Segments(controller.segments); if (problem) return showToast(problem, 'warning');
  let latLngs; try { latLngs = await hk80SegmentsToLatLngs(controller.segments); } catch (error) { showToast('HK80 轉換失敗，請檢查坐標', 'error'); return; }
  const mapProblem = validateLatLngs(latLngs); if (mapProblem) return showToast(mapProblem, 'warning');
  const geometry = segmentsToGeometry(controller.segments, latLngs); const payload = { type: controller.original?.boundary_id ? 'update_boundary' : 'create_boundary', project_id: controller.projectId, geometry }; if (controller.original?.boundary_id) Object.assign(payload, { boundary_id: controller.original.boundary_id, base_version: Number(controller.original.version || 1) });
  controller.saveButton.classList.add('is-loading');
  try {
    const response = await ApiService.post(payload); if (!response?.ok) return showToast(ErrorCodes.messageForResponse(response, '地盤範圍保存失敗'), 'error');
    const saved = response.boundary || { boundary_id: response.boundary_id || controller.original?.boundary_id, project_id: controller.projectId, geometry, version: response.version || Number(controller.original?.version || 0) + 1 }; cleanup_(controller); controller.onSaved(saved); emit('boundary:changed', saved); showToast(response.queued ? '📥 已暫存，連線後同步地盤範圍' : '✅ 地盤範圍已保存', response.queued ? 'info' : 'success', 4000);
  } catch (error) { showToast('❌ 地盤範圍保存失敗', 'error'); console.warn('[site-boundary-editor] save failed', error); } finally { controller.saveButton.classList.remove('is-loading'); }
}
async function delete_(controller) {
  if (!controller.original?.boundary_id) { controller.cancel(); return; } if (!window.confirm('確定要清除目前地盤範圍？')) return;
  try {
    const response = await ApiService.post({ type: 'delete_boundary', project_id: controller.projectId, boundary_id: controller.original.boundary_id, base_version: Number(controller.original.version || 1) }); if (!response?.ok) return showToast(ErrorCodes.messageForResponse(response, '清除地盤範圍失敗'), 'error'); cleanup_(controller); controller.onDeleted(); emit('boundary:changed', null); showToast(response.queued ? '📥 清除操作已暫存' : '✅ 已清除地盤範圍', response.queued ? 'info' : 'success');
  } catch (error) { showToast('❌ 清除地盤範圍失敗', 'error'); console.warn('[site-boundary-editor] delete failed', error); }
}

export function isEditingSiteBoundary() { return Boolean(activeController_); }
export async function startSiteBoundaryEdit(options = {}) {
  if (activeController_) return activeController_; const map = options.map || state.map; const projectId = String(options.projectId || state.curProject || '').trim();
  if (!projectId) { showToast('請先選擇地盤', 'warning'); return null; } if (!map) { showToast('地圖尚未準備好', 'warning'); return null; } if (AuthService && !(await AuthService.promptAuth())) return null;
  const original = options.boundary !== undefined ? options.boundary : getCurrentSiteBoundary();
  const controller = { map, projectId, original, segments: await geometryToHK80Segments(original?.geometry), preview: null, vertices: null, toolbar: null, formPanel: null, list: null, count: null, saveButton: null, closeButton: null, toolbarClass: options.toolbarClass || 'site-boundary-editor-bar', renderId: 0, closed: false, isMainMap: !options.map, onSaved: options.onSaved || ((saved) => renderSiteBoundary(saved)), onDeleted: options.onDeleted || (() => renderSiteBoundary(null)) };
  activeController_ = controller; if (controller.isMainMap) state.siteBoundaryEditor = true; map.getContainer().classList.add('site-boundary-editing'); createToolbar_(controller); controller.count = controller.toolbar.querySelector('.sbe-count'); controller.saveButton = controller.toolbar.querySelector('.sbe-save'); controller.closeButton = controller.toolbar.querySelector('.sbe-close'); controller.list = node_('div', 'sbe-segment-list'); controller.toolbar.appendChild(controller.list); createFormPanel_(controller); render_(controller); updateStatus(controller.segments.length ? '🟥 測量段編輯：可修改 HK80 段落；弧線用起點、中點、終點定義' : '🟥 請以 HK80 數據加入直線段或弧線段');
  controller.cancel = () => { if (controller.closed) return; cleanup_(controller); if (controller.isMainMap) renderSiteBoundary(original); options.onCancel?.(); updateStatus('✅ 已取消地盤範圍修改'); }; controller.deleteBoundary = () => delete_(controller); return controller;
}
export async function deleteSiteBoundary() { return activeController_ ? delete_(activeController_) : null; }
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && activeController_) activeController_.cancel(); });
