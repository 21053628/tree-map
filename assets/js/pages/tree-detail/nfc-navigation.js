export function initNfcNavigation() {
  const TD = globalThis.TD;
  globalThis.goBackToMap = function (e) {
    try {
      if (document.referrer && document.referrer.indexOf('index.html') !== -1 && history.length > 1) {
        e.preventDefault(); history.back(); return false;
      }
    } catch (err) {}
    return true;
  };
  globalThis.zoomImage = function (src, event) {
    if (event && event.stopPropagation) event.stopPropagation();
    const modal = document.getElementById('imgModal');
    const modalImg = document.getElementById('modalImg');
    if (!modal || !modalImg) return;
    modalImg.src = src; modal.classList.add('show');
    try { window.dispatchEvent(new CustomEvent('treemap:photozoom', { detail: { open: true } })); } catch (e) {}
  };
  globalThis.closeZoom = function () {
    const modal = document.getElementById('imgModal');
    if (modal) modal.classList.remove('show');
    try { window.dispatchEvent(new CustomEvent('treemap:photozoom', { detail: { open: false } })); } catch (e) {}
  };
  globalThis.downloadPhoto = function (url, treeId, timeStr, photoIndex) {
    if (url && url.indexOf('drive.google.com') !== -1) { window.open(url, '_blank'); return; }
    fetch(url, { mode: 'cors', credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(function (blob) {
        var link = document.createElement('a'); link.href = URL.createObjectURL(blob);
        var suffix = photoIndex ? '_' + photoIndex : '';
        link.download = 'inspection_' + treeId + '_' + timeStr.replace(/[: ]/g, '-') + suffix + '.jpg';
        link.click(); URL.revokeObjectURL(link.href);
      })
      .catch(function (err) { window.open(url, '_blank'); alert('⚠️ 自動下載失敗，已在新分頁開啟圖片，請手動右鍵保存。\n錯誤：' + err.message); });
  };
  globalThis.goNFC = function () {
    const treeUrl = location.origin + location.pathname + '?id=' + encodeURIComponent(TD.id) + '&prj=' + encodeURIComponent(TD.prj);
    const backUrl = location.href;
    location.href = 'nfc.html?url=' + encodeURIComponent(treeUrl) + '&back=' + encodeURIComponent(backUrl);
  };
}
