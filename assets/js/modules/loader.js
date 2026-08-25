/**
 * 資料載入服務（依 project / viewport 按需載入）
 * - 啟動僅載 projects；tree 按 pid 懶載
 * - 支援 viewport bbox（由 map.js 按需呼叫）
 * - 保持 bootstrap 兼容（舊快照 'main' 自動遷移）
 */
import { state } from './state.js';
import { updateStatus } from './dom.js';
import { hideSearch, buildTokenSearchIndex } from './search.js';
import { drawTrees } from './trees.js';
import { drawProjects, buildSelect } from './projects.js';
import { buildAllSpatialIndexes } from '../core/spatial-index.js';
import { Config } from '../config.js';
import { ApiService } from '../api.js';
import { TreeSnapshot } from '../../../offline.js';

function normalizeTree(t){
  const n = Object.assign({}, t);
  if (typeof n.lat === 'string') n.lat = +n.lat;
  if (typeof n.lng === 'string') n.lng = +n.lng;
  n._color = (Config.TREE_STATUS_COLORS) ? (Config.TREE_STATUS_COLORS[n.status] || Config.TREE_STATUS_COLORS.Unknown) : '#757575';
  return n;
}
function snapKeyForProject(pid){ return 'trees:' + String(pid); }
const SNAP_PROJECTS = 'projects';

export function applyData(projects, trees) {
  applyProjects(projects, { render: false });
  state.TREES = [];
  state.treeCountMap.clear();
  state.treeMap.clear();
  state.treeSearchIndex.clear();
  if (state.treeTokenIndex) state.treeTokenIndex.clear();
  state.treeLowerIndex.clear();
  state.treeIdIndex.clear();
  if (trees && trees.length) {
    state.TREES = trees.map(normalizeTree);
    rebuildAllIndexes();
  } else {
    buildTokenSearchIndex();
    buildAllSpatialIndexes();
  }
  state.projectMarkersCache = null;
  state.treesCache.clear();
  state.coordGroupsCache = null;
  buildSelect();
  hideSearch();
  drawProjects();
  drawTrees();
}
export function applyProjects(projects, opts){
  opts = opts || {};
  state.PROJECTS = Array.isArray(projects) ? projects.slice() : [];
  if (opts.render !== false){
    state.projectMarkersCache = null;
    buildSelect();
    drawProjects();
  }
}
function normalizePid(pid){ return String(pid||'').trim(); }
function hasBypass_(){ try{ var u=new URLSearchParams(location.search); return u.get('nocache')==='1' || u.get('bust')==='1'; }catch(e){ return false; } }
function bypassOpts_(){ return hasBypass_() ? {nocache:'1'} : {}; }
let _bootstrapFallbackCache = { data: null, ts: 0 };
export function bustBootstrapCache(){ _bootstrapFallbackCache={data:null,ts:0}; }
function isNoCacheOpts_(opts){ try{ return String((opts&&opts.nocache)||'').trim()==='1' || hasBypass_(); }catch(e){ return false; } }
/**
 * 保守合併兩份樹木列表：以 tree_id 為 key，incoming 嘅欄位值覆蓋 existing，
 * 但 existing 有而 incoming 冇嘅樹木保留（避免 bootstrap 快取較舊時意外刪除本地較新資料）。
 * @returns {{ list: Array, changed: boolean }}
 */
// 🔥 [v2.5] 已廢棄：reconcileFromBootstrap_ 改用伺服器真源取代，不再使用 merge 邏輯
// 保留函數定義以防外部或舊版程式碼引用，但 reconcile 已不再呼叫。
function mergeTreeLists_(existing, incoming) {
  // 🔥 [Bugfix] key 以 project_id + '_' + tree_id 組成，避免跨地盤同 tree_id 互相覆蓋（防禦性；目前呼叫方已按地盤分組）
  var map = new Map();
  function keyOf(t) { return String(t.project_id || '') + '_' + String(t.tree_id || ''); }
  for (var i = 0; i < existing.length; i++) {
    var k = keyOf(existing[i]);
    if (String(existing[i].tree_id || '')) map.set(k, existing[i]);
  }
  var incomingCount = 0;
  for (var j = 0; j < incoming.length; j++) {
    var k2 = keyOf(incoming[j]);
    if (String(incoming[j].tree_id || '')) {
      map.set(k2, incoming[j]); // incoming 覆蓋 existing（server 為真源）
      incomingCount++;
    }
  }
  var merged = Array.from(map.values());
  var changed = merged.length !== existing.length || incomingCount > 0;
  return { list: merged, changed: changed };
}
function reconcileFromBootstrap_(bt, opts){
  opts = opts || {};
  // 🔥 [v2.5] forceEmptyApply：由 fresh revalidate (nocache:1) 呼叫時先設為 true，
  // 容許伺服器明確回空列表時清空本地資料（全部樹木被刪除的情況）。
  var forceEmptyApply = opts.forceEmptyApply === true || hasBypass_();
  if(!Array.isArray(bt)) return 0;
  var byPid=new Map();
  for(var i=0;i<bt.length;i++){
    var pid=normalizePid(bt[i].project_id);
    if(!pid) continue;
    if(!byPid.has(pid)) byPid.set(pid,[]);
    byPid.get(pid).push(bt[i]);
  }
  var changed=0;
  for(var j=0;j<state.PROJECTS.length;j++){
    var pid2=normalizePid(state.PROJECTS[j].project_id);
    if(!pid2) continue;
    var incoming=byPid.get(pid2)||[];
    var existing=state.treeSearchIndex.get(pid2)||[];
    // 🔥 [v2.5 修復] 伺服器為真源：有返到列表就直接取代，唔再保守合併。
    // 保守合併 (mergeTreeLists_) 會保留 existing 有而 incoming 冇嘅樹木，
    // 導致已刪樹木從快照/本地快取中復活，永遠唔會消失。
    if(incoming.length>0){
      // 快速比對 key set：完全相同就跳過，避免無謂重繪
      if(existing.length===incoming.length){
        var existingKeys=new Set();
        for(var e=0;e<existing.length;e++) existingKeys.add(String(existing[e].tree_id||''));
        var allMatch=true;
        for(var f=0;f<incoming.length;f++){ if(!existingKeys.has(String(incoming[f].tree_id||''))){ allMatch=false; break; } }
        if(allMatch) continue;
      }
      applyTreesForProject(pid2, incoming, {saveSnapshot:true, authoritative:true});
      changed++;
    } else if(existing.length>0 && forceEmptyApply){
      // fresh 伺服器回應明確回空列表 → 直接清空（全部樹木已刪）
      applyTreesForProject(pid2, incoming, {saveSnapshot:true, authoritative:true});
      var after=(state.treeSearchIndex.get(pid2)||[]).length;
      if(after!==existing.length) changed++;
    }
    // incoming 空且 !forceEmptyApply → 保留本地（避免快取/表頭問題誤清）
  }
  if(changed){
    if(state.isLocating){
      try{console.warn('[loader] reconcile deferred isLocating',changed);}catch(e){}
      setTimeout(function(){ try{ drawProjects(); drawTrees(); }catch(e){} }, 2600);
    } else {
      drawProjects(); drawTrees();
    }
  }
  return changed;
}
function rebuildAllIndexes(){
  state.treeCountMap.clear();
  state.treeMap.clear();
  state.treeLowerIndex.clear();
  state.treeIdIndex.clear();
  for (let i = 0; i < state.TREES.length; i++){
    const t = state.TREES[i];
    if(t.project_id!==undefined && t.project_id!==null) t.project_id = String(t.project_id).trim();
    if(t.tree_id!==undefined && t.tree_id!==null) t.tree_id = String(t.tree_id).trim();
    const pid = normalizePid(t.project_id);
    const tid = String(t.tree_id||'');
    if(!tid) continue;
    state.treeCountMap.set(pid, (state.treeCountMap.get(pid) || 0) + 1);
    state.treeMap.set(pid + '_' + tid, t);
    state.treeLowerIndex.set(pid.toLowerCase() + '_' + tid.toLowerCase(), t);
    if (!state.treeIdIndex.has(tid.toLowerCase())) state.treeIdIndex.set(tid.toLowerCase(), t);
  }
  buildTokenSearchIndex();
  buildAllSpatialIndexes();
}
export function applyTreesForProject(pid, trees, opts){
  opts = opts || {};
  const appendViewport = !!opts.appendViewport;
  pid = normalizePid(pid);
  if (!pid) return;
  const incoming = Array.isArray(trees) ? trees.map(normalizeTree) : [];
  // 🛡️ 空陣列保護：後端回 0 但本地/快照已有該地盤數據時，不覆蓋並保留舊快照
  // 🔥 [v2.5 修復] bypass（nocache=1/bust=1）或 authoritative（伺服器真源回應）時允許清空，
  // 適用於全部樹木被刪除的情況，避免已刪樹木永遠顯示。
  if (!appendViewport && incoming.length===0) {
    const existing = state.treeSearchIndex.get(pid) || [];
    const bypassing = hasBypass_() || opts.authoritative === true;
    if (existing.length>0 && !bypassing) {
      console.warn('[loader] backend returned 0 for '+pid+', keep '+existing.length+' cached trees (header/cache suspected)');
      updateStatus('⚠️ 後端回 0 棵，已保留本地 '+existing.length+' 棵｜請檢查 GAS 表頭/快取後重刷');
      return;
    }
    // 若本地原本就有則已 return；若本地原本 0 則允許覆蓋為 0 並提示
    if (state.treeCountMap.has(pid) || state.treeSearchIndex.has(pid)) {
      console.warn('[loader] backend 0 for '+pid+', no local cache to keep');
    }
  }
  if (!appendViewport) {
    const keep = [];
    for (let i = 0; i < state.TREES.length; i++) if (normalizePid(state.TREES[i].project_id) !== pid) keep.push(state.TREES[i]);
    state.TREES = keep.concat(incoming);
  } else {
    const map = new Map();
    for (let i = 0; i < state.TREES.length; i++) map.set(normalizePid(state.TREES[i].project_id) + '_' + String(state.TREES[i].tree_id), state.TREES[i]);
    for (let i = 0; i < incoming.length; i++) map.set(pid + '_' + String(incoming[i].tree_id), incoming[i]);
    state.TREES = Array.from(map.values());

    // 🔥 [Bugfix] 防止視口增量載入無限累積：當該地盤累積樹數超過上限時，強制全量重載
    const MAX_VIEWPORT_TREES = 5000;
    const pidCount = state.TREES.filter(function(t){ return normalizePid(t.project_id) === pid; }).length;
    if (pidCount > MAX_VIEWPORT_TREES) {
      console.warn('[loader] viewport accumulated ' + pidCount + ' trees for ' + pid + ' (max ' + MAX_VIEWPORT_TREES + '), triggering full reload');
      // 非同步重載，唔阻礙當前 UI 更新
      setTimeout(function(){ loadTreesForProject(pid, { nocache: '1' }).catch(function(){}); }, 0);
    }
  }
  rebuildAllIndexes();
  // 🔥 [v2.5 修復] authoritative 清空時都要 save snapshot，避免下次 reload 再讀到舊快照
  if (opts.saveSnapshot !== false && TreeSnapshot && !appendViewport) {
    if (incoming.length>0 || opts.authoritative === true) {
      TreeSnapshot.save(snapKeyForProject(pid), incoming).catch(function(){});
    }
  }
  if (!appendViewport) { state.treesCache.clear(); state.coordGroupsCache = null; }
  hideSearch(); drawTrees(); drawProjects();
}
const _loadingPid = new Map();
export async function loadTreesForProject(pid, opts){
  pid = normalizePid(pid); if (!pid) return [];
  opts = opts || {};
  if (_loadingPid.get(pid)) return _loadingPid.get(pid);
  const p = (async function(){
    if(hasBypass_()) opts.nocache='1';
    updateStatus('⏳ 載入地盤樹木…');
    try{
      let res;
      if (opts.bbox || (opts.south != null)) {
        if (typeof ApiService.getTreesByProject === 'function') res = await ApiService.getTreesByProject(pid, opts);
        else res = await ApiService.get('trees', Object.assign({ project: pid }, opts));
      } else {
        if (typeof ApiService.getTreesByProject === 'function') res = await ApiService.getTreesByProject(pid, opts);
        else res = await ApiService.get('trees', { project: pid });
      }
      if (res && (res.offline || res.stale)) throw new Error('STALE_CACHE');
      let trees = (res && res.data) ? res.data : (Array.isArray(res) ? res : []);
      if (!opts.appendViewport && (!trees || trees.length===0)) {
        try {
          var bt = null;
          if (!isNoCacheOpts_(opts) && _bootstrapFallbackCache.data && Date.now() - _bootstrapFallbackCache.ts < 30000) {
            bt = _bootstrapFallbackCache.data;
          } else {
            var b = await ApiService.get('bootstrap', {nocache:'1'});
            bt = (b && b.data && b.data.trees) ? b.data.trees : (Array.isArray(b && b.data) ? b.data : []);
            if (Array.isArray(bt)) _bootstrapFallbackCache = { data: bt, ts: Date.now() };
          }
          if (Array.isArray(bt) && bt.length) {
            var wantLower = pid.toLowerCase();
            var filt = bt.filter(function(x){ return String(x.project_id||'').trim().toLowerCase()===wantLower; });
            if (filt.length) { try{ console.warn('[loader] bootstrap fallback hit '+filt.length+' for '+pid); }catch(e){} trees = filt; }
          }
        } catch(_e) {}
      }
      applyTreesForProject(pid, trees, { merge:true, appendViewport: !!opts.appendViewport, saveSnapshot: !opts.appendViewport, authoritative: true });
      updateStatus('✅ 已載入 ' + trees.length + ' 棵樹');
      return trees;
    } catch(e){
      console.warn('[loadTreesForProject] failed', pid, e);
      if (!opts.appendViewport && TreeSnapshot) {
        try{
          const snap = await TreeSnapshot.load(snapKeyForProject(pid));
          if (Array.isArray(snap) && snap.length){
            applyTreesForProject(pid, snap, { merge:true, saveSnapshot:false });
            updateStatus('📴 顯示本地快取（' + snap.length + ' 棵）');
            return snap;
          }
        }catch(_){}
      }
      updateStatus('⚠️ 載入樹木失敗：' + (e && e.message ? e.message : e));
      throw e;
    } finally { _loadingPid.delete(pid); }
  })();
  _loadingPid.set(pid, p); return p;
}
export async function loadProjects(opts){
  opts = opts || {};
  if (TreeSnapshot) {
    try{
      let snap = await TreeSnapshot.load(SNAP_PROJECTS);
      if (!snap && !opts.skipLegacy) {
        const legacy = await TreeSnapshot.load('main');
        if (legacy && Array.isArray(legacy.projects) && legacy.projects.length) snap = legacy.projects;
      }
      if (Array.isArray(snap) && snap.length){ applyProjects(snap, { render:true }); if (opts.snapshotOnly) return snap; }
    }catch(e){}
  }
  let lastErr = null;
  for (let attempt=0; attempt<3; attempt++){
    try{
      let _bp = bypassOpts_(); let res; if (typeof ApiService.getProjects === 'function') res = await ApiService.getProjects(_bp); else res = await ApiService.get('projects', _bp);
      if (res && (res.offline || res.stale)) throw new Error('STALE_CACHE');
      const projects = (res && res.data) ? res.data : (Array.isArray(res) ? res : []);
      if (!projects.length) throw new Error('EMPTY_RESPONSE');
      applyProjects(projects, { render:true });
      if (TreeSnapshot) TreeSnapshot.save(SNAP_PROJECTS, projects).catch(function(){});
      return projects;
    }catch(e){
      lastErr = e;
      if (e && e.message === 'STALE_CACHE') { await new Promise(function(r){ setTimeout(r, 1200); }); continue; }
      if (attempt < 2) await new Promise(function(r){ setTimeout(r, 800); });
    }
  }
  throw lastErr || new Error('PROJECTS_LOAD_FAILED');
}
// 依 project/viewport 的新 load：僅拉 projects，tree 懶載
// 會遷移舊 'main' 快照為分區快照
async function migrateLegacyMain(){
  if (!TreeSnapshot) return;
  try{
    const legacy = await TreeSnapshot.load('main');
    if (!legacy || !Array.isArray(legacy.trees) || !legacy.trees.length) return;
    const byPid = new Map();
    for (const t of legacy.trees){ const pid=String(t.project_id||''); if(!byPid.has(pid)) byPid.set(pid,[]); byPid.get(pid).push(t); }
    for (const [pid, arr] of byPid){ await TreeSnapshot.save(snapKeyForProject(pid), arr).catch(function(){}); }
  }catch(e){}
}
export async function load(){
  updateStatus('🗺️ 載入中…');
  // 🔥 提前暖機 GAS（與快照讀取並行），降低冷啟動導致 projects 超時風險
  try { if (typeof globalThis.warmGAS === 'function') globalThis.warmGAS(); } catch (e) {}
  let hasLocal = false;
  // 1) projects 快照 → 立即渲染地盤
  try{
    if (TreeSnapshot){
      const snap = await TreeSnapshot.load(SNAP_PROJECTS);
      if (Array.isArray(snap) && snap.length){ applyProjects(snap,{render:true}); hasLocal=true; }
      else {
        const legacy = await TreeSnapshot.load('main');
        if (legacy && Array.isArray(legacy.projects) && legacy.projects.length){ applyProjects(legacy.projects,{render:true}); hasLocal=true; }
      }
    }
  }catch(e){}
  // 背景遷移舊 main
  migrateLegacyMain().catch(function(){});
  // 嘗試從已有的 per-project 快照預熱當前地盤（若 URL 帶 project_id 或已有 curProject）
  const urlPid = new URLSearchParams(location.search).get('project_id') || new URLSearchParams(location.search).get('prj') || '';
  const preloadPid = urlPid || state.curProject || '';
  if(hasBypass_() && TreeSnapshot){ try{ await TreeSnapshot.delete(SNAP_PROJECTS); }catch(e){} if(preloadPid){ try{ await TreeSnapshot.delete(snapKeyForProject(preloadPid)); }catch(e){} } }
  if (preloadPid && TreeSnapshot){
    try{
      const snap = await TreeSnapshot.load(snapKeyForProject(preloadPid));
      if (Array.isArray(snap) && snap.length){ applyTreesForProject(preloadPid, snap, { saveSnapshot:false }); hasLocal=true; }
    }catch(e){}
  }
  // 2) 遠端拉 projects（帶重試）
  try{
    await loadProjects({ skipLegacy:true });
    updateStatus('✅ 地盤已更新');
    // 快照秒開 + bootstrap 對帳（快且準，刪樹亦即時）
    if (TreeSnapshot && Array.isArray(state.PROJECTS) && state.PROJECTS.length) {
      (async function hydrateFast(){
        try{
          var jobs=state.PROJECTS.map(function(pp){ var pid=normalizePid(pp.project_id); if(!pid||state.treeSearchIndex.has(pid)) return null; return TreeSnapshot.load(snapKeyForProject(pid)).then(function(snap){ if(Array.isArray(snap)&&snap.length) applyTreesForProject(pid, snap, {saveSnapshot:false}); }).catch(function(){}); });
          await Promise.all(jobs.filter(Boolean));
          drawProjects();
        }catch(_){ drawProjects(); }
      })();
    } else { drawProjects(); }
    if (preloadPid) loadTreesForProject(preloadPid).catch(function(){});
    (async function warmAndReconcile(){
      try{
        var bt=null;
        if(_bootstrapFallbackCache.data && Date.now()-_bootstrapFallbackCache.ts<30000) bt=_bootstrapFallbackCache.data;
        else { try{ var b=await ApiService.get('bootstrap', hasBypass_()?{nocache:'1'}:{}); bt=(b&&b.data&&b.data.trees)?b.data.trees:[]; if(Array.isArray(bt)) _bootstrapFallbackCache={data:bt, ts:Date.now()}; }catch(e){ bt=null; } }
        if(Array.isArray(bt)) { var ch=reconcileFromBootstrap_(bt); try{ console.warn('[loader] warm counts pids='+(new Set(bt.map(function(x){return normalizePid(x.project_id);}))).size+' ch='+ch); }catch(e){} }
        if(!hasBypass_()){
          // 🔥 [Bugfix] 重試上限 8 次，防止 isLocating 永鎖時無限遞迴消耗 GAS quota
          (function scheduleRevalidate(attempt){ attempt = attempt || 0; var _d=1200; try{ _d=(typeof state!=='undefined' && state.isLocating)?2600:1200; }catch(e){}
            if(attempt > 8){ return; }
            setTimeout(async function(){ try{ if(typeof state!=='undefined' && state.isLocating){ scheduleRevalidate(attempt+1); return; } }catch(e){}
              try{ var bf=await ApiService.get('bootstrap', {nocache:'1'}); var btf=(bf&&bf.data&&bf.data.trees)?bf.data.trees:[]; _bootstrapFallbackCache={data:btf, ts:Date.now()}; var ch2=reconcileFromBootstrap_(btf, {forceEmptyApply:true}); try{ console.warn('[loader] revalidate changed='+ch2+' total='+btf.length); }catch(e){} }catch(e){}
            }, _d);
          })(0);
        }
      }catch(e){ console.warn('[loader] warm failed', e); }
    })();
    return;
  }catch(e){
    console.warn('[load] projects failed', e);
    if (hasLocal){ updateStatus('📴 顯示本地地盤快取'); return; }
    // 最後防線：嘗試 bootstrap 兼容（舊後端或首次部署）
    try{
      const res = await ApiService.get('bootstrap', bypassOpts_());
      if (res && res.data && (res.data.projects || res.data.trees)){
        const projects = res.data.projects || [];
        const trees = res.data.trees || [];
        applyData(projects, trees);
        if (TreeSnapshot){
          TreeSnapshot.save(SNAP_PROJECTS, projects).catch(function(){});
          const byPid=new Map(); for(const t of trees){ const pid=String(t.project_id||''); if(!byPid.has(pid)) byPid.set(pid,[]); byPid.get(pid).push(t); }
          for(const [pid,arr] of byPid) TreeSnapshot.save(snapKeyForProject(pid), arr).catch(function(){});
        }
        updateStatus('✅ 資料已載入（兼容模式）');
        return;
      }
    }catch(_){}
    updateStatus('❌ 載入失敗：' + (e && e.message ? e.message : e));
  }
}
