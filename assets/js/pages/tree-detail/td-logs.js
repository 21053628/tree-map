import { escapeHtml } from '../../core/utils.js';
import {
  fmtTime,
  convertGoogleDriveUrl,
  sanitizeLogsHTML
} from './td-utils.js';

const API = (typeof Config !== 'undefined' && Config.API_ENDPOINT)
  ? Config.API_ENDPOINT
  : '';
const $ = function (s) { return document.querySelector(s); };

let logsDelegated = false;

// [Phase7] 巡查相片用事件委派（不再用 inline onclick/onerror）
export function attachLogsDelegation() {
  if (logsDelegated) return;
  const logs = $('#logs');
  if (!logs) return;
  logsDelegated = true;

  logs.addEventListener('click', function (e) {
    const img = (e.target && e.target.closest)
      ? e.target.closest('.inspection-photo-thumb')
      : null;
    if (img) {
      e.stopPropagation();
      const src = img.getAttribute('data-zoom');
      if (src && window.zoomImage) window.zoomImage(src);
      return;
    }
    const btn = (e.target && e.target.closest)
      ? e.target.closest('.inspection-photo-btn')
      : null;
    if (btn) {
      e.stopPropagation();
      const url = btn.getAttribute('data-download');
      const tree = btn.getAttribute('data-tree');
      const time = btn.getAttribute('data-time');
      const idx = parseInt(btn.getAttribute('data-index') || '1', 10);
      if (window.downloadPhoto) window.downloadPhoto(url, tree, time, idx);
    }
  });

  // error 事件不會冒泡，用 capture 攔截圖片載入失敗
  logs.addEventListener('error', function (e) {
    const img = e.target;
    if (img && img.classList && img.classList.contains('inspection-photo-thumb') &&
        img.parentElement) {
      img.parentElement.style.display = 'none';
    }
  }, true);
}

export function loadLogs() {
  attachLogsDelegation();
  fetch(API + '?action=inspections&id=' + encodeURIComponent(window.TD.id) +
    '&prj=' + encodeURIComponent(window.TD.prj))
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res && res.error === 'OFFLINE') {
        $('#logs').innerHTML = '<div class="log">📴 離線模式：暫無巡查記錄快取</div>';
        return;
      }
      const data = res.data || [];
      if (!data.length) {
        $('#logs').innerHTML = '<div class="log">尚無記錄</div>';
        return;
      }
      let html = '';
      data.reverse().forEach(function (r) {
        let photoHtml = '';
        let photos = r.photo_urls || r.photo_url;
        if (!photos) {
          photos = [];
        } else if (typeof photos === 'string') {
          if (photos.indexOf('[') !== -1 && photos.indexOf(']') !== -1) {
            try {
              photos = JSON.parse(photos);
            } catch (e) {
              photos = photos.replace(/^\[|\]$/g, '');
            }
          }
          if (typeof photos === 'string' && photos.indexOf(',') !== -1) {
            photos = photos.split(',').map(function (url) { return url.trim(); });
          } else if (typeof photos === 'string') {
            photos = [photos];
          }
        }
        if (!Array.isArray(photos)) photos = [];
        photos = photos.filter(function (p) { return p && String(p).trim() !== ''; });

        if (photos.length > 0) {
          const timeStr = fmtTime(r.time);
          const treeIdEscaped = escapeHtml(r.tree_id || window.TD.id);
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
            photoHtml += '<div class="inspection-photo-item"><img class="inspection-photo-thumb" src="' +
              displayUrlEscaped + '" data-zoom="' + displayUrlEscaped +
              '" loading="lazy" decoding="async" crossorigin="anonymous" referrerpolicy="no-referrer" ' +
              'title="點擊放大"><button class="inspection-photo-btn" data-download="' +
              downloadUrlEscaped + '" data-tree="' + treeIdEscaped + '" data-time="' +
              timeStrForDownload + '" data-index="' + photoIndex + '">⬇️ #' + photoIndex +
              '</button></div>';
          }
          photoHtml += '</div>';
        }
        html += '<div class="log"><span class="ok">' + escapeHtml(r.health) + '</span>｜' +
          escapeHtml(r.staff) + '｜' + fmtTime(r.time) + '<br>' +
          escapeHtml(r.note || '') + photoHtml + '</div>';
      });
      $('#logs').innerHTML = sanitizeLogsHTML(html);
    })
    .catch(function (err) {
      console.error('Load logs error:', err);
      $('#logs').innerHTML = '<div class="log">載入失敗</div>';
    });
}
