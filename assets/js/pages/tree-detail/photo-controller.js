import * as TDPhotos from './td-photos.js';
export const initPhotoPreview = TDPhotos.initPhotoPreview;
export const updatePhotoPreview = TDPhotos.updatePhotoPreview;
export const removePhoto = TDPhotos.removePhoto;
export function getSelectedPhotos() { return globalThis.TD ? globalThis.TD.selectedPhotos : []; }
export function clearSelectedPhotos() { if (globalThis.TD) globalThis.TD.selectedPhotos = []; }
