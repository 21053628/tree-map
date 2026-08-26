import { ApiService } from '../../api.js';
import { ErrorCodes } from '../../core/error-codes.js';
import { OfflineQueue, pwaToast } from '../../../../offline.js';
import { Config } from '../../config.js';
import { ProgressBar } from '../../ui-progress.js';
import * as TDUtils from './td-utils.js';
import { TD } from './route.js';
function requireTreeId(){ if(!TD.id){ alert('⚠️ 缺少樹木編號（tree_id），請由地圖選擇樹木'); return false; } return true; }
function requireStaff(v){ if(!v || !String(v).trim()){ alert('⚠️ 工作人員姓名（staff）必填'); return false; } return true; }
export async function post(payload, options){
  if (!ApiService) throw new Error('API 服務未初始化');
  if(!navigator.onLine && OfflineQueue){
    await OfflineQueue.push(payload);
    if(pwaToast) pwaToast('📥 離線暫存：有網路時自動上傳');
    return { ok: true, queued: true };
  }
  return ApiService.post(payload, options);
}

// 🔥 [修復 v2.62] 每個樹木固定一份 inspection 冪等鍵（重試重用同一 client_id，避免重複建立巡查記錄）
function getInspectionMeta_(){
  var key = String(TD.id || '');
  var cur = TD._inspectionMeta;
  if (cur && String(cur.tree_id) === key) return cur;
  var pm = ApiService.newClientMeta();
  TD._inspectionMeta = { tree_id: key, client_id: pm.client_id, client_created_at: pm.client_created_at };
  return TD._inspectionMeta;
}

// 🔥 [修復 v2.62] 為每張相片固定 client_id（重試時後端以 duplicate 略過，防止孤兒檔案）
function getPhotoMeta_(photo){
  if (!photo._clientId) {
    try {
      var pm = ApiService.newClientMeta();
      photo._clientId = pm.client_id;
      photo._clientCreatedAt = pm.client_created_at;
    } catch(e) { /* intentionally ignored: optional fallback failure */ }
  }
  return { client_id: photo._clientId, client_created_at: photo._clientCreatedAt };
}

export async function checkin(){
  if (!requireTreeId()) return;
  const staff = prompt('工作人員姓名：');
  if (!requireStaff(staff)) return;
  ProgressBar.showModal();
  ProgressBar.setMessage('正在簽到...');
  const meta = ApiService.newClientMeta();
  const lat = (TD.TREE && TD.TREE.lat) ? String(TD.TREE.lat) : '';
  const lng = (TD.TREE && TD.TREE.lng) ? String(TD.TREE.lng) : '';
  try{
    const r = await post({type:'checkin', staff:staff, tree_id:TD.id, prj:TD.prj, lat:lat, lng:lng, client_id: meta.client_id, client_created_at: meta.client_created_at});
    ProgressBar.hideModal();
    alert(r.ok ? '✅ 簽到成功！' : '❌ 失敗：' + (ErrorCodes ? ErrorCodes.messageForResponse(r, r.error) : r.error));
    if(r.ok && !r.queued) setTimeout(function(){ location.reload(); }, 800);
  }catch(err){ ProgressBar.hideModal(); alert('❌ 連線錯誤：' + err.message); }
}
export async function submitInspection(){
  if (!requireTreeId()) return;
  const staff = prompt('工作人員姓名：');
  if (!requireStaff(staff)) return;
  ProgressBar.showModal();
  ProgressBar.setMessage('正在準備提交巡查記錄...');
  const healthEl = document.getElementById('health');
  const noteEl = document.getElementById('note');
  if (!healthEl || !TDUtils.isValidHealth(healthEl.value)){ ProgressBar.hideModal(); alert('⚠️ 樹木健康狀態（health）不合法：' + (healthEl?healthEl.value:'')); return; }
  if (TD.selectedPhotos.length > TDUtils.MAX_PHOTOS){ ProgressBar.hideModal(); alert('⚠️ 相片數量超出上限（最多 ' + TDUtils.MAX_PHOTOS + ' 張）'); return; }
  {
    const up=(Config.UPLOAD)?Config.UPLOAD:null;
    const allowed=(up&&up.ALLOWED_MIMES)||TDUtils.ALLOWED_IMAGE_MIMES||['image/jpeg','image/png','image/webp'];
    const maxBytes=(up&&up.MAX_BYTES)||TDUtils.MAX_IMAGE_BYTES||10*1024*1024;
    const bad=[]; for(let _i=0; _i<TD.selectedPhotos.length; _i++){ const f=TD.selectedPhotos[_i]; const mime=f.type?String(f.type).toLowerCase():''; if(mime&&allowed.indexOf(mime)===-1) bad.push('第'+(_i+1)+'張格式不支援（'+mime+'）'); else if(!mime){ const nm=f.name?String(f.name).toLowerCase():''; const okExt=(nm.endsWith('.jpg')||nm.endsWith('.jpeg')||nm.endsWith('.png')||nm.endsWith('.webp')); if(!okExt) bad.push('第'+(_i+1)+'張格式不支援（未知）'); } if(f.size>maxBytes) bad.push('第'+(_i+1)+'張過大（'+(f.size/1024/1024).toFixed(1)+'MB）'); }
    if(bad.length){ ProgressBar.hideModal(); alert('⚠️ 相片檢查失敗：\n'+bad.join('\n')+'\n僅支援 '+allowed.join(', ')+'，單張上限 '+Math.round(maxBytes/1024/1024)+'MB'); return; }
  }
  const health=healthEl.value; const note=noteEl?noteEl.value:'';
  // 🔥 [修復 v2.62] 重用 inspection 冪等鍵（重試時不重複建立記錄）
  const insMeta=getInspectionMeta_();
  const lat = (TD.TREE && TD.TREE.lat) ? String(TD.TREE.lat) : '';
  const lng = (TD.TREE && TD.TREE.lng) ? String(TD.TREE.lng) : '';
  if(TD.selectedPhotos.length===0){
    ProgressBar.setMessage('正在提交巡查記錄...');
    try{ const r=await post({type:'inspection', staff:staff, tree_id:TD.id, prj:TD.prj, health:health, note:note, photo_base64:'', lat:lat, lng:lng, client_id:insMeta.client_id, client_created_at:insMeta.client_created_at}); ProgressBar.hideModal(); alert(r.ok?'✅ 已上傳！':'❌ 失敗：'+ErrorCodes.messageForResponse(r,r.error)); if(r.ok&&!r.queued){ try{ delete TD._inspectionMeta; }catch(e){ /* intentionally ignored: optional fallback failure */ } setTimeout(function(){ location.reload(); },1000); } }catch(err){ ProgressBar.hideModal(); alert('❌ 連線錯誤：'+err.message); }
    return;
  }
  // 🔥 [修復 v2.62] 壓縮相片，同時為每張相片建立固定 client_id（重試重用）
  ProgressBar.setMessage('正在壓縮相片...');
  const photosData=[]; const skipped=[];
  for(let i=0;i<TD.selectedPhotos.length;i++){
    ProgressBar.setProgress(((i+1)/TD.selectedPhotos.length)*25, '正在壓縮相片 '+(i+1)+'/'+TD.selectedPhotos.length+'...');
    ProgressBar.setDetail('第 '+(i+1)+' 張');
    try{ const b64clean=await TDUtils.compress(TD.selectedPhotos[i]); if(b64clean&&b64clean.length>TDUtils.MAX_PHOTO_CHARS){ skipped.push(i+1); continue; } const b64='data:image/jpeg;base64,' + b64clean; const pm=getPhotoMeta_(TD.selectedPhotos[i]); photosData.push({b64:b64, client_id:pm.client_id, client_created_at:pm.client_created_at}); }catch(err){ skipped.push(i+1); }
  }
  if(skipped.length) alert('⚠️ 第 '+skipped.join('、')+' 張相片處理失敗，已略過；其餘 '+photosData.length+' 張繼續上傳');
  if(photosData.length===0){ ProgressBar.hideModal(); alert('❌ 沒有相片可上傳（全部處理失敗）'); return; }
  const splitPhotos=navigator.onLine && (Config.INSPECTION_SPLIT_PHOTOS===true);
  if(splitPhotos){
    ProgressBar.setProgress(30, '正在提交巡查記錄...');
    ProgressBar.setDetail('');
    try{
      const r=await post({type:'inspection', staff:staff, tree_id:TD.id, prj:TD.prj, health:health, note:note, photo_base64:'', photos_total:photosData.length, photos_pending:photosData.length, lat:lat, lng:lng, client_id:insMeta.client_id, client_created_at:insMeta.client_created_at});
      if(r.queued){ ProgressBar.hideModal(); alert('📥 文字記錄已離線暫存（兩階段相片需後端回傳 inspection_id，請連線後重試）'); return; }
      if(r.ok&&r.inspection_id){
        const res=await uploadPhotos(r.inspection_id, photosData);
        updatePhotoProgress(res.done, photosData.length, 35, 65);
        ProgressBar.hideModal();
        if(res.done===photosData.length){
          alert('✅ 文字記錄已上傳；相片 '+res.done+'/'+photosData.length+' 張已處理');
          TD.selectedPhotos=[]; try{ delete TD._inspectionMeta; }catch(e){ /* intentionally ignored: optional fallback failure */ }
          setTimeout(function(){ location.reload(); },1000);
        } else {
          // 🔥 [修復 v2.62] 相片未全數成功：保留相片，顯示實際錯誤，供用戶重試（不會重複建立記錄）
          var errTxt=res.errors&&res.errors.length?'\n\n📋 失敗詳情：\n'+res.errors.join('\n'):'';
          alert('⚠️ 文字記錄已上傳，但相片只處理了 '+res.done+'/'+photosData.length+' 張。\\n\\n已選擇的相片已保留。請修正問題後再按「上傳巡查記錄」重試，系統會自動略過已成功的相片，不會重複建立記錄。'+errTxt);
          if(pwaToast) pwaToast('📷 相片 '+res.done+'/'+photosData.length+' 已處理，其餘待重試');
        }
      }
      else if(r.ok){ ProgressBar.hideModal(); alert('⚠️ 文字記錄已上傳，但後端未回傳 inspection_id，相片未能上傳'); TD.selectedPhotos=[]; setTimeout(function(){ location.reload(); },1000); }
      else { ProgressBar.hideModal(); alert('❌ 失敗：'+ErrorCodes.messageForResponse(r,r.error)); }
    }catch(err){ ProgressBar.hideModal(); alert('❌ 連線錯誤：'+err.message); }
    return;
  }
  ProgressBar.setProgress(30, '正在提交巡查記錄...');
  ProgressBar.setDetail('');
  try{
    const r=await post({type:'inspection', staff:staff, tree_id:TD.id, prj:TD.prj, health:health, note:note, photo_base64: photosData.map(function(p){return p.b64;}), lat:lat, lng:lng, client_id:insMeta.client_id, client_created_at:insMeta.client_created_at}, {
      onUploadProgress: function(loaded, bytesTotal){
        if(bytesTotal>0){
          const ratio=Math.min(1, Math.max(0, loaded/bytesTotal));
          ProgressBar.setProgress(30+(ratio*70), '正在上傳 '+photosData.length+' 張相片...');
          ProgressBar.setDetail((loaded/1024/1024).toFixed(1)+' / '+(bytesTotal/1024/1024).toFixed(1)+' MB');
        }
      }
    });
    ProgressBar.hideModal();
    alert(r.ok?'✅ 已上傳 '+photosData.length+' 張相片！':'❌ 失敗：'+ErrorCodes.messageForResponse(r,r.error));
    if(r.ok&&!r.queued){ TD.selectedPhotos=[]; try{ delete TD._inspectionMeta; }catch(e){ /* intentionally ignored: optional fallback failure */ } setTimeout(function(){ location.reload(); },1000); }
  }catch(err){ ProgressBar.hideModal(); alert('❌ 連線錯誤：'+err.message); }
}
// 🔥 [修復 v2.62] 修改 uploadPhotos：逐張容錯＋收集錯誤訊息；回傳 {done, errors}
export async function uploadPhotos(inspectionId, photosData){
  var total=photosData.length; var done=0; var errors=[];
  var uploadStart=35; var uploadRange=65;
  for(var i=0;i<total;i++){
    var item=photosData[i]||{};
    var photoStart=uploadStart+(i/total)*uploadRange;
    var photoRange=uploadRange/total;
    var lastPhotoProgress=0;
    try{
      ProgressBar.setProgress(photoStart, '正在上傳相片 '+(i+1)+'/'+total+'...');
      ProgressBar.setDetail('準備上傳第 '+(i+1)+' 張');
      var r=await post({type:'inspection_photo', inspection_id:inspectionId, tree_id:TD.id, prj:TD.prj, photo_base64:item.b64, photo_index:i+1, client_id:item.client_id, client_created_at:item.client_created_at}, {
        onUploadProgress: function(loaded, bytesTotal){
          var ratio=bytesTotal>0 ? Math.min(1, Math.max(0, loaded/bytesTotal)) : 0;
          var current=photoStart+(ratio*photoRange);
          // 重試時瀏覽器會重新由 0 開始，避免進度條倒退。
          lastPhotoProgress=Math.max(lastPhotoProgress, current);
          ProgressBar.setProgress(lastPhotoProgress, '正在上傳相片 '+(i+1)+'/'+total+'...');
          if(bytesTotal>0){
            var loadedMb=(loaded/1024/1024).toFixed(1);
            var totalMb=(bytesTotal/1024/1024).toFixed(1);
            ProgressBar.setDetail('第 '+(i+1)+' 張 · '+loadedMb+' / '+totalMb+' MB');
          }
        }
      });
      if(r&&(r.ok||r.queued)){
        done++;
        ProgressBar.setProgress(uploadStart+(done/total)*uploadRange, '已完成相片 '+done+'/'+total+'...');
        ProgressBar.setDetail('已處理 '+done+'/'+total+' 張相片');
      } else {
        var msg=(ErrorCodes.messageForResponse)?ErrorCodes.messageForResponse(r,r&&r.error):((r&&(r.error||r.error_code))||'未知錯誤');
        // 🔥 [調試 v2.62] 失敗時附上實際 base64 簽名，快速判斷圖片格式是否正確（/9j/=JPEG, iVBOR=PNG, UklGR=WebP）
        var b64str=String(item.b64||'');
        var sig=b64str.length>24?b64str.slice(0,24):b64str;
        errors.push('第'+(i+1)+'張：'+msg+(r&&r.error_code?'（'+r.error_code+'）':'')+' | base64長度='+b64str.length+' 開頭=['+sig+']');
        try{ console.warn('[uploadPhotos] 第'+(i+1)+'張上傳失敗：',r,'b64len='+b64str.length,'b64head='+sig); }catch(e){ /* intentionally ignored: optional fallback failure */ }
      }
    }catch(err){
      errors.push('第'+(i+1)+'張：'+(err&&err.message?err.message:String(err)));
      try{ console.warn('[uploadPhotos] 第'+(i+1)+'張例外：',err); }catch(e){ /* intentionally ignored: optional fallback failure */ }
    }
    updatePhotoProgress(done,total,uploadStart,uploadRange);
  }
  return {done:done, errors:errors};
}
export function updatePhotoProgress(done, total, start, range){
  const el=document.getElementById('photoCount'); if(el) el.textContent=done+'/'+total;
  if(total>0){
    const uploadStart=Number.isFinite(start)?start:35;
    const uploadRange=Number.isFinite(range)?range:65;
    ProgressBar.setProgress(uploadStart+(done/total)*uploadRange, '正在上傳相片 '+done+'/'+total+'...');
  }
  if(pwaToast) pwaToast('📷 '+done+'/'+total+' 張相片已處理');
}
