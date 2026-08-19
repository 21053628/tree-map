/**
 * 表單模組：建立地盤與樹木
 * v5.0 - Step 5：doCreateTree 改用新欄位名 + 補齊新增欄位
 */
import { state } from './state.js';
import { $, showPanel, closePanel, updateStatus, escapeHtml } from './dom.js';
import { loadTreeSpecies, fillSpeciesDatalist } from './species.js';
import { bringTreeToFront } from './trees.js';
import { startPick } from './draw.js'; // 🔥 [Phase1]
import { load } from './loader.js'; // 🔥 [Phase2] 直接 import，移除 setLoad 注入
import { VALID_HEALTH, isValidHK80 } from '../core/utils.js';

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
    '<div style="font-size:12px;color:#666;margin-top:4px">💡 此 ID 會寫入 NFC tag，建議用簡短英文</div>' +
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

  if (!name || !N || !E) { alert('請填寫完整'); return; }

  if (!isValidHK80(N, E)) { alert('HK80 座標 N/E 必須是有效數字，並在香港範圍內'); return; }

  const w = CoordUtils.toWGS84(N, E);
  if (!w) { alert('HK80 座標轉換失敗'); return; }

  try {
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
      alert('✅ 地盤已建立！\nID: ' + r.project_id + '\n（請將此 ID 寫入 NFC tag）');
      closePanel();
      state.projectMarkersCache = null;
      state.treesCache.clear();
      state.spatialIndexCache = null;
      state.coordGroupsCache = null;
      await load();
    } else {
      alert('❌ ' + r.error);
    }
  } catch (error) {
    alert('❌ 請求失敗：' + error.message);
  }
}

export async function openTreeForm(preset) {
  if (!state.curProject) { alert('請先選擇地盤'); return; }

  const authResult = _promptAuth();
  if (authResult instanceof Promise) { if (!await authResult) return; }
  else { if (!authResult) return; }

  const presetN = (preset && preset.N != null) ? escapeHtml(String(preset.N)) : '';
  const presetE = (preset && preset.E != null) ? escapeHtml(String(preset.E)) : '';

  showPanel(
    '<b>🌳 新增樹木</b>' +
    '<button class="pick-loc-btn" id="btnPickLocation">📍 在地圖按位置（自動填 N/E）</button>' +
    '<input id="tId" placeholder="樹木編號（留空＝該地盤最大編號＋1）">' +
    '<input id="tName" list="tree_datalist" placeholder="選擇樹種（輸入關鍵字搜尋）...">' +
    '<datalist id="tree_datalist"></datalist>' +
    '<select id="tStatus"><option>Normal</option><option>Fair</option><option>Poor</option><option>Very Poor</option><option>Dead</option></select>' +
    '<div class="row2"><input id="tHeight" placeholder="Tree Height (m)" inputmode="decimal"><input id="tSpread" placeholder="Crown Width (m)" inputmode="decimal"></div>' +
    '<div class="row2"><input id="tDbh" placeholder="DBH (m)" inputmode="decimal"><input id="tGroundDia" placeholder="Ground Dia. (m)" inputmode="decimal"></div>' +
    '<div class="row2"><input id="tStemLen" placeholder="Stem Length (m)" inputmode="decimal"><input id="tCrownArea" placeholder="Crown Area (㎡)" inputmode="decimal"></div>' +
    '<input id="tCrownVol" placeholder="Crown Volume (m³)" inputmode="decimal">' +
    '<div class="row2"><input id="tN" placeholder="HK80 N" inputmode="decimal" value="' + presetN + '"><input id="tE" placeholder="HK80 E" inputmode="decimal" value="' + presetE + '"></div>' +
    '<input id="tLevel" placeholder="Level (m)" inputmode="decimal">' +
    '<button id="btnCreateTree">💾 建立樹木</button>' +
    '<button class="x" id="btnCloseTree">✖ 關閉</button>'
  );

  document.getElementById('btnPickLocation').addEventListener('click', pickTreeLocation);
  document.getElementById('btnCreateTree').addEventListener('click', doCreateTree);
  document.getElementById('btnCloseTree').addEventListener('click', closePanel);

  loadTreeSpecies().then(fillSpeciesDatalist);
}

export function pickTreeLocation() {
  closePanel();
  if (!state.curProject) { alert('請先選擇地盤'); return; }
  startPick(function (latlng) {
    const hk = CoordUtils.toHK80(latlng.lat, latlng.lng);
    if (!hk) { alert('HK80 座標轉換失敗'); return; }
    openTreeForm({ N: CoordUtils.format1(hk.N), E: CoordUtils.format1(hk.E) });
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
      alert('⚠️ 樹木編號 ' + inputId + ' 已存在於此地盤，請改用其他編號（或留空自動編號）');
      return;
    }
  }

  const N = $('#tN').value;
  const E = $('#tE').value;

  if (!N || !E) { alert('請填寫 HK80 座標 N/E'); return; }

  if (!isValidHK80(N, E)) { alert('HK80 座標 N/E 必須是有效數字，並在香港範圍內'); return; }
  if (VALID_HEALTH.indexOf($('#tStatus').value) === -1) { alert('樹木狀態不合法：' + $('#tStatus').value); return; }

  const w = CoordUtils.toWGS84(N, E);
  if (!w) { alert('HK80 座標轉換失敗'); return; }

  try {
    // 🔥 [v5.0] 改用新欄位名 + 補齊新增欄位；[Phase2] 加 client_id/client_created_at
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

    alert(r.ok ? '✅ 樹木 ' + r.tree_id + ' 已建立' : '❌ ' + r.error);
    if (r.ok) {
      closePanel();
      state.treesCache.clear();
      state.spatialIndexCache = null;
      state.coordGroupsCache = null;
      await load();

      const newId = String(r.tree_id);
      const nt = state.treeMap.get(state.curProject + '_' + newId) ||
        state.TREES.find((t) => String(t.tree_id) === newId && String(t.project_id) === state.curProject);

      if (nt) {
        setTimeout(function () {
          state.map.flyTo([+nt.lat, +nt.lng], Math.max(state.map.getZoom(), 18), { duration: 0.8 });

          setTimeout(function () {
            const m = state.treesCache.get(state.curProject + '_' + newId) || state.treesCache.get(newId);
            if (m) {
              state.treesCache.forEach((otherM) => { if (otherM && otherM.bringToFront) otherM.bringToFront(); });
              bringTreeToFront(m);
              m.openPopup();
            }
            updateStatus('✅ 已定位到新樹木：' + newId);
          }, 900);
        }, 400);
      }
    }
  } catch (error) { alert('❌ 請求失敗：' + error.message); }
}