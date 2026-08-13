/**
 * 表單模組：建立地盤與樹木
 * v5.0 - Step 5：doCreateTree 改用新欄位名 + 補齊新增欄位
 */
import { state } from './state.js';
import { $, showPanel, closePanel, updateStatus, escapeHtml } from './dom.js';
import { loadTreeSpecies, fillSpeciesDatalist } from './species.js';
import { bringTreeToFront } from './trees.js';
import { startPick } from './draw.js'; // 🔥 [Phase1]

let _load = null;
let _promptAuth = null;

export function setLoad(fn) { _load = fn; }
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
    '<button onclick="App.doCreateProject()">💾 建立</button>' +
    '<button class="x" onclick="App.closePanel()">✖ 關閉</button>'
  );
}

export async function doCreateProject() {
  const name = $('#pName').value;
  const customId = $('#pCustomId').value;
  const N = $('#pN').value;
  const E = $('#pE').value;

  if (!name || !N || !E) { alert('請填寫完整'); return; }

  const w = CoordUtils.toWGS84(N, E);
  if (!w) { alert('HK80 座標轉換失敗'); return; }

  try {
    const r = await ApiService.post({
      type: 'create_project',
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
      if (_load) await _load();
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
    '<button class="pick-loc-btn" onclick="App.pickTreeLocation()">📍 喺地圖撳位置（自動填 N/E）</button>' +
    '<input id="tId" placeholder="樹木編號（留空自動）">' +
    '<input id="tName" list="tree_datalist" placeholder="選擇樹種（輸入關鍵字搜尋）...">' +
    '<datalist id="tree_datalist"></datalist>' +
    '<select id="tStatus"><option>Normal</option><option>Fair</option><option>Poor</option><option>Very Poor</option><option>Dead</option></select>' +
    '<div class="row2"><input id="tHeight" placeholder="Tree Height (m)" inputmode="decimal"><input id="tSpread" placeholder="Crown Width (m)" inputmode="decimal"></div>' +
    '<div class="row2"><input id="tDbh" placeholder="DBH (m)" inputmode="decimal"><input id="tGroundDia" placeholder="Ground Dia. (m)" inputmode="decimal"></div>' +
    '<div class="row2"><input id="tStemLen" placeholder="Stem Length (m)" inputmode="decimal"><input id="tCrownArea" placeholder="Crown Area (㎡)" inputmode="decimal"></div>' +
    '<input id="tCrownVol" placeholder="Crown Volume (m³)" inputmode="decimal">' +
    '<div class="row2"><input id="tN" placeholder="HK80 N" inputmode="decimal" value="' + presetN + '"><input id="tE" placeholder="HK80 E" inputmode="decimal" value="' + presetE + '"></div>' +
    '<input id="tLevel" placeholder="Level (m)" inputmode="decimal">' +
    '<button onclick="App.doCreateTree()">💾 建立樹木</button>' +
    '<button class="x" onclick="App.closePanel()">✖ 關閉</button>'
  );

  loadTreeSpecies().then(fillSpeciesDatalist);
}

export function pickTreeLocation() {
  closePanel();
  if (!state.curProject) { alert('請先選擇地盤'); return; }
  startPick(function (latlng) {
    const hk = CoordUtils.toHK80(latlng.lat, latlng.lng);
    if (!hk) { alert('HK80 座標轉換失敗'); return; }
    openTreeForm({ N: CoordUtils.format1(hk.N), E: CoordUtils.format1(hk.E) });
  }, '📍 撳一下選擇樹木位置');
}

export function moveTree(treeId, projectId) {
  closePanel();
  if (state.map) state.map.closePopup();
  startPick(function (latlng) {
    const hk = CoordUtils.toHK80(latlng.lat, latlng.lng);
    if (!hk) { alert('HK80 座標轉換失敗'); return; }
    ApiService.post({
      type: 'update_tree',
      tree_id: String(treeId),
      project_id: String(projectId),
      lat: latlng.lat.toFixed(6),
      lng: latlng.lng.toFixed(6)
    }).then(function (r) {
      if (r.ok) {
        updateStatus('✅ 已移動樹木 ' + treeId + ' 至新位置');
        if (_load) _load();
      } else {
        alert('❌ ' + r.error);
      }
    }).catch(function (err) {
      alert('❌ 請求失敗：' + err.message);
    });
  }, '📍 撳一下選擇樹木新位置');
}

export async function doCreateTree() {
  const N = $('#tN').value;
  const E = $('#tE').value;

  if (!N || !E) { alert('請填寫 HK80 座標 N/E'); return; }

  const w = CoordUtils.toWGS84(N, E);
  if (!w) { alert('HK80 座標轉換失敗'); return; }

  try {
    // 🔥 [v5.0] 改用新欄位名 + 補齊新增欄位
    const r = await ApiService.post({
      type: 'create_tree',
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
      if (_load) await _load();

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