import { sanitizeId } from '../../core/utils.js';

export const TD = { selectedPhotos: [], TREE: null, id: '', prj: '' };
if (!Array.isArray(TD.selectedPhotos)) TD.selectedPhotos = [];
if (!Object.prototype.hasOwnProperty.call(TD, 'TREE')) TD.TREE = null;
if (!Object.prototype.hasOwnProperty.call(TD, 'id')) TD.id = '';
if (!Object.prototype.hasOwnProperty.call(TD, 'prj')) TD.prj = '';

/**
 * 解析 URL 上的樹木路由參數並寫入共享 TD module state
 * 支援 id/tree_id 與 prj/project_id 兩套參數名
 */
export function initRoute() {
  const params = new URLSearchParams(location.search);
  TD.id = sanitizeId(params.get('id') || params.get('tree_id') || '');
  TD.prj = sanitizeId(params.get('prj') || params.get('project_id') || '');
  if (TD.TREE === undefined) TD.TREE = null;
  return TD;
}

export function getRoute() {
  return { id: TD.id, prj: TD.prj, TREE: TD.TREE };
}

export function setTree(tree) {
  TD.TREE = tree;
}

export function updateUrlOnRename(newId) {
  if (!newId || newId === TD.id) return;
  try {
    const url = new URL(location.href);
    url.searchParams.set('id', newId);
    if (TD.prj) url.searchParams.set('prj', TD.prj);
    history.replaceState(null, '', url.toString());
    TD.id = newId;
  } catch (e) {
    // ignore
  }
}

export default TD;
