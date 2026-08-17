/**
 * 搜尋功能模組
 * v2.46 - 加入 Debounce 優化，減少手機打字時的 CPU 空轉
 */
import { state } from './state.js';
import { DOM, escapeHtml } from './dom.js';

let _searchTimer = null; // 🔥 [v2.46] Debounce 計時器

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
  // 🔥 [v2.46 性能優化] Debounce：停止打字 150ms 才觸發搜尋
  if (_searchTimer) clearTimeout(_searchTimer);
  
  _searchTimer = setTimeout(() => {
    const box = DOM.searchResults;
    if (!box) return;
    const q = String(query || '').trim().toLowerCase();

    if (!state.curProject) {
      box.innerHTML = '<div class="sr-item sr-hint">👉 請先選擇地盤才能搜尋</div>';
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
      box.innerHTML = '<div class="sr-item sr-hint">🤷 找不到「' + escapeHtml(query) + '」</div>';
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
  }, 150); // 150ms 延遲
}

export function hideSearch() {
  // 🔥 [v2.46] 隱藏時順便清除計時器
  if (_searchTimer) {
    clearTimeout(_searchTimer);
    _searchTimer = null;
  }
  const box = DOM.searchResults;
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}