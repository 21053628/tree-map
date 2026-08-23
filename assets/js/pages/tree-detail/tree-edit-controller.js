import * as TDUtils from './td-utils.js';
import { post } from './inspection-controller.js';
import { TD } from './route.js';
import { updateUrlOnRename } from './route.js';
const $ = function(s){ return document.querySelector(s); };
const toWGS = globalThis.CoordLazy ? globalThis.CoordLazy.toWGS : function(){ return Promise.resolve(null); };
function requireTreeId(){ if(!TD.id){ alert('⚠️ 缺少樹木編號（tree_id），請由地圖選擇樹木'); return false; } return true; }
export async function saveTreeInfo(){
  if (!requireTreeId()) return;
  const eStatus = document.getElementById('eStatus');
  if (!eStatus || !TDUtils.isValidHealth(eStatus.value)){ alert('⚠️ 樹木健康狀態（status）不合法：' + (eStatus?eStatus.value:'')); return; }
  const newId = (document.getElementById('eTreeId') ? document.getElementById('eTreeId').value.trim() : '');
  if (!newId){ alert('⚠️ 樹木編號不可為空'); return; }
  if (newId.length > 64 || !/^[\p{L}\p{N}._-]+$/u.test(newId)){ alert('⚠️ 樹木編號格式不正確（只可用英數、中文、點、底線、連字號）'); return; }
  let lat = TD.TREE.lat, lng = TD.TREE.lng;
  const N = (document.getElementById('eN')?document.getElementById('eN').value:''), E = (document.getElementById('eE')?document.getElementById('eE').value:'');
  if(N || E){
    if (!TDUtils.isValidHK80(N, E)){ alert('⚠️ HK80 位置錯誤：請輸入香港範圍內的 HK80 N/E 座標。'); return; }
    const w = await toWGS(N, E); if(!w){ alert('HK80 座標轉換失敗，請檢查 N/E 數值'); return; }
    lat = w.lat.toFixed(6); lng = w.lng.toFixed(6);
  }
  const meta = ApiService.newClientMeta();
  try{
    const r = await post({type:'update_tree', tree_id:TD.id, new_tree_id:newId, prj:TD.prj,
      name:(document.getElementById('eName')?document.getElementById('eName').value:''), status:eStatus.value,
      project_id:(document.getElementById('eProject')?document.getElementById('eProject').value:''),
      tree_height:(document.getElementById('eHeight')?document.getElementById('eHeight').value:''), crown_width:(document.getElementById('eSpread')?document.getElementById('eSpread').value:''),
      dbh:(document.getElementById('eDbh')?document.getElementById('eDbh').value:''), ground_diameter:(document.getElementById('eGroundDia')?document.getElementById('eGroundDia').value:''),
      stem_length:(document.getElementById('eStemLen')?document.getElementById('eStemLen').value:''), crown_area:(document.getElementById('eCrownArea')?document.getElementById('eCrownArea').value:''),
      crown_volume:(document.getElementById('eCrownVol')?document.getElementById('eCrownVol').value:''), level:(document.getElementById('eLevel')?document.getElementById('eLevel').value:''),
      lat:lat, lng:lng, description:(document.getElementById('eDesc')?document.getElementById('eDesc').value:''),
      client_id: meta.client_id, client_created_at: meta.client_created_at});
    if (r.ok && !r.queued){
      if (newId !== TD.id){ updateUrlOnRename(newId); alert('✅ 已更新！樹木編號已改為 ' + newId + '。\n⚠️ 如該樹已寫入 NFC 標籤，請重新寫入新編號。'); }
      else alert('✅ 已更新！');
      setTimeout(function(){ location.reload(); }, 800);
    } else if (r.ok && r.queued){ alert('📥 已離線暫存（編號改名會於連線同步後生效）'); }
    else alert('❌ 失敗：' + (typeof ErrorCodes !== 'undefined' ? ErrorCodes.messageForResponse(r, r.error) : r.error));
  }catch(err){ alert('❌ 連線錯誤：' + err.message); }
}
