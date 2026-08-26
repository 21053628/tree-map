import { AuthService } from '../../auth.js';
import { ApiService } from '../../api.js';
import { toHK80Async } from '../../core/coordinates.js';
import { escapeHtml } from '../../core/utils.js';
import * as TDPhotos from './td-photos.js';
import { TD } from './route.js';
import { checkin, submitInspection } from './inspection-controller.js';
import { saveTreeInfo } from './tree-edit-controller.js';
const toHK = toHK80Async;
const f1 = function(n){ return Number(n).toFixed(1); };
let staffInitialized = false;
let staffInitPromise = null;
let allTreesLoaded = false;
export async function staffOk(){
  if (AuthService.isAuthenticated()) return true;
  if(!navigator.onLine){ alert('📴 離線模式：登入已過期，請連接網路後重新驗證。'); return false; }
  if (AuthService) return await AuthService.promptAuth('🔒 請輸入工作人員密碼：');
  return false;
}
export function isStaffInitialized(){ return staffInitialized; }
export async function ensureStaff(){ return staffMode(); }
export async function staffMode(){
  if (staffInitialized) return true;
  if (staffInitPromise) return staffInitPromise;
  staffInitPromise = (async function(){
    if(!await staffOk()) return false;
    const inspectionContent = document.getElementById('inspectionContent');
    const editContent = document.getElementById('editContent');
    if (!inspectionContent || !editContent) return false;
    const hk = await toHK(TD.TREE.lat, TD.TREE.lng);
    inspectionContent.innerHTML = '<button id="checkinBtn">✅ 簽到</button><hr><div class="section-title">📝 巡查記錄（狀態會自動同步樹木資料）</div><select id="health"><option>Normal</option><option>Fair</option><option>Poor</option><option>Very Poor</option><option>Dead</option></select><textarea id="note" rows="2" placeholder="備註"></textarea><input type="file" id="photo" class="photo-file-input" accept="image/jpeg,image/png,image/webp" multiple><label class="btn-neutral photo-picker-btn mt-10" for="photo">📷 選擇相片（支援多張／相簿）</label><div id="photoPreviewContainer" class="photo-preview-container is-hidden"><div class="photo-count">已選擇 <b id="photoCount">0</b> 張相片</div><div id="photoPreviewGrid" class="photo-preview-grid"></div></div><button id="submitInspectionBtn" class="mt-10">📤 上傳巡查記錄</button>';
    editContent.innerHTML = '<div class="section-title">✏️ 樹木資料（HK80 座標／Level／地盤）</div><div class="form-group"><label class="form-label">🆔 樹木編號</label><input id="eTreeId" value="' + escapeHtml(TD.TREE.tree_id) + '"></div><div class="form-group"><label class="form-label">🌳 樹種</label><input id="eName" list="tree_list" placeholder="選擇樹種..."></div><datalist id="tree_list"></datalist><div class="form-group"><label class="form-label">📊 健康狀況</label><select id="eStatus"><option>Normal</option><option>Fair</option><option>Poor</option><option>Very Poor</option><option>Dead</option></select></div><div class="form-group"><label class="form-label">🚩 所屬地盤</label><select id="eProject"></select></div><div class="row2"><div class="form-group"><label class="form-label">Tree Height (m)</label><input id="eHeight" placeholder="樹高" inputmode="decimal"></div><div class="form-group"><label class="form-label">Crown Width (m)</label><input id="eSpread" placeholder="冠寬" inputmode="decimal"></div></div><div class="row2"><div class="form-group"><label class="form-label">DBH (m)</label><input id="eDbh" placeholder="胸徑" inputmode="decimal"></div><div class="form-group"><label class="form-label">Ground Dia. (m)</label><input id="eGroundDia" placeholder="地徑" inputmode="decimal"></div></div><div class="row2"><div class="form-group"><label class="form-label">Stem Length (m)</label><input id="eStemLen" placeholder="幹長" inputmode="decimal"></div><div class="form-group"><label class="form-label">Crown Area (㎡)</label><input id="eCrownArea" placeholder="投影面積" inputmode="decimal"></div></div><div class="form-group"><label class="form-label">Crown Volume (m³)</label><input id="eCrownVol" placeholder="冠幅體積" inputmode="decimal"></div><div class="row2"><div class="form-group"><label class="form-label">HK80 N (Northing)</label><input id="eN" placeholder="北座標" inputmode="decimal"></div><div class="form-group"><label class="form-label">HK80 E (Easting)</label><input id="eE" placeholder="東座標" inputmode="decimal"></div></div><div class="form-group"><label class="form-label">Level (m，高程)</label><input id="eLevel" placeholder="高程" inputmode="decimal"></div><div class="form-group"><label class="form-label">📄 簡介</label><textarea id="eDesc" rows="2" placeholder="樹木簡介"></textarea></div><button id="saveTreeInfoBtn">💾 儲存樹木資料</button>';
    const checkinBtn = document.getElementById('checkinBtn');
    if (checkinBtn) checkinBtn.addEventListener('click', checkin);
    const submitBtn = document.getElementById('submitInspectionBtn');
    if (submitBtn) submitBtn.addEventListener('click', submitInspection);
    const saveBtn = document.getElementById('saveTreeInfoBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveTreeInfo);
    TDPhotos.initPhotoPreview();
    const eS = document.getElementById('eStatus'); if(eS) eS.value = TD.TREE.status || 'Normal';
    const eN2 = document.getElementById('eName'); if(eN2) eN2.value = TD.TREE.name || '';
    const sv = function(id,v){ const el=document.getElementById(id); if(el) el.value=v; };
    sv('eHeight', TD.TREE.tree_height || TD.TREE.height || ''); sv('eSpread', TD.TREE.crown_width || TD.TREE.spread || '');
    sv('eDbh', TD.TREE.dbh || ''); sv('eGroundDia', TD.TREE.ground_diameter || ''); sv('eStemLen', TD.TREE.stem_length || '');
    sv('eCrownArea', TD.TREE.crown_area || ''); sv('eCrownVol', TD.TREE.crown_volume || ''); sv('eN', hk ? f1(hk.N) : ''); sv('eE', hk ? f1(hk.E) : '');
    sv('eLevel', TD.TREE.level || ''); sv('eDesc', TD.TREE.description || '');
    if (ApiService) {
      ApiService.get('projects').then(function(res){
        const opts=(res.data||[]).map(function(p){ return '<option value="' + escapeHtml(p.project_id) + '">🚩 ' + escapeHtml(p.name) + '</option>'; }).join('');
        const eP=document.getElementById('eProject'); if(eP){ eP.innerHTML='<option value="">（不屬任何地盤）</option>'+opts; eP.value=TD.TREE.project_id||''; }
      }).catch(function(err){ console.error('載入地盤資料失敗:', err); const eP=document.getElementById('eProject'); if(eP) eP.innerHTML='<option value="">（地盤資料載入失敗）</option>'; });
    }
    if(!allTreesLoaded){
      fetch('data/trees_data.json').then(function(r){ return r.json(); }).then(function(trees){
        const dl=document.getElementById('tree_list'); if(!dl) return;
        trees.forEach(function(tree){ const o=document.createElement('option'); o.value=tree.name; dl.appendChild(o); });
        allTreesLoaded=true;
      }).catch(function(err){ console.error('載入樹木資料失敗:', err); });
    }
    staffInitialized = true; return true;
  })();
  try { return await staffInitPromise; } finally { if(!staffInitialized) staffInitPromise=null; }
}
