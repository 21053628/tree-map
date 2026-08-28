import { toHK80Async } from '../../core/coordinates.js';
import { ApiService } from '../../api.js';
import { escapeHtml, format1, format5 } from '../../core/utils.js';
import * as TDUtils from './td-utils.js';
import { goBackToMap, goNFC, zoomImage, closeZoom } from './nfc-navigation.js';
import { TD } from './route.js';
const $ = function (s) { return document.querySelector(s); };
let delegated = false;
const f1 = format1; const f5 = format5;
const toHK = toHK80Async;
export function setupImageLoadingStates(root) {
  if (!root) return;
  root.querySelectorAll('.image-shell').forEach(function (shell) {
    const img = shell.querySelector('img'); if (!img) return;
    function markLoaded() { shell.classList.remove('is-loading', 'is-error'); }
    function markError() { shell.classList.remove('is-loading'); shell.classList.add('is-error'); }
    img.addEventListener('load', markLoaded, { once: true });
    img.addEventListener('error', markError, { once: true });
    if (img.complete) { if (img.naturalWidth > 0) markLoaded(); else markError(); }
  });
}
export async function render(t) {
  const hkPromise = toHK(t.lat, t.lng);
  var html = '<a class="back" id="backBtn" href="index.html?tree_id=' + encodeURIComponent(t.tree_id) + '&project_id=' + encodeURIComponent(t.project_id || '') + '&lat=' + encodeURIComponent(t.lat) + '&lng=' + encodeURIComponent(t.lng) + '">⬅ 地圖</a>' +
    '<div class="tree-tabs" role="tablist" aria-label="樹木資料分頁">' +
    '<button type="button" class="tree-tab" id="overviewTab" role="tab" aria-selected="true" aria-controls="overviewPanel" tabindex="0">📋 樹木概覽</button>' +
    '<button type="button" class="tree-tab" id="inspectionTab" role="tab" aria-selected="false" aria-controls="inspectionPanel" tabindex="-1">📝 巡查簽到</button>' +
    '<button type="button" class="tree-tab" id="editTab" role="tab" aria-selected="false" aria-controls="editPanel" tabindex="-1">✏️ 編輯資產</button>' +
    '</div>' +
    '<section class="tab-panel" id="overviewPanel" role="tabpanel" aria-labelledby="overviewTab">' +
    '<div class="card">' +
    '<h1>' + escapeHtml(t.tree_id) + ' ' + escapeHtml(t.name) + '</h1>' +
    '<div class="mt-8"><span class="badge badge--status" data-status="' + escapeHtml(t.status) + '">Status: ' + escapeHtml(t.status) + '</span></div>';
  if (t.project_id) html += '<div class="mt-6"><span class="badge badge--status badge-project">🚩 地盤：<b>' + escapeHtml(t.project_id) + '</b></span> <span class="nfc-hint">(NFC 用)</span></div>';
  var mainPhotos = t.photo_url;
  if (mainPhotos) {
    if (typeof mainPhotos === 'string' && mainPhotos.indexOf('...') !== -1) mainPhotos = null;
    else if (typeof mainPhotos === 'string') mainPhotos = [mainPhotos];
  }
  if (mainPhotos && mainPhotos.length > 0) {
    for (var i = 0; i < mainPhotos.length; i++) {
      const isLCP = (i === 0);
      const loadingAttr = isLCP ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
      html += '<div class="image-shell is-loading"><div class="image-skeleton sk" aria-hidden="true"></div><img class="tree zoomable-img" src="' + escapeHtml(mainPhotos[i]) + '" alt="' + escapeHtml(t.name) + '" ' + loadingAttr + ' decoding="async" crossorigin="anonymous" referrerpolicy="no-referrer"><div class="image-fallback" role="status">圖片暫時無法載入</div></div>';
    }
  }
  html += '<div class="grid">' +
    '<div>Tree Height<b class="numeric">' + (t.tree_height || t.height || '-') + ' m</b></div>' +
    '<div>Crown Width<b class="numeric">' + (t.crown_width || t.spread || '-') + ' m</b></div>' +
    '<div>DBH<b class="numeric">' + (t.dbh || '-') + ' m</b></div>' +
    '<div>Ground Dia.<b class="numeric">' + (t.ground_diameter || '-') + ' m</b></div>' +
    '<div>Stem Length<b class="numeric">' + (t.stem_length || '-') + ' m</b></div>' +
    '<div>Crown Area<b class="numeric">' + (t.crown_area || '-') + ' ㎡</b></div>' +
    '<div>Crown Vol.<b class="numeric">' + (t.crown_volume || '-') + ' m³</b></div>' +
    '</div>' +
    '<div class="sub mt-8">' + escapeHtml(t.description || '') + '</div>' +
    '<div class="sub mt-6">📍 <b>HK80：</b>N <span id="hk80N" class="numeric">—</span> ／ E <span id="hk80E" class="numeric">—</span> ｜ <b>Level：</b><span class="numeric">' + (t.level || '-') + '</span> m</div>' +
    '<div class="sub">WGS84：<span class="numeric">' + f5(t.lat) + ', ' + f5(t.lng) + '</span></div><div id="minimap"></div>' +
    '</div><div class="card"><button class="btn-accent" id="goNfcBtn">📱 一鍵寫入 NFC tag</button></div>' +
    '<div class="card"><b>📋 巡查歷史</b><div id="logs"><div class="log">載入中…</div></div></div>' +
    '</section><section class="tab-panel" id="inspectionPanel" role="tabpanel" aria-labelledby="inspectionTab" hidden><div class="card" id="inspectionContent"><div class="staff-placeholder">需要工作人員驗證才能使用巡查簽到</div></div></section>' +
    '<section class="tab-panel" id="editPanel" role="tabpanel" aria-labelledby="editTab" hidden><div class="card" id="editContent"><div class="staff-placeholder">需要工作人員驗證才能編輯樹木資料</div></div></section>' +
    '<div id="imgModal" class="modal"><span class="modal-close">&times;</span><img id="modalImg" src="" alt="放大圖片" crossorigin="anonymous" referrerpolicy="no-referrer"></div>';
  $('#app').innerHTML = TDUtils.sanitizeHTML(html);
  setupImageLoadingStates($('#app'));
  // 🔥 [CSP 修復] 內聯 style= 會被 style-src 封鎖，改用 CSSOM 設定 --badge-bg（不受 CSP 管轄）
  try {
    $('#app').querySelectorAll('.badge--status[data-status]').forEach(function (el) {
      const c = TDUtils.COLORS[el.dataset.status] || '#757575';
      el.style.setProperty('--badge-bg', c);
    });
  } catch (e) { /* intentionally ignored: optional fallback failure */ }
  const backBtn = document.getElementById('backBtn');
  if (backBtn) backBtn.addEventListener('click', goBackToMap);
  const goNfcBtn = document.getElementById('goNfcBtn');
  if (goNfcBtn) goNfcBtn.addEventListener('click', goNFC);
  if (!delegated) {
    delegated = true;
    document.addEventListener('keydown', function (e) { if (e.key !== 'Escape') return; var modal = document.getElementById('imgModal'); if (modal && modal.classList.contains('show') && closeZoom) closeZoom(); });
    $('#app').addEventListener('click', function (e) {
      const zoomImg = (e.target && e.target.closest) ? e.target.closest('.zoomable-img') : null;
      if (zoomImg) { e.stopPropagation(); zoomImage(zoomImg.src); return; }
      const modal = document.getElementById('imgModal');
      if (modal && modal.classList.contains('show')) { if (e.target === modal || (e.target.classList && e.target.classList.contains('modal-close'))) { closeZoom(); } }
    });
  }
  const hk = await hkPromise;
  if (hk) {
    const elN = document.getElementById('hk80N'); const elE = document.getElementById('hk80E');
    if (elN) elN.textContent = f1(hk.N); if (elE) elE.textContent = f1(hk.E);
  }
}
export function renderError(message) {
  const app = document.querySelector('#app');
  if (!app) return;
  const card = document.createElement('div');
  card.className = 'card error';
  card.textContent = String(message == null ? '' : message);
  app.replaceChildren(card);
}
export function initMiniMap(t) {
  const lat = +t.lat, lng = +t.lng; if (!lat || !lng) return;
  let retries = 0;
  function tryInit() {
    if (!window.L) { if (retries < 50) { retries++; setTimeout(tryInit, 100); } return; }
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      const minimapEl = document.getElementById('minimap'); if (!minimapEl) return;
      if (minimapEl.offsetWidth === 0 || minimapEl.offsetHeight === 0) { setTimeout(function () { tryInit(); }, 150); return; }
      const mm = L.map('minimap', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false }).setView([lat, lng], 18);
      L.tileLayer('https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/wgs84/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mm);
      L.tileLayer('https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/label/hk/tc/wgs84/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mm);
      L.circleMarker([lat, lng], { color: '#fff', weight: 2, radius: 9, fillColor: (TDUtils.COLORS[t.status] || '#757575'), fillOpacity: .9 }).addTo(mm);

      // NFC 直接開啟 t.html 時沒有主地圖的 state；按樹木所屬地盤獨立載入地盤範圍。
      const projectId = String(t.project_id || TD.prj || '').trim();
      if (projectId) {
        ApiService.get('boundaries', { project: projectId })
          .then(function (res) {
            const geometry = res && res.data && res.data.geometry;
            if (!geometry || !document.getElementById('minimap')) return;
            const boundaryLayer = L.geoJSON(geometry, {
              color: '#d32f2f', weight: 3, opacity: 0.95,
              fillColor: '#ef5350', fillOpacity: 0.14,
              interactive: false
            }).addTo(mm);
            const bounds = boundaryLayer.getBounds();
            if (bounds.isValid()) mm.fitBounds(bounds, { padding: [12, 12], maxZoom: 18 });
          })
          .catch(function (error) {
            // 地盤範圍是附加資料；失敗時仍保留樹木位置地圖。
            console.warn('[tree-detail] boundary load failed', error);
          });
      }
      mm.invalidateSize();
    }); });
  }
  tryInit();
}
