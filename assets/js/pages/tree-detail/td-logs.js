import { ApiService } from '../../api.js';
import { ErrorCodes } from '../../core/error-codes.js';
import { escapeHtml } from '../../core/utils.js';
import { TD } from './route.js';
import { zoomImage, downloadPhoto } from './nfc-navigation.js';
import {
  fmtTime,
  convertGoogleDriveUrl,
  sanitizeLogsHTML
} from './td-utils.js';

const $ = function (s) { return document.querySelector(s); };

let logsDelegated = false;

// ---- cursor pagination state ----
const PAGE_LIMIT = 20;
let nextCursor = null;
let hasMore = true;
let loading = false;
let currentTreeId = '';
let currentPrj = '';

function buildLogHtml(r) {
  let photoHtml = '';
  let photos = r.photo_urls || r.photo_url;
  if (!photos) photos = [];
  else if (typeof photos === 'string') {
    if (photos.indexOf('[') !== -1 && photos.indexOf(']') !== -1) {
      try { photos = JSON.parse(photos); } catch (e) { photos = photos.replace(/^\[|\]$/g, ''); }
    }
    if (typeof photos === 'string' && photos.indexOf(',') !== -1) photos = photos.split(',').map(function (url) { return url.trim(); });
    else if (typeof photos === 'string') photos = [photos];
  }
  if (!Array.isArray(photos)) photos = [];
  photos = photos.filter(function (p) { return p && String(p).trim() !== ''; });
  if (photos.length > 0) {
    const timeStr = fmtTime(r.time);
    const treeIdEscaped = escapeHtml(r.tree_id || TD.id);
    const A = '&';
    const timeStrForDownload = timeStr.replace(/&/g, A + 'amp;').replace(/'/g, A + 'apos;');
    photoHtml += '<div class="inspection-photo-grid">';
    for (let i = 0; i < photos.length; i++) {
      const photoUrl = photos[i];
      const displayUrl = convertGoogleDriveUrl(photoUrl, false);
      const downloadUrl = convertGoogleDriveUrl(photoUrl, true);
      const displayUrlEscaped = escapeHtml(displayUrl);
      const downloadUrlEscaped = escapeHtml(downloadUrl);
      const photoIndex = i + 1;
      photoHtml += '<div class="inspection-photo-item"><img class="inspection-photo-thumb" src="' + displayUrlEscaped + '" data-zoom="' + displayUrlEscaped + '" loading="lazy" decoding="async" crossorigin="anonymous" referrerpolicy="no-referrer" title="點擊放大"><button class="inspection-photo-btn" data-download="' + downloadUrlEscaped + '" data-tree="' + treeIdEscaped + '" data-time="' + timeStrForDownload + '" data-index="' + photoIndex + '">⬇️ #' + photoIndex + '</button></div>';
    }
    photoHtml += '</div>';
  }
  return '<div class="log"><span class="ok">' + escapeHtml(r.health) + '</span>｜' + escapeHtml(r.staff) + '｜' + fmtTime(r.time) + '<br>' + escapeHtml(r.note || '') + photoHtml + '</div>';
}

function ensureLoadMoreUI() {
  const logs = $('#logs');
  if (!logs) return;
  let wrap = document.getElementById('logs-pagination');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'logs-pagination';
    wrap.className = 'logs-pagination';
    logs.insertAdjacentElement('afterend', wrap);
  }
  if (!hasMore) {
    wrap.innerHTML = '<span class="logs-pagination__empty">— 已全部載入 —</span>';
    return;
  }
  wrap.innerHTML = '<button id="loadMoreLogsBtn" type="button" class="btn-accent"' + (loading ? ' disabled' : '') + '>' + (loading ? '載入中…' : '載入更多') + '</button>';
  const btn = document.getElementById('loadMoreLogsBtn');
  if (btn && !btn._bound) {
    btn._bound = true;
    btn.addEventListener('click', function () { loadLogs({ append: true }); });
  }
}

function removePaginationUI() {
  const wrap = document.getElementById('logs-pagination');
  if (wrap) wrap.remove();
}

// [Phase7] 巡查相片用事件委派（不再用 inline onclick/onerror）
export function attachLogsDelegation() {
  if (logsDelegated) return;
  const logs = $('#logs');
  if (!logs) return;
  logsDelegated = true;
  logs.addEventListener('click', function (e) {
    const img = (e.target && e.target.closest) ? e.target.closest('.inspection-photo-thumb') : null;
    if (img) { e.stopPropagation(); const src = img.getAttribute('data-zoom'); if (src) zoomImage(src); return; }
    const btn = (e.target && e.target.closest) ? e.target.closest('.inspection-photo-btn') : null;
    if (btn) { e.stopPropagation(); const url = btn.getAttribute('data-download'); const tree = btn.getAttribute('data-tree'); const time = btn.getAttribute('data-time'); const idx = parseInt(btn.getAttribute('data-index') || '1', 10); downloadPhoto(url, tree, time, idx); }
  });
  logs.addEventListener('error', function (e) {
    const img = e.target;
    if (img && img.classList && img.classList.contains('inspection-photo-thumb') && img.parentElement) img.parentElement.classList.add('is-hidden');
  }, true);
}

export function loadLogs(opts) {
  opts = opts || {};
  const isAppend = !!opts.append;
  attachLogsDelegation();
  const logsEl = $('#logs');
  if (!logsEl) return Promise.resolve();
  const tid = String(TD.id || '');
  const prj = String(TD.prj || '');
  const isReset = !!opts.reset || tid !== currentTreeId || prj !== currentPrj;
  if (isReset) {
    currentTreeId = tid; currentPrj = prj; nextCursor = null; hasMore = true; removePaginationUI();
    if (!isAppend) logsEl.innerHTML = '<div class="log">載入中…</div>';
  }
  if (isAppend) {
    if (loading || !hasMore) return Promise.resolve();
  } else {
    if (loading) return Promise.resolve();
    if (!isReset) { nextCursor = null; hasMore = true; }
  }
  if (isAppend && !hasMore) { ensureLoadMoreUI(); return Promise.resolve(); }
  loading = true; if (isAppend) ensureLoadMoreUI();
  const params = { id: tid, prj: prj, limit: String(PAGE_LIMIT) };
  if (nextCursor) params.cursor = nextCursor;
  return ApiService.get('inspections', params).then(function(res){
    if (res && (res.error === 'OFFLINE' || res.offline)) {
      if (!isAppend) logsEl.innerHTML = '<div class="log">📴 離線模式：暫無巡查記錄快取</div>';
      removePaginationUI(); return;
    }
    if (res && res.ok === false) {
      const msg = (ErrorCodes.messageForResponse) ? ErrorCodes.messageForResponse(res, res.error) : (res.error || '載入失敗');
      if (!isAppend) logsEl.innerHTML = '<div class="log">載入失敗：' + escapeHtml(msg) + '</div>';
      if (res.error_code === 'VALIDATION_FAILED' && res.details && res.details.some(function(d){return d.field==='cursor';})) { nextCursor=null; hasMore=true; }
      ensureLoadMoreUI(); return;
    }
    const data = (res && res.data) || [];
    const pagination = (res && res.pagination) || null;
    if (pagination) { nextCursor = pagination.next_cursor || null; hasMore = !!pagination.has_more; } else { nextCursor=null; hasMore=false; }
    if (!data.length) { if (!isAppend) logsEl.innerHTML = '<div class="log">尚無記錄</div>'; ensureLoadMoreUI(); return; }
    let html=''; data.forEach(function(r){ html+=buildLogHtml(r); });
    const safe=sanitizeLogsHTML(html);
    if (isAppend) {
      if (logsEl.innerHTML.indexOf('載入中')!==-1 && logsEl.querySelectorAll('.log').length===1) logsEl.innerHTML=safe;
      else logsEl.insertAdjacentHTML('beforeend', safe);
    } else logsEl.innerHTML=safe;
    ensureLoadMoreUI();
  }).catch(function(err){
    console.error('Load logs error:', err);
    if (!isAppend) logsEl.innerHTML='<div class="log">載入失敗：'+escapeHtml(err.message||'後端連線失敗')+'</div>';
    else {
      const wrap=document.getElementById('logs-pagination');
      if(wrap) wrap.innerHTML='<span class="logs-pagination__error">載入失敗：'+escapeHtml(err.message||'後端連線失敗')+' <button id="retryLogsBtn" type="button" class="btn-accent">重試</button></span>';
      const rb=document.getElementById('retryLogsBtn'); if(rb) rb.addEventListener('click', function(){ loadLogs({append:true}); });
    }
  }).finally(function(){ loading=false; ensureLoadMoreUI(); });
}
export function resetLogs(){ currentTreeId=''; currentPrj=''; nextCursor=null; hasMore=true; loading=false; removePaginationUI(); const el=$('#logs'); if(el) el.innerHTML='<div class="log">載入中…</div>'; }
export function getLogsPagination(){ return {nextCursor:nextCursor, hasMore:hasMore, limit:PAGE_LIMIT, treeId:currentTreeId, prj:currentPrj}; }
