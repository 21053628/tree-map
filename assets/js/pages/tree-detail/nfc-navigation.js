import { TD } from './route.js';

function isSafePhotoUrl_(value) {
  try {
    const url = new URL(String(value || ''), location.href);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'drive.google.com' || host === 'drive.usercontent.google.com'
      || host === 'lh3.googleusercontent.com' || host.endsWith('.googleusercontent.com');
  } catch (e) {
    return false;
  }
}

function openPhotoFallback_(url) {
  if (!isSafePhotoUrl_(url)) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

export function goBackToMap(e) {
  try {
    if (document.referrer && document.referrer.indexOf('index.html') !== -1 && history.length > 1) {
      e.preventDefault(); history.back(); return false;
    }
  } catch (err) { /* intentionally ignored: optional fallback failure */ }
  return true;
}

export function zoomImage(src, event) {
  if (event && event.stopPropagation) event.stopPropagation();
  const modal = document.getElementById('imgModal');
  const modalImg = document.getElementById('modalImg');
  if (!modal || !modalImg) return;
  modalImg.src = src; modal.classList.add('show');
  try { window.dispatchEvent(new CustomEvent('treemap:photozoom', { detail: { open: true } })); } catch (e) { /* intentionally ignored: optional fallback failure */ }
}

export function closeZoom() {
  const modal = document.getElementById('imgModal');
  if (modal) modal.classList.remove('show');
  try { window.dispatchEvent(new CustomEvent('treemap:photozoom', { detail: { open: false } })); } catch (e) { /* intentionally ignored: optional fallback failure */ }
}

export function downloadPhoto(url, treeId, timeStr, photoIndex) {
  if (!isSafePhotoUrl_(url)) {
    alert('⚠️ 圖片網址不受信任，已阻止下載。');
    return;
  }
  if (openPhotoFallback_(url)) return;
  fetch(url, { mode: 'cors', credentials: 'omit' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
    .then(function (blob) {
      var link = document.createElement('a'); link.href = URL.createObjectURL(blob);
      var suffix = photoIndex ? '_' + photoIndex : '';
      link.download = 'inspection_' + treeId + '_' + timeStr.replace(/[: ]/g, '-') + suffix + '.jpg';
      link.click(); URL.revokeObjectURL(link.href);
    })
    .catch(function (err) {
      if (openPhotoFallback_(url)) {
        alert('⚠️ 自動下載失敗，已在新分頁開啟圖片，請手動右鍵保存。\n錯誤：' + err.message);
      } else {
        alert('⚠️ 自動下載失敗，圖片網址不受信任，未開啟外部頁面。');
      }
    });
}

export function goNFC() {
  const treeUrl = location.origin + location.pathname + '?id=' + encodeURIComponent(TD.id) + '&prj=' + encodeURIComponent(TD.prj);
  const backUrl = location.href;
  location.href = 'nfc.html?url=' + encodeURIComponent(treeUrl) + '&back=' + encodeURIComponent(backUrl);
}
