/**
 * Species Repository - unified source for tree species
 * TTL 86400s, memoryTtl 3600000ms, snapshot 'species', backend GET ?action=species fallback to data/trees_data.json
 */
import { state } from './state.js';
import { CacheManager } from '../core/cache-manager.js';
import { CachePolicy } from '../core/cache-policy.js';
import { ApiService } from '../api.js';
import { TreeSnapshot } from '../../../offline.js';

let _cache = null;
let _mapById = new Map();
let _mapByLower = new Map();
let _promise = null;
let _loadedAt = 0;
const SNAP_KEY = 'species';
const STATIC_URL = 'data/trees_data.json';

function _resolveMemoryTtl(){
  try{
    if (CacheManager.resolveMemoryTtl) return CacheManager.resolveMemoryTtl('species');
    if (CachePolicy.getMemoryTtl) return CachePolicy.getMemoryTtl('species');
  }catch(e){}
  return 3600*1000;
}
function _isFresh(){ return _cache && _loadedAt && (Date.now()-_loadedAt < _resolveMemoryTtl()); }
function _syncState(list,prom){ try{ state.speciesCache=list; state.speciesPromise=prom||null; }catch(e){} }
function normalizeText(text){ return String(text||'').toLowerCase().normalize('NFKC').trim(); }
function tokenize(text){
  var s=normalizeText(text); if(!s) return [];
  // 🔥 [Bugfix] 支援 CJK 統一表意文字（U+4E00-9FFF）+ 擴展 A（U+3400-4DBF）+ 兼容表意文字（U+F900-FAFF）
  var raw=s.match(/[a-z0-9]+|[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+/g)||[];
  var out=[]; var seen=new Set();
  function add(tok){ if(!tok||seen.has(tok)) return; seen.add(tok); out.push(tok); }
  for(var i=0;i<raw.length;i++){
    var seg=raw[i];
    if(/^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+$/.test(seg)){
      add(seg);
      if(seg.length>=2){ for(var k=0;k<seg.length-1;k++) add(seg.slice(k,k+2)); if(seg.length<=4){ for(var k2=0;k2<seg.length;k2++) add(seg[k2]); } }
    } else { add(seg); }
  }
  return out;
}
function normalizeSpecies(raw){
  if(!raw||typeof raw!=='object') return null;
  var id=Number(raw.id); var name=String(raw.name||'').trim(); if(!name) return null;
  var lower=normalizeText(name);
  var tokens=tokenize(name.replace(/[()]/g,' ').replace(/\uFF08/g,' ').replace(/\uFF09/g,' '));
  return { id:isFinite(id)?id:0, name:name, _lower:lower, _tokens:tokens, _tokensSet:new Set(tokens) };
}
function buildIndexes(list){
  _mapById.clear(); _mapByLower.clear();
  for(var i=0;i<list.length;i++){ var sp=list[i]; if(sp.id!=null&&!_mapById.has(sp.id)) _mapById.set(sp.id,sp); if(sp._lower&&!_mapByLower.has(sp._lower)) _mapByLower.set(sp._lower,sp); }
}
function scoreSpecies(sp,qTokens){
  var score=0; var nameLower=sp._lower||normalizeText(sp.name); var first=qTokens[0]||'';
  if(first&&nameLower.startsWith(first)) score+=10;
  for(var i=0;i<qTokens.length;i++){ var qt=qTokens[i]; if(sp._tokensSet&&sp._tokensSet.has(qt)) score+=5; else if(sp._tokens&&sp._tokens.some(function(t){return t.startsWith(qt);} )) score+=2; else if(nameLower.includes(qt)) score+=1; }
  if(qTokens.length===1&&nameLower.includes(qTokens[0])) score+=3;
  return score;
}
function snapshotLoad(){
  try{ if(TreeSnapshot&&TreeSnapshot.load) return TreeSnapshot.load(SNAP_KEY); }catch(e){}
  return Promise.resolve(null);
}
function snapshotSave(list){
  try{ if(TreeSnapshot&&TreeSnapshot.save) TreeSnapshot.save(SNAP_KEY,list).catch(function(){}); }catch(e){}
}
async function fetchViaApi(){
  try{
    if(!ApiService||!ApiService.get) return null;
    var res=await ApiService.get('species');
    if(res&&Array.isArray(res.data)&&res.data.length) return res.data;
    if(Array.isArray(res)&&res.length) return res;
  }catch(e){}
  return null;
}
async function fetchStatic(){
  var r=await fetch(STATIC_URL);
  if(!r.ok) throw new Error('HTTP '+r.status);
  var j=await r.json();
  if(!Array.isArray(j)) throw new Error('invalid species payload');
  return j;
}
export async function load(opts){
  opts=opts||{}; var force=!!opts.force;
  if(!force&&_isFresh()) return _cache;
  if(!force&&_promise) return _promise;
  _promise=(async function(){
    var snapshotList=null;
    if(!force){
      try{ snapshotList=await snapshotLoad(); }catch(e){}
      if(Array.isArray(snapshotList)&&snapshotList.length){
        var normSnap=snapshotList.map(normalizeSpecies).filter(Boolean);
        if(normSnap.length){
          _cache=normSnap; _loadedAt=Date.now(); buildIndexes(_cache); _syncState(_cache,_promise);
          (async function bg(){
            try{ var fresh=await fetchViaApi(); if(!fresh) fresh=await fetchStatic(); var norm=fresh.map(normalizeSpecies).filter(Boolean); _cache=norm; buildIndexes(_cache); _loadedAt=Date.now(); _syncState(_cache,null); snapshotSave(_cache); console.log('species bg refresh:'+_cache.length); }catch(e){}
          })();
          return _cache;
        }
      }
    }
    var raw=null;
    try{ raw=await fetchViaApi(); }catch(e){}
    if(!raw) raw=await fetchStatic();
    var list=raw.map(normalizeSpecies).filter(Boolean);
    _cache=list; _loadedAt=Date.now(); buildIndexes(_cache); _syncState(_cache,null); snapshotSave(_cache);
    console.log('species loaded:'+_cache.length);
    return _cache;
  })().catch(function(err){
    console.error('load species failed:',err); _promise=null;
    return snapshotLoad().then(function(snap){
      if(Array.isArray(snap)&&snap.length){ var norm=snap.map(normalizeSpecies).filter(Boolean); _cache=norm; buildIndexes(_cache); _loadedAt=Date.now(); _syncState(_cache,null); return _cache; }
      return [];
    }).catch(function(){ return []; });
  });
  var p=_promise; _syncState(_cache,p);
  p.then(function(){ if(_promise===p) _promise=null; }).catch(function(){ if(_promise===p) _promise=null; });
  return p;
}
export function getAll(){ return _cache? _cache.slice():[]; }
export function whenReady(){ return load(); }
export function getById(id){ if(_mapById.size===0&&_cache) buildIndexes(_cache); return _mapById.get(Number(id))||null; }
export function getByName(name){ if(!_cache) return null; if(_mapByLower.size===0) buildIndexes(_cache); return _mapByLower.get(normalizeText(name))||null; }
export function search(query,opts){
  opts=opts||{}; var limit=opts.limit||30;
  if(!_cache||!_cache.length) return [];
  var qTokens=tokenize(query); if(!qTokens.length) return [];
  var scored=[];
  for(var i=0;i<_cache.length;i++){ var s=scoreSpecies(_cache[i],qTokens); if(s>0) scored.push({sp:_cache[i],s:s}); }
  scored.sort(function(a,b){return b.s-a.s;});
  var out=[];
  for(var i2=0;i2<scored.length&&out.length<limit;i2++) out.push(scored[i2].sp);
  if(!out.length){ var qLower=normalizeText(query); for(var j=0;j<_cache.length;j++){ var sp=_cache[j]; if((sp._lower&&sp._lower.includes(qLower))||String(sp.name).toLowerCase().includes(qLower)){ out.push(sp); if(out.length>=limit) break; } } }
  return out;
}
export function fillDatalist(datalistId){
  var id=datalistId||'tree_datalist'; var dataList=document.getElementById(id); if(!dataList) return;
  var src=_cache||state.speciesCache||[]; var frag=document.createDocumentFragment();
  for(var i=0;i<src.length;i++){ var opt=document.createElement('option'); opt.value=src[i].name; frag.appendChild(opt); }
  dataList.textContent=''; dataList.appendChild(frag);
}
export async function refresh(opts){ opts=opts||{}; opts.force=true; return load(opts); }
export function clear(){
  _cache=null; _mapById.clear(); _mapByLower.clear(); _loadedAt=0; _promise=null; _syncState(null,null);
  try{
    if (TreeSnapshot) { if (TreeSnapshot.remove) TreeSnapshot.remove(SNAP_KEY).catch(function(){}); else if (TreeSnapshot.save) TreeSnapshot.save(SNAP_KEY,[]).catch(function(){}); }
    if (CacheManager.notifySwInvalidate) CacheManager.notifySwInvalidate('species');
    if (ApiService.clearCache) { try { ApiService.clearCache(); } catch (e2) {} }
  }catch(e){}
}
export function getStats(){ return { count:_cache?_cache.length:0, loadedAt:_loadedAt, fresh:_isFresh(), hasPromise:!!_promise }; }
export const SpeciesRepository={ load:load, whenReady:whenReady, getAll:getAll, getById:getById, getByName:getByName, search:search, fillDatalist:fillDatalist, refresh:refresh, clear:clear, getStats:getStats, tokenize:tokenize, normalizeText:normalizeText };
export function loadTreeSpecies(opts){ return load(opts); }
export function fillSpeciesDatalist(id){ return fillDatalist(id); }
export default SpeciesRepository;

