/**
 * 樹木管理系統 - 狀態過濾模組
 * v1.0.0-beta - 統一版本號（正式發佈前整合）
 * 歷史：v1.0 - 按 Tree Status 過濾樹木（多選 chips）
 */
import { state } from './state.js';
import { setStatusFilter, getStatusFilter } from './trees.js';

const STATUSES = ['Normal', 'Fair', 'Poor', 'Very Poor', 'Dead'];
let panelEl = null;
let btnEl = null;

function currentSet() {
  const f = getStatusFilter();
  return f ? new Set(f) : new Set(STATUSES);
}

function commit(set) {
  setStatusFilter(set.size === STATUSES.length ? null : set);
  renderChips();
  if (btnEl) btnEl.classList.toggle('on', !!getStatusFilter());
}

function renderChips() {
  if (!panelEl) return;
  const f = getStatusFilter();
  panelEl.querySelectorAll('.filter-chip').forEach((ch) => {
    const s = ch.dataset.s;
    if (s === '__all') ch.classList.toggle('on', !f);
    else ch.classList.toggle('on', f ? f.has(s) : true);
  });
}

export function closeFilterPanel() {
  if (panelEl) { panelEl.remove(); panelEl = null; }
}

function positionPanel() {
  if (!panelEl || !btnEl) return;
  const r = btnEl.getBoundingClientRect();
  if (window.innerWidth <= 600) {
    panelEl.classList.add('filter-panel--mobile');
    panelEl.style.removeProperty('top');
    panelEl.style.removeProperty('right');
  } else {
    panelEl.classList.remove('filter-panel--mobile');
    panelEl.style.top = (r.bottom + 8) + 'px';
    panelEl.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    panelEl.style.left = 'auto';
    panelEl.style.bottom = 'auto';
  }
}

export function toggleFilterPanel(btn) {
  btnEl = btn || btnEl;
  if (panelEl) { closeFilterPanel(); return; }

  panelEl = document.createElement('div');
  panelEl.className = 'filter-panel';
  const C = Config.TREE_STATUS_COLORS;
  // 🔥 [XSS 加固] 顏色值限定為合法 hex，避免 Config 被污染時注入 HTML
  const safeColor = (c) => (/^#[0-9a-fA-F]{3,8}$/.test(String(c || ''))) ? String(c) : '#757575';

  let html = '<div class="filter-title">過濾樹木狀態</div>';
  html += '<button class="filter-chip all" data-s="__all" data-c="#1565c0">全部</button>';
  STATUSES.forEach((s) => {
    html += '<button class="filter-chip" data-s="' + s + '" data-c="' + safeColor(C[s]) + '"><span class="fc-dot"></span>' + s + '</button>';
  });
  panelEl.innerHTML = html;
  document.body.appendChild(panelEl);
  panelEl.querySelectorAll('.filter-chip').forEach(function(ch){ if(ch.dataset.c) ch.style.setProperty('--c', ch.dataset.c); });
  renderChips();
  positionPanel();

  panelEl.addEventListener('click', (e) => e.stopPropagation());

  panelEl.querySelectorAll('.filter-chip').forEach((ch) => {
    ch.onclick = function () {
      const s = ch.dataset.s;
      if (s === '__all') { commit(new Set(STATUSES)); return; }
      const set = currentSet();
      if (set.has(s)) set.delete(s); else set.add(s);
      commit(set);
    };
  });
}
