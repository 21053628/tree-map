import { Config } from '../../config.js';
const $ = function (s) { return document.querySelector(s); };

function getUploadLimits(){
  const up = Config.UPLOAD ? Config.UPLOAD : null;
  return {
    allowedMimes: (up && up.ALLOWED_MIMES) || ['image/jpeg','image/png','image/webp'],
    accept: (up && up.ACCEPT) || 'image/jpeg,image/png,image/webp',
    maxBytes: (up && up.MAX_BYTES) || 10*1024*1024,
    maxCount: (up && up.MAX_COUNT) || 10
  };
}
function isAllowedMime_(file, allowed){
  const mime = (file && file.type ? String(file.type).toLowerCase() : '');
  if (mime) return allowed.indexOf(mime) !== -1;
  // type 為空時用副檔名兜底（部分舊瀏覽器/剪貼簿）
  const name = file && file.name ? String(file.name).toLowerCase() : '';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return allowed.indexOf('image/jpeg') !== -1;
  if (name.endsWith('.png')) return allowed.indexOf('image/png') !== -1;
  if (name.endsWith('.webp')) return allowed.indexOf('image/webp') !== -1;
  return false;
}

export function initPhotoPreview() {
  const fileInput = $('#photo');
  if (!fileInput) return;

  const limits = getUploadLimits();
  // 限制選擇器僅顯示允許格式
  try { fileInput.accept = limits.accept; } catch(e) {}

  // 動態表單重新建立時，避免同一個 input 被重複綁定 change 事件。
  if (fileInput.dataset.photoPreviewBound === 'true') {
    try { fileInput.accept = limits.accept; } catch(e2) {}
    return;
  }
  fileInput.dataset.photoPreviewBound = 'true';

  fileInput.addEventListener('change', function (e) {
    const limits2 = getUploadLimits();
    const allFiles = Array.from(e.target.files || []).filter(function(f){ return !!f; });
    if (allFiles.length === 0) { fileInput.value=''; return; }

    const errs = [];
    const valid = [];
    for (let i=0;i<allFiles.length;i++){
      const f = allFiles[i];
      if (!isAllowedMime_(f, limits2.allowedMimes)){
        const t = f.type ? f.type : (f.name ? f.name.split('.').pop() : '未知');
        errs.push('「'+(f.name||'未命名')+'」格式不支援（'+t+'），僅支援 '+limits2.allowedMimes.join(', '));
        continue;
      }
      if (f.size > limits2.maxBytes){
        errs.push('「'+(f.name||'未命名')+'」過大（'+(f.size/1024/1024).toFixed(1)+'MB），上限 '+Math.round(limits2.maxBytes/1024/1024)+'MB');
        continue;
      }
      valid.push(f);
    }
    if (errs.length) alert('⚠️ 相片檢查：\n'+errs.join('\n'));

    const cur = (globalThis.TD && Array.isArray(globalThis.TD.selectedPhotos)) ? globalThis.TD.selectedPhotos.length : 0;
    if (cur + valid.length > limits2.maxCount){
      const remain = Math.max(0, limits2.maxCount - cur);
      alert('⚠️ 最多可選 '+limits2.maxCount+' 張（已選 '+cur+' 張，剩餘 '+remain+' 張）');
      valid.splice(remain);
    }
    for (let j=0;j<valid.length;j++) globalThis.TD.selectedPhotos.push(valid[j]);

    // 清空 value 令手機可以再次選取同一張相片。
    fileInput.value = '';
    updatePhotoPreview();
  });
}

export function updatePhotoPreview() {
  const previewContainer = $('#photoPreviewContainer');
  const previewGrid = $('#photoPreviewGrid');
  const photoCount = $('#photoCount');
  if (!previewContainer || !previewGrid || !photoCount) return;

  if (globalThis.TD.selectedPhotos.length === 0) {
    previewContainer.classList.add('is-hidden');
    return;
  }
  previewContainer.classList.remove('is-hidden');
  const lim = getUploadLimits();
  photoCount.textContent = globalThis.TD.selectedPhotos.length + ' / ' + lim.maxCount;
  // 達上限時禁用選擇器（UX 提示）
  const fileInput2 = $('#photo');
  if (fileInput2) {
    const atLimit = globalThis.TD.selectedPhotos.length >= lim.maxCount;
    fileInput2.disabled = atLimit;
    const picker = document.querySelector('label.photo-picker-btn[for="photo"]');
    if (picker) {
      picker.classList.toggle('picker--disabled', atLimit);
      picker.title = atLimit ? '已達上限 '+lim.maxCount+' 張，請先移除部分相片' : '';
    }
  }
  previewGrid.innerHTML = '';
  globalThis.TD.selectedPhotos.forEach(function (file, index) {
    const reader = new FileReader();
    reader.onload = function (e) {
      const item = document.createElement('div');
      item.className = 'photo-preview-item is-loading';

      const skeleton = document.createElement('div');
      skeleton.className = 'photo-preview-skeleton sk';
      skeleton.setAttribute('aria-hidden', 'true');

      const fallback = document.createElement('div');
      fallback.className = 'photo-preview-fallback';
      fallback.setAttribute('role', 'status');
      fallback.textContent = '圖片無法預覽';

      const removeBtn = document.createElement('button');
      removeBtn.className = 'photo-preview-remove';
      removeBtn.textContent = '×';
      removeBtn.title = '移除這張相片';
      removeBtn.onclick = function (event) {
        event.stopPropagation();
        removePhoto(index);
      };

      const img = document.createElement('img');
      img.className = 'photo-preview-thumb';
      img.loading = 'lazy';
      img.addEventListener('load', function () {
        item.classList.remove('is-loading', 'is-error');
      }, { once: true });
      img.addEventListener('error', function () {
        item.classList.remove('is-loading');
        item.classList.add('is-error');
      }, { once: true });

      item.appendChild(skeleton);
      item.appendChild(img);
      item.appendChild(fallback);
      item.appendChild(removeBtn);
      previewGrid.appendChild(item);
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export function removePhoto(index) {
  globalThis.TD.selectedPhotos.splice(index, 1);
  updatePhotoPreview();
}
