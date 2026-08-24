/**
 * 搜尋功能模組 — Token 倒排索引版
 * v1.0.0-beta - 統一版本號（正式發佈前整合）
 * 歷史：v3.0 - Token 倒排索引；v2.46 - Debounce 150ms
 */
import { state } from './state.js';
import { DOM, escapeHtml } from './dom.js';
import { search as searchSpecies } from './species.js';

let _searchTimer = null; // 🔥 [v2.46] Debounce 計時器

export function normalizeText(text) {
  return String(text || '').toLowerCase().normalize('NFKC').trim();
}
export function tokenize(text) {
  const s = normalizeText(text);
  if (!s) return [];
  // 🔥 [Bugfix] 支援 CJK 統一表意文字（U+4E00-9FFF）+ 擴展 A（U+3400-4DBF）+ 兼容表意文字（U+F900-FAFF）
  const raw = s.match(/[a-z0-9]+|[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+/g) || [];
  const out = []; const seen = new Set();
  function add(tok) { if (!tok || seen.has(tok)) return; seen.add(tok); out.push(tok); }
  for (const seg of raw) {
    if (/^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+$/.test(seg)) {
      add(seg);
      if (seg.length >= 2) {
        for (let i = 0; i < seg.length - 1; i++) add(seg.slice(i, i + 2));
        if (seg.length <= 4) { for (let i = 0; i < seg.length; i++) add(seg[i]); }
      }
    } else { add(seg); }
  }
  return out;
}
function tokensForTree(t) {
  const parts = [];
  if (t.tree_id) parts.push(String(t.tree_id));
  if (t.name) parts.push(String(t.name).replace(/[()（）]/g, ' '));
  if (t.status) parts.push(String(t.status));
  if (t.risk) parts.push(String(t.risk));
  if (t.description) parts.push(String(t.description).slice(0, 120).replace(/[()（）]/g, ' '));
  return tokenize(parts.join(' '));
}
const MAX_RESULTS = 30;
const MAX_PREFIX_SCAN = 300;
export function buildSearchIndex() { buildTokenSearchIndex(); }
export function buildTokenSearchIndex() {
  state.treeSearchIndex.clear();
  if (state.treeTokenIndex) state.treeTokenIndex.clear();
  else state.treeTokenIndex = new Map();
  const searchIdx = state.treeSearchIndex;
  const tokenIdx = state.treeTokenIndex;
  for (let i = 0; i < state.TREES.length; i++) {
    const t = state.TREES[i];
    const pid = String(t.project_id || '');
    let arr = searchIdx.get(pid);
    if (!arr) { arr = []; searchIdx.set(pid, arr); }
    arr.push(t);
    let tokenMap = tokenIdx.get(pid);
    if (!tokenMap) { tokenMap = new Map(); tokenIdx.set(pid, tokenMap); }
    const tokens = tokensForTree(t);
    t._tokens = tokens;
    t._tokensSet = new Set(tokens);
    t._searchLower = normalizeText(String(t.tree_id || '') + ' ' + String(t.name || ''));
    for (const tok of t._tokensSet) {
      let set = tokenMap.get(tok);
      if (!set) { set = new Set(); tokenMap.set(tok, set); }
      set.add(t);
    }
  }
  try {
    let totalTokens = 0; tokenIdx.forEach((m) => { totalTokens += m.size; });
    console.log('[TokenIndex] 建成: ' + state.TREES.length + ' 棵, ' + tokenIdx.size + ' 個地盤, 去重 token 約 ' + totalTokens);
  } catch (e) {}
}
export function clearTokenIndex(pid) {
  if (pid) { state.treeTokenIndex.delete(String(pid)); state.treeSearchIndex.delete(String(pid)); }
  else { state.treeTokenIndex.clear(); state.treeSearchIndex.clear(); }
}
function collectForQueryToken(tokenMap, qTok) {
  const union = new Set();
  const exact = tokenMap.get(qTok);
  if (exact) exact.forEach((v) => union.add(v));
  let scanned = 0;
  for (const [key, set] of tokenMap) {
    if (scanned >= MAX_PREFIX_SCAN) break;
    if (key === qTok) continue;
    if (key.length > qTok.length && key.startsWith(qTok)) { scanned++; set.forEach((v) => union.add(v)); }
  }
  return union;
}
function scoreTree(t, qTokens) {
  let score = 0;
  const tidLower = normalizeText(t.tree_id);
  const nameLower = normalizeText(t.name || '');
  const statusLower = normalizeText(t.status || '');
  for (const q of qTokens) {
    if (!q) continue;
    if (tidLower === q) score += 30;
    else if (tidLower.startsWith(q)) score += 18;
    else if (tidLower.includes(q)) score += 12;
    if (nameLower === q) score += 15;
    else if (nameLower.includes(q)) score += 8;
    if (statusLower === q) score += 6;
    else if (statusLower.includes(q)) score += 3;
    if (t._tokensSet && t._tokensSet.has(q)) score += 5;
    const d = normalizeText(t.description || '');
    if (d && d.includes(q)) score += 1;
  }
  return score;
}
/**
 * 擴展查詢 token：以物種名稱補全查詢（例如輸入「榕」可同時匹配「榕樹」「細葉榕」等）
 * 使用 species.js 的物種搜尋，找出匹配物種並將其完整 token 加入查詢。
 * @param {string[]} tokens - 原始查詢 tokens
 * @returns {string[]} 擴展後的 tokens（去重，保留原順序）
 */
function expandWithSpecies(tokens) {
  if (!tokens || !tokens.length) return tokens;
  const query = tokens.join(' ');
  let speciesList = [];
  try {
    speciesList = searchSpecies(query, { limit: 5 }) || [];
  } catch (e) {
    // species 尚未載入或搜尋失敗時，退回原始 tokens
    return tokens;
  }
  if (!speciesList.length) return tokens;
  const expanded = new Set();
  for (const tok of tokens) expanded.add(tok);
  for (const sp of speciesList) {
    if (sp && Array.isArray(sp._tokens)) {
      for (const tok of sp._tokens) expanded.add(tok);
    }
  }
  return Array.from(expanded);
}

export function searchWithTokens(query, options) {
  const opts = options || {}; const pid = String(opts.projectId || state.curProject || '');
  const limit = opts.limit || MAX_RESULTS;
  let qTokens = tokenize(query);
  qTokens = expandWithSpecies(qTokens);
  if (!qTokens.length || !pid) return [];
  const tokenMap = state.treeTokenIndex.get(pid);
  if (!tokenMap || tokenMap.size === 0) {
    const arr = state.treeSearchIndex.get(pid) || [];
    const qLower = normalizeText(query); const res = [];
    for (let i = 0; i < arr.length && res.length < limit; i++) {
      const t = arr[i];
      if ((t._searchLower && t._searchLower.includes(qLower)) || String(t.tree_id).toLowerCase().includes(qLower) || String(t.name || '').toLowerCase().includes(qLower)) res.push(t);
    }
    return res;
  }
  const perTokenSets = qTokens.map((qt) => collectForQueryToken(tokenMap, qt));
  const nonEmpty = perTokenSets.filter((s) => s.size > 0);
  if (nonEmpty.length === 0) return [];
  nonEmpty.sort((a, b) => a.size - b.size);
  let candidates = new Set(nonEmpty[0]);
  for (let i = 1; i < nonEmpty.length; i++) {
    const cur = nonEmpty[i];
    for (const v of Array.from(candidates)) { if (!cur.has(v)) candidates.delete(v); }
    if (candidates.size === 0) break;
  }
  if (candidates.size === 0) { candidates = new Set(); for (const s of nonEmpty) s.forEach((v) => candidates.add(v)); }
  const scored = [];
  for (const t of candidates) { const s = scoreTree(t, qTokens); if (s > 0) scored.push({ t, s }); }
  scored.sort((a, b) => b.s - a.s);
  const out = [];
  for (let i = 0; i < scored.length && out.length < limit; i++) out.push(scored[i].t);
  if (out.length === 0 && candidates.size > 0) { let c = 0; for (const v of candidates) { out.push(v); if (++c >= limit) break; } }
  return out;
}
export function getTokenIndexStats() {
  const stats = { projects: state.treeTokenIndex.size, totalTrees: state.TREES.length, perProject: {} };
  state.treeTokenIndex.forEach((map, pid) => { let postingTotal = 0; map.forEach((set) => { postingTotal += set.size; }); stats.perProject[pid] = { distinctTokens: map.size, postings: postingTotal }; });
  return stats;
}

export function handleSearch(query) {
  if (_searchTimer) clearTimeout(_searchTimer);
  _searchTimer = setTimeout(() => {
    const box = DOM.searchResults;
    if (!box) return;
    const raw = String(query || '').trim();
    if (!state.curProject) {
      box.innerHTML = '<div class="sr-item sr-hint">👉 請先選擇地盤才能搜尋</div>';
      box.classList.add('is-visible');
      return;
    }
    if (!raw) { hideSearch(); return; }
    const results = searchWithTokens(raw, { projectId: state.curProject, limit: MAX_RESULTS });
    if (!results.length) {
      box.innerHTML = '<div class="sr-item sr-hint">🤷 找不到「' + escapeHtml(raw) + '」</div>';
      box.classList.add('is-visible');
      return;
    }
    box.innerHTML = results.map((t) => {
      const color = (typeof Config !== 'undefined' && Config.TREE_STATUS_COLORS) ? (Config.TREE_STATUS_COLORS[t.status] || Config.TREE_STATUS_COLORS.Unknown) : '#757575';
      return '<div class="sr-item" data-id="' + escapeHtml(t.tree_id) + '">' +
        '<span class="sr-dot" data-c="' + color + '"></span>' +
        '<span class="sr-id">' + escapeHtml(t.tree_id) + '</span>' +
        '<span class="sr-name">' + escapeHtml(t.name || '') + '</span>' +
        '</div>';
    }).join('');
    box.querySelectorAll('.sr-dot').forEach(function(el){ if(el.dataset.c) el.style.background = el.dataset.c; });
    box.classList.add('is-visible');
  }, 150);
}

export function hideSearch() {
  // 🔥 [v2.46] 隱藏時順便清除計時器
  if (_searchTimer) {
    clearTimeout(_searchTimer);
    _searchTimer = null;
  }
  const box = DOM.searchResults;
  if (box) { box.classList.remove('is-visible'); box.innerHTML = ''; }
}