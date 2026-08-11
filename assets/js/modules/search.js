/**
 * 搜尋功能模組
 */
import { state } from './state.js';
import { DOM, escapeHtml } from './dom.js';

export function buildSearchIndex() {
  state.treeSearchIndex.clear();
  state.TREES.forEach((t) => {
    const pid = String(t.project_id || '');
    if (!state.treeSearchIndex.has(pid)) {
      state.treeSearchIndex.set(pid, []);
    }
    state.treeSearchIndex.get(pid).push(t);
  });
}

export function handleSearch(query) {
  const box = DOM.searchResults;
  if (!box) return;
  const q = String(query || '').trim().toLowerCase();

  if (!state.curProject) {
    box.innerHTML = '<div class="sr-item sr-hint">👉 請先選擇地盤先可以搜尋</div>';
    box.style.display = 'block';
    return;
  }
  if (!q) { hideSearch(); return; }

  const projectTrees = state.treeSearchIndex.get(state.curProject) || [];
  const results = [];

  for (let i = 0, len = projectTrees.length; i < len && results.length < 30; i++) {
    const t = projectTrees[i];
    const idMatch = String(t.tree_id).toLowerCase().indexOf(q) !== -1;
    const nameMatch = String(t.name || '').toLowerCase().indexOf(q) !== -1;
    if (idMatch || nameMatch) results.push(t);
  }

  if (!results.length) {
    box.innerHTML = '<div class="sr-item sr-hint">🤷 唔到「' + escapeHtml(query) + '」</div>';
    box.style.display = 'block';
    return;
  }

  box.innerHTML = results.map((t) => {
    const color = Config.TREE_STATUS_COLORS[t.status] || Config.TREE_STATUS_COLORS.Unknown;
    return '<div class="sr-item" data-id="' + escapeHtml(t.tree_id) + '">' +
      '<span class="sr-dot" style="background:' + color + '"></span>' +
      '<span class="sr-id">' + escapeHtml(t.tree_id) + '</span>' +
      '<span class="sr-name">' + escapeHtml(t.name || '') + '</span>' +
      '</div>';
  }).join('');
  box.style.display = 'block';
}

export function hideSearch() {
  const box = DOM.searchResults;
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}