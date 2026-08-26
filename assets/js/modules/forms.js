/**
 * 表單模組：建立地盤與樹木
 * v1.0.0-beta - 統一版本號（正式發佈前整合）
 * 歷史：v5.0 - doCreateTree 改用新欄位名 + 補齊新增欄位
 */
import { state } from './state.js';
import { $, showPanel, closePanel, updateStatus, escapeHtml, showToast, formFieldError } from './dom.js';
import { SpeciesRepository, loadTreeSpecies, fillSpeciesDatalist } from './species.js';
import { bringTreeToFront } from './trees.js';
import { startPick } from './draw.js'; // 🔥 [Phase1]
import { load, loadProjects, loadTreesForProject, bustBootstrapCache, applyTreesForProject } from './loader.js'; // 依 project 按需載入
import { VALID_HEALTH, isValidHK80 } from '../core/utils.js';
import { ApiService } from '../api.js';
import { ErrorCodes } from '../core/error-codes.js';
import { CacheManager } from '../core/cache-manager.js';
import { toWGS84, toHK80, format1 } from '../core/coordinates.js';
import { ProgressBar } from '../ui-progress.js';

// ========== [Phase4] 提交前驗證 ==========

let _promptAuth = null;

export function setPromptAuth(fn) { _promptAuth = fn; }

export async function openProjectForm() {
  const authResult = _promptAuth();
  if (authResult instanceof Promise) { if (!await authResult) return; }
  else { if (!authResult) return; }

  showPanel(
    '<b>＋ 建立地盤</b>' +
    '<input id="pName" placeholder="地盤名稱（e.g. 泥涌）">' +
    '<input id="pCustomId" placeholder="自訂英文 ID（NFC 用，e.g. NaiChung）">' +
    '<div class="form-hint">💡 此 ID 會寫入 NFC tag，建議用簡短英文</div>' +
    '<div class="row2"><input id="pN" placeholder="HK80 N" inputmode="decimal"><input id="pE" placeholder="HK80 E" inputmode="decimal"></div>' +
    '<button id="btnCreateProject">💾 建立</button>' +
    '<button class="x" id="btnCloseProject">✖ 關閉</button>'
  );
  document.getElementById('btnCreateProject').addEventListener('click', doCreateProject);
  document.getElementById('btnCloseProject').addEventListener('click', closePanel);
}

export async function doCreateProject() {
  const name = $('#pName').value;
  const customId = $('#pCustomId').value;
  const N = $('#pN').value;
  const E = $('#pE').value;

  // [Phase13] inline validation 取代 alert
  if (!name || !N || !E) {
    if (!name) formFieldError('#pName', '請填寫地盤名稱');
    if (!N) formFieldError('#pN', '請輸入 HK80 N');
    if (!E) formFieldError('#pE', '請輸入 HK80 E');
    showToast('請填寫完整', 'warning');
    return;
  }

  if (!isValidHK80(N, E)) {
    formFieldError('#pN', '請輸入香港範圍內的 HK80 N/E 座標');
    formFieldError('#pE');
    showToast('⚠️ HK80 位置錯誤', 'warning');
    return;
  }

  const w = toWGS84(N, E);
  if (!w) {
    formFieldError('#pN', '座標轉換失敗');
    formFieldError('#pE');
    showToast('HK80 座標轉換失敗', 'error');
    return;
  }

  try {
    ProgressBar.showModal();
    ProgressBar.setMessage('正在建立地盤...');
    const meta = ApiService.newClientMeta();
    const r = await ApiService.post({
      type: 'create_project',
      client_id: meta.client_id,
      client_created_at: meta.client_created_at,
      name: name,
      custom_id: customId,
      lat: w.lat.toFixed(6),
      lng: w.lng.toFixed(6)
    });

    if (r.ok) {
      ProgressBar.hideModal();
      showToast('✅ 地盤已建立！ID: ' + r.project_id, 'success', 4000);
      closePanel();
      state.projectMarkersCache = null;
      state.treesCache.clear();
      state.spatialIndexCache = null;
      state.coordGroupsCache = null;
      if (ApiService.clearCache) try{ ApiService.clearCache(); }catch(e){ /* intentionally ignored: optional fallback failure */ }
      try { await loadProjects(); } catch(e){ await load(); }
    } else {
      ProgressBar.hideModal();
      showToast('❌ ' + ErrorCodes.messageForResponse(r, r.error), 'error');
    }
  } catch (error) { ProgressBar.hideModal(); showToast('❌ 請求失敗：' + error.message, 'error'); }
}

export async function openTreeForm(preset) {
  if (!state.curProject) { showToast('請先選擇地盤', 'warning'); return; }

  const authResult = _promptAuth();
  if (authResult instanceof Promise) { if (!await authResult) return; }
  else { if (!authResult) return; }

  // 🔥 [手機版修復] preset 支援填返上次輸入嘅欄位值（揀完位置後唔會清空表單）
  const val = function (id) {
    return (preset && preset[id] != null) ? escapeHtml(String(preset[id])) : '';
  };
  const statusOptions = ['Normal', 'Fair', 'Poor', 'Very Poor', 'Dead'].map(function (s) {
    return '<option' + ((preset && preset.tStatus === s) ? ' selected' : '') + '>' + s + '</option>';
  }).join('');

  showPanel(
    '<b>🌳 新增樹木</b>' +
    '<button class="pick-loc-btn" id="btnPickLocation">📍 在地圖按位置（自動填 N/E）</button>' +
    '<input id="tId" placeholder="樹木編號（留空＝該地盤最大編號＋1）" value="' + val('tId') + '">' +
    '<input id="tName" list="tree_datalist" placeholder="選擇樹種（輸入關鍵字搜尋）..." value="' + val('tName') + '">' +
    '<datalist id="tree_datalist"></datalist>' +
    '<select id="tStatus">' + statusOptions + '</select>' +
    '<div class="row2"><input id="tHeight" placeholder="Tree Height (m)" inputmode="decimal" value="' + val('tHeight') + '"><input id="tSpread" placeholder="Crown Width (m)" inputmode="decimal" value="' + val('tSpread') + '"></div>' +
    '<div class="row2"><input id="tDbh" placeholder="DBH (m)" inputmode="decimal" value="' + val('tDbh') + '"><input id="tGroundDia" placeholder="Ground Dia. (m)" inputmode="decimal" value="' + val('tGroundDia') + '"></div>' +
    '<div class="row2"><input id="tStemLen" placeholder="Stem Length (m)" inputmode="decimal" value="' + val('tStemLen') + '"><input id="tCrownArea" placeholder="Crown Area (㎡)" inputmode="decimal" value="' + val('tCrownArea') + '"></div>' +
    '<input id="tCrownVol" placeholder="Crown Volume (m³)" inputmode="decimal" value="' + val('tCrownVol') + '">' +
    '<div class="row2"><input id="tN" placeholder="HK80 N" inputmode="decimal" value="' + val('N') + '"><input id="tE" placeholder="HK80 E" inputmode="decimal" value="' + val('E') + '"></div>' +
    '<input id="tLevel" placeholder="Level (m)" inputmode="decimal" value="' + val('tLevel') + '">' +
    '<button id="btnCreateTree">💾 建立樹木</button>' +
    '<button class="x" id="btnCloseTree">✖ 關閉</button>'
  );

  document.getElementById('btnPickLocation').addEventListener('click', pickTreeLocation);
  document.getElementById('btnCreateTree').addEventListener('click', doCreateTree);
  document.getElementById('btnCloseTree').addEventListener('click', closePanel);

  SpeciesRepository.load().then(function(){ SpeciesRepository.fillDatalist(); }).catch(function(){ loadTreeSpecies().then(fillSpeciesDatalist); });
}

// 🔥 [手機版修復] 快照而家表單內容，揀完位置後自動填返（唔會清空）
function snapshotTreeForm_() {
  const ids = ['tId', 'tName', 'tStatus', 'tHeight', 'tSpread', 'tDbh', 'tGroundDia', 'tStemLen', 'tCrownArea', 'tCrownVol', 'tLevel'];
  const snap = {};
  ids.forEach(function (id) {
    const el = document.getElementById(id);
    if (el) snap[id] = el.value;
  });
  return snap;
}

export function pickTreeLocation() {
  if (!state.curProject) { showToast('請先選擇地盤', 'warning'); return; }
  const snap = snapshotTreeForm_();
  const panelEl = document.getElementById('panel');
  // 🔥 [手機版修復] 暫時關閉 slide 動畫，避免「關→開」閃跳；0.9s 後自動恢復
  if (panelEl) panelEl.classList.add('no-anim');
  setTimeout(function () { if (panelEl) panelEl.classList.remove('no-anim'); }, 900);
  closePanel();
  startPick(function (latlng) {
    const hk = toHK80(latlng.lat, latlng.lng);
    if (!hk) { showToast('HK80 座標轉換失敗', 'error'); return; }
    openTreeForm(Object.assign({}, snap, { N: format1(hk.N), E: format1(hk.E) }));
  }, '📍 按一下選擇樹木位置');
}

export async function doCreateTree() {
  // 🔥 [Phase8] 即時檢查：同地盤樹木編號唔可重複
  const inputId = $('#tId').value.trim();
  if (inputId) {
    const dup = state.TREES.some((t) =>
      String(t.tree_id).trim() === inputId &&
      String(t.project_id) === String(state.curProject));
    if (dup) {
      formFieldError('#tId', '樹木編號 ' + inputId + ' 已存在於此地盤');
      showToast('⚠️ 樹木編號重複', 'warning');
      return;
    }
  }

  const N = $('#tN').value;
  const E = $('#tE').value;

  if (!N || !E) {
    if (!N) formFieldError('#tN', '請輸入 HK80 N');
    if (!E) formFieldError('#tE', '請輸入 HK80 E');
    showToast('請填寫 HK80 座標 N/E', 'warning');
    return;
  }

  if (!isValidHK80(N, E)) {
    formFieldError('#tN', '請輸入香港範圍內的 HK80 N/E 座標');
    formFieldError('#tE');
    showToast('⚠️ HK80 位置錯誤', 'warning');
    return;
  }
  if (VALID_HEALTH.indexOf($('#tStatus').value) === -1) {
    formFieldError('#tStatus', '樹木狀態不合法');
    showToast('樹木狀態不合法：' + $('#tStatus').value, 'warning');
    return;
  }

  const w = toWGS84(N, E);
  if (!w) {
    formFieldError('#tN', '座標轉換失敗');
    formFieldError('#tE');
    showToast('HK80 座標轉換失敗', 'error');
    return;
  }

  try {
    // 🔥 [v5.0] 改用新欄位名 + 補齊新增欄位；[Phase2] 加 client_id/client_created_at
    ProgressBar.showModal();
    ProgressBar.setMessage('正在建立樹木...');
    const meta = ApiService.newClientMeta();
    const r = await ApiService.post({
      type: 'create_tree',
      client_id: meta.client_id,
      client_created_at: meta.client_created_at,
      tree_id: $('#tId').value, project_id: state.curProject,
      name: $('#tName').value, status: $('#tStatus').value,
      tree_height: $('#tHeight').value,
      crown_width: $('#tSpread').value,
      dbh: $('#tDbh').value,
      ground_diameter: $('#tGroundDia').value,
      stem_length: $('#tStemLen').value,
      crown_area: $('#tCrownArea').value,
      crown_volume: $('#tCrownVol').value,
      level: $('#tLevel').value,
      lat: w.lat.toFixed(6), lng: w.lng.toFixed(6)
    });

    if (r.ok) {
      ProgressBar.hideModal();
      showToast('✅ 樹木 ' + r.tree_id + ' 已建立', 'success', 4000);
      closePanel();
      state.treesCache.clear();
      state.spatialIndexCache = null;
      state.coordGroupsCache = null;
      try{ bustBootstrapCache(); }catch(e){ /* intentionally ignored: optional fallback failure */ }
      if (ApiService.clearCache) try{ ApiService.clearCache(state.curProject); }catch(e){ /* intentionally ignored: optional fallback failure */ }
      try{ if (CacheManager.notifySwInvalidate) CacheManager.notifySwInvalidate('create_tree', {project_id: state.curProject}); }catch(e){ /* intentionally ignored: optional fallback failure */ }
      for(let attempt=0; attempt<2; attempt++){
        try{ await loadTreesForProject(state.curProject, {nocache:'1'}); break; }catch(e){ if(attempt===0) await new Promise(function(rr){ setTimeout(rr, 900); }); else try{ await load(); }catch(_2){ /* intentionally ignored: optional fallback failure */ } }
      }

      const newId = String(r.tree_id);
      let _nt0 = state.treeMap.get(state.curProject + '_' + newId) || state.TREES.find(function(tt){ return String(tt.tree_id)===newId && String(tt.project_id)===String(state.curProject); });
      if(!_nt0){
        try{
          // 🔥 [Bugfix] 用表單實際值取代硬編碼 name='New tree' / status='Normal'
          const _realName = (document.getElementById('tName') && document.getElementById('tName').value) || '';
          const _realStatus = (document.getElementById('tStatus') && document.getElementById('tStatus').value) || 'Normal';
          const _realHeight = (document.getElementById('tHeight') && document.getElementById('tHeight').value) || '';
          const _realSpread = (document.getElementById('tSpread') && document.getElementById('tSpread').value) || '';
          const _realDbh = (document.getElementById('tDbh') && document.getElementById('tDbh').value) || '';
          const _optTree = {
            tree_id: newId, project_id: String(state.curProject),
            name: _realName || 'New tree',
            status: _realStatus,
            lat: w ? +w.lat.toFixed(6) : 0, lng: w ? +w.lng.toFixed(6) : 0,
            tree_height: _realHeight, crown_width: _realSpread, dbh: _realDbh
          };
          const _curIdx = state.treeSearchIndex.get(String(state.curProject)) || [];
          if(!_curIdx.some(function(x){ return String(x.tree_id)===newId; })){ applyTreesForProject(String(state.curProject), _curIdx.concat([_optTree]), {saveSnapshot:true}); console.warn('[forms] optimistic insert '+newId); }
        }catch(e){ console.warn('[forms] optimistic failed', e); }
      }
      const nt = state.treeMap.get(state.curProject + '_' + newId) ||
        state.TREES.find((t) => String(t.tree_id) === newId && String(t.project_id) === state.curProject);

      if (nt) {
        setTimeout(function () {
          state.map.flyTo([+nt.lat, +nt.lng], Math.max(state.map.getZoom(), 18), { duration: 0.8 });

          setTimeout(function () {
            const m = state.treesCache.get(state.curProject + '_' + newId);
            if (m) {
              state.treesCache.forEach((otherM) => { bringTreeToFront(otherM); });
              bringTreeToFront(m);
              m.openPopup();
            }
            updateStatus('✅ 已定位到新樹木：' + newId);
          }, 900);
        }, 400);
      }
    } else {
      ProgressBar.hideModal();
      showToast('❌ ' + ErrorCodes.messageForResponse(r, r.error), 'error');
    }
  } catch (error) { ProgressBar.hideModal(); showToast('❌ 請求失敗：' + error.message, 'error'); }
}