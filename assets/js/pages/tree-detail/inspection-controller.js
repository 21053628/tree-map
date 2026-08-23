import * as TDUtils from './td-utils.js';
const TD = globalThis.TD;
const $ = function(s){ return document.querySelector(s); };
function requireTreeId(){ if(!TD.id){ alert('⚠️ 缺少樹木編號（tree_id），請由地圖選擇樹木'); return false; } return true; }
function requireStaff(v){ if(!v || !String(v).trim()){ alert('⚠️ 工作人員姓名（staff）必填'); return false; } return true; }
export async function post(payload){
  if (typeof ApiService === 'undefined') throw new Error('API 服務未初始化');
  if(!navigator.onLine && typeof OfflineQueue !== 'undefined'){
    await OfflineQueue.push(payload);
    if(typeof pwaToast !== 'undefined') pwaToast('📥 離線暫存：有網路時自動上傳');
    return { ok: true, queued: true };
  }
  return ApiService.post(payload);
}
export async function checkin(){
  if (!requireTreeId()) return;
  const staff = prompt('工作人員姓名：');
  if (!requireStaff(staff)) return;
  const meta = ApiService.newClientMeta();
  try{
    const r = await post({type:'checkin', staff:staff, tree_id:TD.id, prj:TD.prj, client_id: meta.client_id, client_created_at: meta.client_created_at});
    alert(r.ok ? '✅ 簽到成功！' : '❌ 失敗：' + (typeof ErrorCodes !== 'undefined' ? ErrorCodes.messageForResponse(r, r.error) : r.error));
    if(r.ok && !r.queued) setTimeout(function(){ location.reload(); }, 800);
  }catch(err){ alert('❌ 連線錯誤：' + err.message); }
}
export async function submitInspection(){
  if (!requireTreeId()) return;
  const staff = prompt('工作人員姓名：');
  if (!requireStaff(staff)) return;
  const healthEl = document.getElementById('health');
  const noteEl = document.getElementById('note');
  if (!healthEl || !TDUtils.isValidHealth(healthEl.value)){ alert('⚠️ 樹木健康狀態（health）不合法：' + (healthEl?healthEl.value:'')); return; }
  if (TD.selectedPhotos.length > TDUtils.MAX_PHOTOS){ alert('⚠️ 相片數量超出上限（最多 ' + TDUtils.MAX_PHOTOS + ' 張）'); return; }
  {
    const up=(typeof Config!=='undefined'&&Config.UPLOAD)?Config.UPLOAD:null;
    const allowed=(up&&up.ALLOWED_MIMES)||TDUtils.ALLOWED_IMAGE_MIMES||['image/jpeg','image/png','image/webp'];
    const maxBytes=(up&&up.MAX_BYTES)||TDUtils.MAX_IMAGE_BYTES||10*1024*1024;
    const bad=[]; for(let _i=0; _i<TD.selectedPhotos.length; _i++){ const f=TD.selectedPhotos[_i]; const mime=f.type?String(f.type).toLowerCase():''; if(mime&&allowed.indexOf(mime)===-1) bad.push('第'+(_i+1)+'張格式不支援（'+mime+'）'); else if(!mime){ const nm=f.name?String(f.name).toLowerCase():''; const okExt=(nm.endsWith('.jpg')||nm.endsWith('.jpeg')||nm.endsWith('.png')||nm.endsWith('.webp')); if(!okExt) bad.push('第'+(_i+1)+'張格式不支援（未知）'); } if(f.size>maxBytes) bad.push('第'+(_i+1)+'張過大（'+(f.size/1024/1024).toFixed(1)+'MB）'); }
    if(bad.length){ alert('⚠️ 相片檢查失敗：\n'+bad.join('\n')+'\n僅支援 '+allowed.join(', ')+'，單張上限 '+Math.round(maxBytes/1024/1024)+'MB'); return; }
  }
  const health=healthEl.value; const note=noteEl?noteEl.value:'';
  const meta=ApiService.newClientMeta();
  if(TD.selectedPhotos.length===0){
    try{ const r=await post({type:'inspection', staff:staff, tree_id:TD.id, prj:TD.prj, health:health, note:note, photo_base64:'', client_id:meta.client_id, client_created_at:meta.client_created_at}); alert(r.ok?'✅ 已上傳！':'❌ 失敗：'+(typeof ErrorCodes!=='undefined'?ErrorCodes.messageForResponse(r,r.error):r.error)); if(r.ok&&!r.queued) setTimeout(function(){ location.reload(); },1000); }catch(err){ alert('❌ 連線錯誤：'+err.message); }
    return;
  }
  const photosData=[]; const skipped=[];
  for(let i=0;i<TD.selectedPhotos.length;i++){ try{ const b64=await TDUtils.compress(TD.selectedPhotos[i]); if(b64&&b64.length>TDUtils.MAX_PHOTO_CHARS){ skipped.push(i+1); continue; } photosData.push(b64); }catch(err){ skipped.push(i+1); } }
  if(skipped.length) alert('⚠️ 第 '+skipped.join('、')+' 張相片處理失敗，已略過；其餘 '+photosData.length+' 張繼續上傳');
  if(photosData.length===0){ alert('❌ 沒有相片可上傳（全部處理失敗）'); return; }
  const splitPhotos=navigator.onLine && (typeof Config!=='undefined'&&Config.INSPECTION_SPLIT_PHOTOS===true);
  if(splitPhotos){
    try{
      const r=await post({type:'inspection', staff:staff, tree_id:TD.id, prj:TD.prj, health:health, note:note, photo_base64:'', photos_total:photosData.length, photos_pending:photosData.length, client_id:meta.client_id, client_created_at:meta.client_created_at});
      if(r.queued){ alert('📥 文字記錄已離線暫存（兩階段相片需後端回傳 inspection_id，請連線後重試）'); return; }
      if(r.ok&&r.inspection_id){ const done=await uploadPhotos(r.inspection_id, photosData); alert('✅ 文字記錄已上傳；相片 '+done+'/'+photosData.length+' 張已處理'); TD.selectedPhotos=[]; setTimeout(function(){ location.reload(); },1000); }
      else if(r.ok){ alert('⚠️ 文字記錄已上傳，但後端未回傳 inspection_id，相片未能上傳'); TD.selectedPhotos=[]; setTimeout(function(){ location.reload(); },1000); }
      else alert('❌ 失敗：'+(typeof ErrorCodes!=='undefined'?ErrorCodes.messageForResponse(r,r.error):r.error));
    }catch(err){ alert('❌ 連線錯誤：'+err.message); }
    return;
  }
  try{ const r=await post({type:'inspection', staff:staff, tree_id:TD.id, prj:TD.prj, health:health, note:note, photo_base64: photosData, client_id:meta.client_id, client_created_at:meta.client_created_at}); alert(r.ok?'✅ 已上傳 '+photosData.length+' 張相片！':'❌ 失敗：'+(typeof ErrorCodes!=='undefined'?ErrorCodes.messageForResponse(r,r.error):r.error)); if(r.ok&&!r.queued){ TD.selectedPhotos=[]; setTimeout(function(){ location.reload(); },1000); } }catch(err){ alert('❌ 連線錯誤：'+err.message); }
}
export async function uploadPhotos(inspectionId, photosData){
  const total=photosData.length; let done=0;
  for(let i=0;i<total;i++){ const pm=ApiService.newClientMeta(); const r=await post({type:'inspection_photo', inspection_id:inspectionId, tree_id:TD.id, prj:TD.prj, photo_base64:photosData[i], photo_index:i+1, client_id:pm.client_id, client_created_at:pm.client_created_at}); if(r&&(r.ok||r.queued)) done++; updatePhotoProgress(done,total); }
  return done;
}
export function updatePhotoProgress(done, total){
  const el=document.getElementById('photoCount'); if(el) el.textContent=done+'/'+total;
  if(typeof pwaToast==='function') pwaToast('📷 '+done+'/'+total+' 張相片已處理');
}
