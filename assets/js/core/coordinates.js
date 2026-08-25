/**
 * 統一座標工具 [Unified Coordinate Tool]
 * 前端唯一真源：WGS84 <-> HK80 轉換、驗證、格式化、快取
 * 取代 utils.js(CoordUtils) 與 core/coord-lazy.js(CoordLazy) 的轉換職責
 */
export const PROJECTIONS = {
  HK80: '+proj=tmerc +lat_0=22.31213333333334 +lon_0=114.1785555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.067753,-2.243649,-1.158827,-1.094246 +units=m +no_defs',
  WGS84: '+proj=longlat +datum=WGS84 +no_defs'
};
export const HK80_BOUNDS = { N: [800000, 850000], E: [800000, 870000] };
export const WGS84_BOUNDS = { lat: [22.15, 22.55], lng: [113.85, 114.45] };
const MAX_CACHE_SIZE = 2000;
const coordCache = new Map();
let isPreheated = false;
let proj4Transform = null;
let proj4Promise = null;
function getProj4(){ try{ const g=typeof globalThis!=='undefined'?globalThis:window; return g.proj4||null;}catch(e){return null;}}
function getProjections(){ try{ const g=typeof globalThis!=='undefined'?globalThis:null; if(g&&g.Config&&g.Config.PROJECTIONS&&g.Config.PROJECTIONS.HK80) return g.Config.PROJECTIONS;}catch(e){} return PROJECTIONS; }
function initProj4(){
  const pj=getProj4(); if(!pj) return null; if(proj4Transform) return proj4Transform;
  try{ const projs=getProjections(); try{ const tr=pj(projs.WGS84, projs.HK80); if(tr&&typeof tr.forward==='function'){ proj4Transform=tr; return tr;}}catch(e){} proj4Transform=pj; return pj; }catch(e){ return null; }
}
function ensureProj4(){
  const pj=getProj4(); if(pj) return Promise.resolve(pj); if(proj4Promise) return proj4Promise;
  proj4Promise=new Promise(function(resolve,reject){
    try{ const s=document.createElement('script'); s.src='assets/vendor/proj4.js';
      s.onload=function(){ const g=typeof globalThis!=='undefined'?globalThis:window; if(g.proj4) resolve(g.proj4); else reject(new Error('proj4 missing'));};
      s.onerror=function(){ try{ const s2=document.createElement('script'); s2.src='../../vendor/proj4.js'; s2.onload=function(){ const g2=typeof globalThis!=='undefined'?globalThis:window; if(g2.proj4) resolve(g2.proj4); else reject(new Error('proj4 fail'));}; s2.onerror=function(){reject(new Error('proj4 load fail'));}; document.head.appendChild(s2);}catch(e){reject(e);} };
      document.head.appendChild(s);}catch(e){reject(e);} });
  return proj4Promise;
}
function getFromCache(k){ if(!coordCache.has(k)) return null; const v=coordCache.get(k); coordCache.delete(k); coordCache.set(k,v); return v; }
function setCache(k,v){ if(coordCache.has(k)) coordCache.delete(k); else if(coordCache.size>=MAX_CACHE_SIZE){ const oldest=coordCache.keys().next().value; coordCache.delete(oldest);} coordCache.set(k,v); }
export function isValidHK80(N,E){ if(N===''||N==null||N===undefined) return false; if(E===''||E==null||E===undefined) return false; const n=Number(N),e=Number(E); if(!Number.isFinite(n)||!Number.isFinite(e)) return false; return n>=HK80_BOUNDS.N[0]&&n<=HK80_BOUNDS.N[1]&&e>=HK80_BOUNDS.E[0]&&e<=HK80_BOUNDS.E[1]; }
export function isValidWGS84(lat,lng){ if(lat===''||lat==null||lat===undefined) return false; if(lng===''||lng==null||lng===undefined) return false; const la=Number(lat),ln=Number(lng); if(!Number.isFinite(la)||!Number.isFinite(ln)) return false; return la>=WGS84_BOUNDS.lat[0]&&la<=WGS84_BOUNDS.lat[1]&&ln>=WGS84_BOUNDS.lng[0]&&ln<=WGS84_BOUNDS.lng[1]; }
export const isValidHK80Range=isValidHK80; export const isValidWgs84HongKong=isValidWGS84;
export function format1(n){ return Number(n).toFixed(1); }
export function format5(n){ return Number(n).toFixed(5); }
let _warnedProj4 = false;
// 同步轉換若 proj4 未就緒：記警告（只記一次）並觸發非同步載入，令後續呼叫成功
function warnProj4Missing_(){
  if (_warnedProj4) return;
  _warnedProj4 = true;
  try { console.warn('[coordinates] proj4 尚未載入：同步轉換暫返回 null，已觸發非同步載入'); } catch(e){}
  try { ensureProj4().catch(function(){}); } catch(e){}
}
export function toHK80(lat,lng){
  if(lat===''||lat==null||lat===undefined) return null; if(lng===''||lng==null||lng===undefined) return null;
  const numLat=Number(lat),numLng=Number(lng); if(!Number.isFinite(numLat)||!Number.isFinite(numLng)) return null;
  const pj=getProj4(); if(!pj){ warnProj4Missing_(); return null; }
  const key='wgs2hk:'+numLat.toFixed(6)+','+numLng.toFixed(6); const c=getFromCache(key); if(c) return c;
  try{ const tr=initProj4(); if(!tr){ warnProj4Missing_(); return null; } let r; if(tr.forward) r=tr.forward([numLng,numLat]); else { const projs=getProjections(); r=pj(projs.WGS84,projs.HK80,[numLng,numLat]); } const out={N:r[1],E:r[0]}; setCache(key,out); return out; }catch(e){ return null; }
}
export function toWGS84(N,E){
  if(N===''||N==null||N===undefined) return null; if(E===''||E==null||E===undefined) return null;
  const numN=Number(N),numE=Number(E); if(!Number.isFinite(numN)||!Number.isFinite(numE)) return null;
  const pj=getProj4(); if(!pj){ warnProj4Missing_(); return null; }
  const key='hk2wgs:'+numN+','+numE; const c=getFromCache(key); if(c) return c;
  try{ const tr=initProj4(); if(!tr){ warnProj4Missing_(); return null; } let r; if(tr.inverse) r=tr.inverse([numE,numN]); else { const projs=getProjections(); r=tr(projs.HK80,projs.WGS84,[numE,numN]); } const out={lat:r[1],lng:r[0]}; setCache(key,out); return out; }catch(e){ return null; }
}
export const toHK=toHK80; export const toWGS=toWGS84;
export async function toHK80Async(lat,lng){
  if(lat===''||lat==null||lat===undefined) return null; if(lng===''||lng==null||lng===undefined) return null;
  const numLat=Number(lat),numLng=Number(lng); if(!Number.isFinite(numLat)||!Number.isFinite(numLng)) return null;
  const key='wgs2hk:'+numLat.toFixed(6)+','+numLng.toFixed(6); const c=getFromCache(key); if(c) return c;
  try{ const pj=await ensureProj4(); const projs=getProjections(); const r=pj(projs.WGS84,projs.HK80,[numLng,numLat]); const out={N:r[1],E:r[0]}; setCache(key,out); return out; }catch(e){ return null; }
}
export async function toWGS84Async(N,E){
  if(N===''||N==null||N===undefined) return null; if(E===''||E==null||E===undefined) return null;
  const numN=Number(N),numE=Number(E); if(!Number.isFinite(numN)||!Number.isFinite(numE)) return null;
  const key='hk2wgs:'+numN+','+numE; const c=getFromCache(key); if(c) return c;
  try{ const pj=await ensureProj4(); const projs=getProjections(); const r=pj(projs.HK80,projs.WGS84,[numE,numN]); const out={lat:r[1],lng:r[0]}; setCache(key,out); return out; }catch(e){ return null; }
}
export const toHKAsync=toHK80Async; export const toWGSAsync=toWGS84Async;
export function batchToHK80(coords){
  if(!coords||!coords.length) return []; const tr=initProj4(); const pj=getProj4(); const projs=getProjections();
  const res=new Array(coords.length);
  for(let i=0;i<coords.length;i++){ const c=coords[i]; const numLat=Number(c.lat),numLng=Number(c.lng); if(!Number.isFinite(numLat)||!Number.isFinite(numLng)){res[i]=null;continue;}
    const key='wgs2hk:'+numLat.toFixed(6)+','+numLng.toFixed(6); const hit=getFromCache(key); if(hit){res[i]=hit;continue;}
    if(tr&&pj){ try{ let r; if(tr.forward) r=tr.forward([numLng,numLat]); else r=pj(projs.WGS84,projs.HK80,[numLng,numLat]); const out={N:r[1],E:r[0]}; res[i]=out; setCache(key,out);}catch(e){res[i]=null;}} else res[i]=null;
  } return res;
}
export async function batchToHK80Async(coords){ if(!coords||!coords.length) return []; await ensureProj4(); return batchToHK80(coords); }
export function clearCache(){ coordCache.clear(); isPreheated=false; proj4Transform=null; }
export function getCacheStats(){ return { size:coordCache.size, maxSize:MAX_CACHE_SIZE, usagePercent:((coordCache.size/MAX_CACHE_SIZE)*100).toFixed(1)+'%' }; }
export function preheatCache(){
  if(isPreheated) return; const pj=getProj4(); if(!pj) return;
  [{lat:22.2783,lng:114.1748},{lat:22.2952,lng:114.1722},{lat:22.3167,lng:114.1833},{lat:22.35,lng:114.1833},{lat:22.4,lng:114.2}].forEach(function(p){ toHK80(p.lat,p.lng); });
  isPreheated=true;
}
try{ const g=typeof globalThis!=='undefined'?globalThis:null; if(g){
  g.CoordUtils={ toHK80,toWGS84,toHK:toHK80,toWGS:toWGS84,toHK80Async,toWGS84Async,toHKAsync:toHK80Async,toWGSAsync:toWGS84Async,batchToHK80,batchToHK80Async,isValidHK80,isValidWGS84,isValidHK80Range,isValidWgs84HongKong,format1,format5,clearCache,getCacheStats,preheatCache,PROJECTIONS,HK80_BOUNDS,WGS84_BOUNDS };
  if(!g.CoordLazy) g.CoordLazy={}; g.CoordLazy.toHK=toHK80Async; g.CoordLazy.toWGS=toWGS84Async; g.CoordLazy.toHK80Async=toHK80Async; g.CoordLazy.toWGS84Async=toWGS84Async; g.CoordLazy.toHK80=toHK80; g.CoordLazy.toWGS84=toWGS84;
}}catch(e){}

