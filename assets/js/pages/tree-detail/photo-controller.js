import * as TDPhotos from './td-photos.js';
import { TD } from './route.js';
export const initPhotoPreview = TDPhotos.initPhotoPreview;
export const updatePhotoPreview = TDPhotos.updatePhotoPreview;
export const removePhoto = TDPhotos.removePhoto;
export function getSelectedPhotos() { return TD.selectedPhotos; }
export function clearSelectedPhotos() { TD.selectedPhotos = []; }
