import {
  VALID_HEALTH,
  isValidHK80 as validateHK80,
  sanitizeHtml
} from '../../core/utils.js';

import { TD as tdState } from './route.js';
if (!Array.isArray(tdState.selectedPhotos)) tdState.selectedPhotos = [];
if (!Object.prototype.hasOwnProperty.call(tdState, 'TREE')) tdState.TREE = null;
if (!Object.prototype.hasOwnProperty.call(tdState, 'id')) tdState.id = '';
if (!Object.prototype.hasOwnProperty.call(tdState, 'prj')) tdState.prj = '';

export const COLORS = {
  Normal: '#2E7D32',
  Fair: '#7CB342',
  Poor: '#FFB300',
  'Very Poor': '#E53935',
  Dead: '#000000'
};
export const MAX_PHOTOS = 10;
export const MAX_PHOTO_CHARS = 15 * 1024 * 1024; // 與後端 LIMITS_.photo_base64_single 一致（壓縮後）
export const ALLOWED_IMAGE_MIMES = ['image/jpeg','image/png','image/webp'];
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function fmtTime(v) {
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(v);
  if (isNaN(d.getTime())) return s.slice(0, 10);
  const p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

export function convertGoogleDriveUrl(url, forDownload) {
  if (!url) return url;
  const str = String(url);
  const matchId = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    str.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchId && matchId[1]) {
    const fileId = matchId[1];
    if (forDownload) return 'https://drive.google.com/uc?export=download&id=' + fileId;
    return 'https://drive.google.com/uc?export=view&id=' + fileId;
  }
  return str;
}

export async function compress(file, maxW, q) {
  maxW = maxW || 1200;
  q = q || 0.8;
  return new Promise(function (resolve, reject) {
    const img = new Image();
    img.onload = function () {
      try {
        const s = Math.min(1, maxW / img.width);
        const c = document.createElement('canvas');
        c.width = img.width * s;
        c.height = img.height * s;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const dataUrl = c.toDataURL('image/jpeg', q);
        resolve(dataUrl.split(',')[1]);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = function () { reject(new Error('圖片載入失敗')); };
    img.src = URL.createObjectURL(file);
  });
}

export function isValidHealth(v) {
  return VALID_HEALTH.indexOf(v) !== -1;
}

export function isValidHK80(N, E) {
  return validateHK80(N, E);
}

export function sanitizeHTML(html) {
  return sanitizeHtml(html);
}

export function sanitizeLogsHTML(html) {
  return sanitizeHtml(html);
}