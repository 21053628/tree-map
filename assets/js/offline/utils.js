/** Offline UI, diagnostics, security helpers and cross-tab coordination. */
import { Config } from '../config.js';
import { CacheManager } from '../core/cache-manager.js';
import { AuditLog } from '../modules/audit-log.js';

var _lastWarm = 0;
var _lastSyncAttempt = 0;
var _failToastShown = false;
export var SYNC_TAB_ID = 'tab-' + genUUID();
var syncChannel = null;
  function notifySwInvalidateOffline_(type, payload){
    try{
      if (CacheManager.notifySwInvalidate) { CacheManager.notifySwInvalidate(type, payload); return; }
      if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type:'INVALIDATE_DATA_CACHE', invalidateType:type, payload:payload||null });
      }
    }catch(e){ /* intentionally ignored: optional fallback failure */ }
  }
  function getSyncChannel_() {
    if (syncChannel || typeof BroadcastChannel === 'undefined') return syncChannel;
    try {
      syncChannel = new BroadcastChannel('tree-map-sync-v1');
      syncChannel.onmessage = function (event) {
        try {
          if (!event || !event.data || event.data.source === SYNC_TAB_ID) return;
          window.dispatchEvent(new CustomEvent('treemap:syncchange', { detail: event.data }));
        } catch (e) { /* intentionally ignored: optional fallback failure */ }
      };
    } catch (e) { syncChannel = null; }
    return syncChannel;
  }

  function broadcastSyncChange_(kind, id) {
    try {
      var channel = getSyncChannel_();
      if (channel) channel.postMessage({ source: SYNC_TAB_ID, kind: kind, id: id || null, at: Date.now() });
    } catch (e) { /* intentionally ignored: optional fallback failure */ }
  }

  try {
    if (typeof window !== 'undefined') window.__treeMapSyncTabId = SYNC_TAB_ID;
    getSyncChannel_();
  } catch (e) { /* intentionally ignored: optional fallback failure */ }

  // ========== 工具函式 ==========
  function pwaToast(msg, duration) {
    var el = document.getElementById('pwaToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pwaToast';
      el.className = 'offline-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(el._t);
    el._t = setTimeout(function() { el.classList.remove('is-visible'); }, duration || 2600);
  }

  function quietFailToast(msg) {
    if (_failToastShown) return;
    _failToastShown = true;
    pwaToast(msg, 3000);
  }

  // [Phase6] 本地審計記錄（若有載入 audit-log.js）
  function auditWrite(payload, action, status, error) {
    if (typeof window === 'undefined' || !AuditLog) return;
    var p = payload || {};
    try {
      AuditLog.log({
        action: action,
        type: p.type || null,
        tree_id: p.tree_id || p.treeId || null,
        project_id: p.project_id || p.prj || null,
        staff: p.staff || null,
        status: status,
        error: error || null
      });
    } catch (e) { /* intentionally ignored: optional fallback failure */ }
  }

  function getCurrentToken() {
    var TOKEN_KEY = (Config.AUTH && Config.AUTH.STORAGE_KEY)
      ? Config.AUTH.STORAGE_KEY
      : 'tree_staff_token';
    // 僅讀取 sessionStorage；關閉分頁後離線佇列會等待重新登入，不使用 persistent Token。
    try {
      var raw = window.sessionStorage.getItem(TOKEN_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && data.token && data.until > Date.now()) return data.token;
      }
    } catch (e) { /* intentionally ignored: optional fallback failure */ }
    return null;
  }

  // 產生 UUID（idempotency key）。優先 crypto.randomUUID，非安全環境 fallback。
  function genUUID() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (e) { /* intentionally ignored: optional fallback failure */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = (c === 'x') ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  }

  // 📷 離線圖片限制（與 Config.UPLOAD / GAS 一致）
  function getUploadLimitsOffline(){
    var up = Config.UPLOAD ? Config.UPLOAD : null;
    return {
      allowed: (up && up.ALLOWED_MIMES) || ['image/jpeg','image/png','image/webp'],
      maxBytes: (up && up.MAX_BYTES) || 10*1024*1024,
      maxCount: (up && up.MAX_COUNT) || 10,
      singleB64: 15*1024*1024
    };
  }
  function estimateDecodedBytesOffline(clean){
    var s = String(clean||'').replace(/\s/g,'');
    if(!s) return 0;
    var pad=0; if(s.slice(-2)==='==') pad=2; else if(s.slice(-1)==='=') pad=1;
    return Math.floor(s.length*3/4)-pad;
  }
  function detectMimeFromBytesOffline(bytes){
    if(!bytes || bytes.length<4) return '';
    if(bytes[0]===0xFF && bytes[1]===0xD8 && bytes[2]===0xFF) return 'image/jpeg';
    if(bytes[0]===0x89 && bytes[1]===0x50 && bytes[2]===0x4E && bytes[3]===0x47) return 'image/png';
    if(bytes.length>=12 && bytes[0]===0x52 && bytes[1]===0x49 && bytes[2]===0x46 && bytes[3]===0x46 && bytes[8]===0x57 && bytes[9]===0x45 && bytes[10]===0x42 && bytes[11]===0x50) return 'image/webp';
    return '';
  }
  function validatePhotoPayloadOffline(payload){
    var p = payload || {};
    var b64 = p.photo_base64;
    if(b64===undefined || b64===null || b64==='') return null;
    var arr = Array.isArray(b64) ? b64 : [b64];
    var lim = getUploadLimitsOffline();
    var nonEmpty = arr.filter(function(v){ return String(v||'').trim()!==''; });
    if(nonEmpty.length>lim.maxCount || arr.length>lim.maxCount) return '相片數量不可超過 '+lim.maxCount+' 張（目前 '+arr.length+' 張）';
    for(var i=0;i<arr.length;i++){
      var raw = String(arr[i]||''); if(!raw.trim()) continue;
      if(raw.length>lim.singleB64) return '單張相片過大，請壓縮後再上傳';
      var comma = raw.indexOf(',');
      var prefix=''; var clean=raw;
      if(raw.slice(0,5)==='data:' && comma!==-1){ prefix=raw.slice(0,comma); clean=raw.slice(comma+1); }
      var declared='';
      if(prefix){ var m=prefix.match(/^data:([^;]+);base64$/i); declared=m?String(m[1]).toLowerCase().trim():''; if(declared && lim.allowed.indexOf(declared)===-1) return '不支援的圖片格式：'+declared; }
      clean=String(clean||'').replace(/\s/g,'');
      if(!clean) return '相片資料空白';
      if(!/^[A-Za-z0-9+/=]+$/.test(clean)) return '相片 base64 格式不正確';
      var est=estimateDecodedBytesOffline(clean);
      if(est>lim.maxBytes) return '單張相片過大（'+(est/1024/1024).toFixed(1)+'MB），上限 '+Math.round(lim.maxBytes/1024/1024)+'MB';
      try{
        var bin = atob(clean.slice(0, 32));
        var bytes=[]; for(var k=0;k<bin.length;k++) bytes.push(bin.charCodeAt(k));
        var sniffed=detectMimeFromBytesOffline(bytes);
        if(declared && sniffed && declared!==sniffed) return '圖片 MIME 與內容不符（聲明 '+declared+' 實際 '+sniffed+'）';
        var eff=sniffed||declared;
        if(!eff) {
          // 無前綴且頭部不足以判斷：若能 decode 則放行由後端最終校驗，否則報格式不明
          if(nonEmpty.length===arr.length && !prefix) continue;
          return '無法識別圖片格式（僅支援 '+lim.allowed.join(', ')+'）';
        }
        if(lim.allowed.indexOf(eff)===-1) return '不支援的圖片格式：'+eff;
      }catch(e){ return '相片 base64 解碼失敗'; }
    }
    return null;
  }
export function getLastWarm() { return _lastWarm; }
export function setLastWarm(value) { _lastWarm = value; }
export function getLastSyncAttempt() { return _lastSyncAttempt; }
export function setLastSyncAttempt(value) { _lastSyncAttempt = value; }
export function setFailToastShown(value) { _failToastShown = value; }

export {
  notifySwInvalidateOffline_,
  broadcastSyncChange_,
  pwaToast,
  quietFailToast,
  auditWrite,
  getCurrentToken,
  genUUID,
  validatePhotoPayloadOffline
};
