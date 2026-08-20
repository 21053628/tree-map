const $ = function (s) { return document.querySelector(s); };

export function initPhotoPreview() {
  const fileInput = $('#photo');
  if (!fileInput) return;

  // 動態表單重新建立時，避免同一個 input 被重複綁定 change 事件。
  if (fileInput.dataset.photoPreviewBound === 'true') return;
  fileInput.dataset.photoPreviewBound = 'true';

  fileInput.addEventListener('change', function (e) {
    const files = Array.from(e.target.files || [])
      .filter(function (file) {
        return file && (!file.type || file.type.indexOf('image/') === 0);
      });

    for (let i = 0; i < files.length; i++) {
      window.TD.selectedPhotos.push(files[i]);
    }

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

  if (window.TD.selectedPhotos.length === 0) {
    previewContainer.style.display = 'none';
    return;
  }
  previewContainer.style.display = 'block';
  photoCount.textContent = window.TD.selectedPhotos.length;
  previewGrid.innerHTML = '';
  window.TD.selectedPhotos.forEach(function (file, index) {
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
  window.TD.selectedPhotos.splice(index, 1);
  updatePhotoPreview();
}
