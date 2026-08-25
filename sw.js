/* 樹木管理系統 - Service Worker v2.0.0-esm (PWA 離線策略重構，ESM 遷移版)
 * 方案 A - 手寫 Vanilla，無 Workbox
 * SSOT: ESM import 讀 CachePolicy.getSwMaxAge
 * 五桶: precache/runtime/data/tiles/images LRU+quota
 * 導航精準殼 + navigationPreload, 接管由前端 SKIP_WAITING
 */
import { CachePolicy } from './assets/js/core/cache-policy.js';
const VERSION = '2.0.0-esm';
const PRECACHE_NAME = 'precache-' + VERSION;
const RUNTIME_CACHE = 'runtime-' + VERSION;
const DATA_CACHE = 'data-' + VERSION;
const TILE_CACHE = 'tiles-' + VERSION;
const IMG_CACHE = 'images-' + VERSION;
const ALL_CURRENT_CACHES = [PRECACHE_NAME, RUNTIME_CACHE, DATA_CACHE, TILE_CACHE, IMG_CACHE];
const OLD_PREFIXES = ['static-', 'runtime-', 'tiles-', 'data-', 'img-', 'precache-', 'images-'];
const TILE_MAX = 800; const TILE_MAX_AGE = 7*24*60*60*1000;
const IMG_MAX = 300; const IMG_MAX_AGE = 30*24*60*60*1000;
const RUNTIME_MAX = 120; const RUNTIME_MAX_AGE = 30*24*60*60*1000;
const DATA_MAX_ENTRIES = 200;
const PRECACHE = [
  './','./index.html','./offline.html','./t.html','./nfc.html',
  './manifest.webmanifest','./offline.js','./offline-pending.js',
  './assets/js/core/cache-policy.js','./assets/js/core/cache-manager.js','./assets/js/core/error-codes.js','./assets/js/core/coordinates.js','./assets/js/core/spatial-index.js',
  './assets/js/modules/sync-panel.js','./assets/js/modules/audit-log.js',
  './assets/css/tokens.css','./assets/css/base.css','./assets/css/layout.css',
  './assets/css/map.css','./assets/css/ui.css','./assets/css/responsive.css',
  './assets/css/dark.css','./assets/css/filters.css','./assets/css/gis.css',
  './assets/css/performance.css','./assets/css/skeleton.css','./assets/css/animations.css','./assets/css/utilities.css',
  './assets/css/pages/t.css','./assets/css/pages/nfc.css',
  './assets/js/env.js','./assets/js/sw-register.js',
  './assets/js/ui-progress.js','./assets/js/ui-icons.js',
  './assets/js/config.js',
  './assets/js/api.js','./assets/js/auth.js','./assets/js/app.js',
  './assets/js/core/utils.js','./assets/js/core/event-bus.js',
  './assets/js/modules/state.js','./assets/js/modules/ui-state.js','./assets/js/modules/dom.js',
  './assets/js/modules/map.js','./assets/js/modules/search.js','./assets/js/modules/species.js',
  './assets/js/modules/trees.js','./assets/js/modules/filters.js','./assets/js/modules/projects.js',
  './assets/js/modules/locate.js','./assets/js/modules/lots.js','./assets/js/modules/forms.js',
  './assets/js/modules/draw.js','./assets/js/modules/geolocate.js','./assets/js/modules/loader.js',
  './assets/js/pages/nfc.js','./assets/js/pages/t.js',
  './assets/js/pages/tree-detail/page.js','./assets/js/pages/tree-detail/view.js',
  './assets/js/pages/tree-detail/route.js','./assets/js/pages/tree-detail/tabs.js',
  './assets/js/pages/tree-detail/auth-gate.js','./assets/js/pages/tree-detail/inspection-controller.js',
  './assets/js/pages/tree-detail/tree-edit-controller.js','./assets/js/pages/tree-detail/photo-controller.js',
  './assets/js/pages/tree-detail/nfc-navigation.js',
  './assets/js/pages/tree-detail/td-utils.js','./assets/js/pages/tree-detail/td-photos.js',
  './assets/js/pages/tree-detail/td-logs.js',
  './assets/vendor/leaflet.css','./assets/vendor/leaflet.js',
  './assets/vendor/leaflet.markercluster.js','./assets/vendor/MarkerCluster.css',
  './assets/vendor/MarkerCluster.Default.css','./assets/vendor/proj4.js','./assets/vendor/purify.min.js',
  './data/trees_data.json','./icons/icon.svg','./icons/icon-180.png','./icons/icon-192.png','./icons/icon-512.png'
];
function normalizeImgUrl(url){ if(!url) return url; return url.replace(/=([wsh]\d+.*)$/i,'').replace(/=[wsh]\d+(-c)?$/g,''); }
function cacheWithTimestamp(cache,req,res){
  if(res.type==='opaque'||res.status===0) return cache.put(req,res).catch(function(){});
  var headers=new Headers(res.headers); headers.set('x-sw-cached-at',String(Date.now()));
  return res.blob().then(function(blob){ var nr=new Response(blob,{status:res.status,statusText:res.statusText,headers:headers}); return cache.put(req,nr); }).catch(function(){});
}
function isCacheFresh(res,maxAge){
  if(!res) return false;
  var d=res.headers.get('date'); if(d){ var ms=Date.parse(d); if(!isNaN(ms)) return (Date.now()-ms)<maxAge; }
  var ca=res.headers.get('x-sw-cached-at'); if(!ca) return true; return (Date.now()-parseInt(ca,10))<maxAge;
}
function getSwMaxAgeForRequest(req){
  try{ var u=new URL(req.url); var act=(u.searchParams.get('action')||'').toLowerCase();
    if(act==='trees'&&(u.searchParams.has('bbox')||u.searchParams.has('south'))) act='viewport';
    if(typeof CachePolicy!=='undefined'&&CachePolicy.getSwMaxAge) return CachePolicy.getSwMaxAge(act);
  }catch(e){} return 600000;
}
function fetchWithAbort(req,timeout){
  return new Promise(function(resolve,reject){
    var ctrl=(typeof AbortController!=='undefined')?new AbortController():null;
    var sig=ctrl?ctrl.signal:null;
    var timer=setTimeout(function(){ if(ctrl) ctrl.abort(); reject(new Error('TIMEOUT')); },timeout);
    var opts={}; if(sig) opts.signal=sig;
    fetch(req,opts).then(function(res){ clearTimeout(timer); resolve(res); }).catch(function(err){ clearTimeout(timer); if(err&&err.name==='AbortError') reject(new Error('TIMEOUT')); else reject(err); });
  });
}
function trimCacheLRU(cacheName,maxEntries,maxAge){
  return caches.open(cacheName).then(function(cache){
    return cache.keys().then(function(keys){
      if(keys.length<=maxEntries&&!maxAge) return;
      return Promise.all(keys.map(function(req){ return cache.match(req).then(function(res){
        var ts=0; if(res){ var h=res.headers.get('x-sw-cached-at'); if(h) ts=parseInt(h,10)||0; else{ var d=res.headers.get('date'); if(d) ts=Date.parse(d)||0; } } return {req:req,ts:ts};
      }); })).then(function(entries){
        var now=Date.now(); var toDelete=[];
        if(maxAge) entries.forEach(function(e){ if(e.ts&&(now-e.ts)>maxAge) toDelete.push(e.req); });
        if(entries.length-toDelete.length>maxEntries){
          var rem=entries.filter(function(e){ return toDelete.indexOf(e.req)===-1; }); rem.sort(function(a,b){ return a.ts-b.ts; });
          var extra=rem.length-maxEntries; for(var i=0;i<extra;i++) toDelete.push(rem[i].req);
        }
        if(toDelete.length===0) return; return Promise.all(toDelete.map(function(r){ return cache.delete(r); }));
      });
    });
  }).catch(function(){});
}
function checkQuotaAndShrink(){
  try{ if(navigator.storage&&navigator.storage.estimate){
    navigator.storage.estimate().then(function(est){
      if(!est||!est.usage||!est.quota) return;
      if(est.usage/est.quota>0.8){ trimCacheLRU(TILE_CACHE,Math.floor(TILE_MAX*0.5),TILE_MAX_AGE).catch(function(){}); trimCacheLRU(IMG_CACHE,Math.floor(IMG_MAX*0.5),IMG_MAX_AGE).catch(function(){}); }
    }).catch(function(){});
  }}catch(e){}
}
function handleInvalidateDataCache(type,payload){
  var map={'inspection':['action=inspections','action=trees','action=bootstrap'],'inspection_photo':['action=inspections','action=trees','action=bootstrap'],'checkin':['action=inspections','action=trees','action=bootstrap'],'create_tree':['action=trees','action=bootstrap'],'update_tree':['action=trees','action=bootstrap'],'delete_tree':['action=trees','action=bootstrap'],'create_project':['action=projects'],'update_project':['action=projects','action=trees','action=bootstrap'],'delete_project':['action=projects','action=trees','action=bootstrap'],'create_aerial':['action=aerials'],'sync':['action=trees','action=projects','action=inspections','action=bootstrap']};
  var needles=map[type]||['action=trees','action=projects','action=inspections','action=bootstrap'];
  var pid=payload&&(payload.project_id||payload.prj)?String(payload.project_id||payload.prj):'';
  return caches.open(DATA_CACHE).then(function(c){ return c.keys().then(function(keys){
    var dels=keys.filter(function(req){
      var url=req.url||''; var hit=needles.some(function(n){ return url.indexOf(n)!==-1; }); if(!hit) return false;
      if(pid&&url.indexOf('action=trees')!==-1){ try{ var u=new URL(url); var p=u.searchParams.get('project')||u.searchParams.get('prj')||''; if(p&&p!==pid) return false; }catch(e){} }
      return true;
    }).map(function(req){ return c.delete(req); });
    return Promise.all(dels);
  }); }).catch(function(){});
}
self.addEventListener('install',function(e){
  e.waitUntil(caches.open(PRECACHE_NAME).then(function(cache){
    return Promise.allSettled(PRECACHE.map(function(url){ return cache.add(url); }));
  }).then(function(results){
    var rej=results.filter(function(r){ return r.status==='rejected'; });
    if(rej.length) console.warn('[SW] precache '+rej.length+' failed',rej); else console.log('[SW] precache ok '+PRECACHE.length);
  }));
});
self.addEventListener('activate',function(e){
  e.waitUntil((async function(){
    if('navigationPreload' in self.registration){ try{ await self.registration.navigationPreload.enable(); }catch(err){} }
    var keys=await caches.keys();
    await Promise.all(keys.map(function(k){ if(ALL_CURRENT_CACHES.indexOf(k)!==-1) return; if(OLD_PREFIXES.some(function(p){ return k.indexOf(p)===0; })) return caches.delete(k); }));
    await self.clients.claim();
    console.log('[SW] claimed '+VERSION);
  })());
});
self.addEventListener('sync',function(e){
  if(e.tag==='sync-outbox') e.waitUntil(self.clients.matchAll().then(function(clients){ clients.forEach(function(c){ c.postMessage({type:'SYNC_OUTBOX'}); }); }));
});
self.addEventListener('message',function(e){
  if(e.data&&e.data.type==='SKIP_WAITING'){ self.skipWaiting(); return; }
  if(e.data&&e.data.type==='GET_VERSION'){ if(e.ports&&e.ports[0]) e.ports[0].postMessage({version:VERSION}); return; }
  if(e.data&&e.data.type==='CLEAR_CACHE'){ e.waitUntil(caches.keys().then(function(keys){ return Promise.all(keys.map(function(k){ return caches.delete(k); })); }).then(function(){ if(e.ports&&e.ports[0]) e.ports[0].postMessage({ok:true}); })); return; }
  if(e.data&&e.data.type==='REGISTER_BG_SYNC'){ if('sync' in self.registration) self.registration.sync.register('sync-outbox').catch(function(){}); return; }
  if(e.data&&e.data.type==='INVALIDATE_DATA_CACHE'){ var t=e.data.invalidateType||e.data.invalidate_type||'sync'; e.waitUntil(handleInvalidateDataCache(t,e.data.payload||null)); return; }
});
function isApiRequest(url){ if(url.hostname.indexOf('script.google.com')!==-1) return true; if(url.pathname.indexOf('/api/')!==-1) return true; return false; }
function isTileRequest(url){ return url.hostname.indexOf('geodata.gov.hk')!==-1||url.hostname.indexOf('tile.openstreetmap.org')!==-1||url.hostname.indexOf('arcgisonline.com')!==-1||url.hostname.indexOf('opentopomap.org')!==-1; }
function isImageRequest(url){ if(url.hostname==='script.googleusercontent.com'&&url.pathname==='/macros/echo') return false; return url.hostname.indexOf('googleusercontent.com')!==-1||url.hostname.indexOf('drive.google.com')!==-1||url.hostname.indexOf('drive.usercontent.google.com')!==-1; }
function isEnvConfigRequest(url){ try{ return url.pathname.indexOf('/assets/js/env.js')!==-1||url.pathname.indexOf('assets/js/env.js')!==-1; }catch(e){ return false; } }
function handleNavigation(req){
  return fetchWithAbort(req,3500).then(function(res){
    if(res.ok){ var c=res.clone(); caches.open(PRECACHE_NAME).then(function(cache){ cacheWithTimestamp(cache,req,c); }).catch(function(){}); }
    return res;
  }).catch(function(){
    return caches.match(req).then(function(cached){
      if(cached) return cached;
      try{ var url=new URL(req.url); var p=url.pathname; if(p.indexOf('/t.html')!==-1) return caches.match('./t.html'); if(p.indexOf('/nfc.html')!==-1) return caches.match('./nfc.html'); if(p.indexOf('/offline.html')!==-1) return caches.match('./offline.html'); }catch(e){}
      return caches.match('./index.html').then(function(shell){ return shell||caches.match('./offline.html').then(function(off){ return off||Response.error(); }); });
    });
  });
}
function handleApi(req){
  var maxAge=getSwMaxAgeForRequest(req);
  var isBypass=false; try{ var u=new URL(req.url); isBypass = u.searchParams.get('nocache')==='1' || u.searchParams.get('bust')==='1'; }catch(e){}
  // 🔥 [Bugfix] API 請求超時由 12s 提升至 30s：與前端 api.js 的 BACKGROUND_TIMEOUT (30s) 對齊，
  // 避免 GAS 冷啟動（可達 20-25s）時 SW 提前回 OFFLINE，令前端誤判離線而回退陳舊快取。
  var API_TIMEOUT = 30000;
  // nocache=1 -> network-only, do not serve stale DATA_CACHE
  if(isBypass){
    return fetchWithAbort(req,API_TIMEOUT).then(function(res){
      var ct=''; try{ ct=res.headers.get('content-type')||''; }catch(e){}
      if(ct.indexOf('text/html')!==-1){ console.warn('[SW] API_HTML_RESPONSE bypass, not caching '+req.url); return res; }
      if(res.ok){ var c=res.clone(); caches.open(DATA_CACHE).then(function(cache){ cacheWithTimestamp(cache,req,c).catch(function(){}); }).catch(function(){}); }
      return res;
    }).catch(function(){
      return new Response(JSON.stringify({ok:false,error:'OFFLINE',offline:true}),{headers:{'Content-Type':'application/json'},status:503,statusText:'Offline'});
    });
  }
  return fetchWithAbort(req,API_TIMEOUT).then(function(res){
    var ct=''; try{ ct=res.headers.get('content-type')||''; }catch(e){}
    if(ct.indexOf('text/html')!==-1){ console.warn('[SW] API_HTML_RESPONSE not caching '+req.url+' hint: use /exec without /u/N/'); return res; }
    if(res.ok){ var c=res.clone(); caches.open(DATA_CACHE).then(function(cache){ cacheWithTimestamp(cache,req,c).then(function(){ return trimCacheLRU(DATA_CACHE,DATA_MAX_ENTRIES,null); }).catch(function(){}); }).catch(function(){}); checkQuotaAndShrink(); }
    return res;
  }).catch(function(){
    return caches.match(req).then(function(cached){
      if(cached){ if(!isCacheFresh(cached,maxAge)) console.log('[SW] API stale '+req.url); return cached; }
      return new Response(JSON.stringify({ok:false,error:'OFFLINE',offline:true}),{headers:{'Content-Type':'application/json'},status:503,statusText:'Offline'});
    });
  });
}
function handleTiles(req){
  return caches.match(req).then(function(cached){
    if(cached&&isCacheFresh(cached,TILE_MAX_AGE)) return cached;
    if(cached){ fetch(req).then(function(res){ if(res.ok){ var c=res.clone(); caches.open(TILE_CACHE).then(function(cache){ cacheWithTimestamp(cache,req,c).then(function(){ return trimCacheLRU(TILE_CACHE,TILE_MAX,TILE_MAX_AGE); }).catch(function(){}); }).catch(function(){}); } }).catch(function(){}); return cached; }
    return fetch(req).then(function(res){ if(res.ok){ var c=res.clone(); caches.open(TILE_CACHE).then(function(cache){ cacheWithTimestamp(cache,req,c).then(function(){ return trimCacheLRU(TILE_CACHE,TILE_MAX,TILE_MAX_AGE); }).catch(function(){}); }).catch(function(){}); } return res; });
  });
}
function handleImages(req){
  var nUrl=normalizeImgUrl(req.url);
  return caches.match(nUrl).then(function(cached){
    if(cached&&isCacheFresh(cached,IMG_MAX_AGE)) return cached;
    if(cached){ fetch(req).then(function(res){ if(res.ok){ var c=res.clone(); caches.open(IMG_CACHE).then(function(cache){ cacheWithTimestamp(cache,nUrl,c).then(function(){ return trimCacheLRU(IMG_CACHE,IMG_MAX,IMG_MAX_AGE); }).catch(function(){}); }).catch(function(){}); } }).catch(function(){}); return cached; }
    return caches.match(req).then(function(c2){
      if(c2&&isCacheFresh(c2,IMG_MAX_AGE)) return c2;
      return fetch(req).then(function(res){ if(res.ok){ var c=res.clone(); caches.open(IMG_CACHE).then(function(cache){ cacheWithTimestamp(cache,nUrl,c).then(function(){ return trimCacheLRU(IMG_CACHE,IMG_MAX,IMG_MAX_AGE); }).catch(function(){}); }).catch(function(){}); checkQuotaAndShrink(); } return res; });
    });
  });
}
function handleStaticSWR(req){
  return caches.match(req).then(function(cached){
    var fp=fetch(req).then(function(res){
      if(res.ok||res.type==='opaque'){ var c=res.clone(); caches.open(RUNTIME_CACHE).then(function(cache){
        caches.match(req,{cacheName:PRECACHE_NAME}).then(function(inPre){ if(inPre) return; cacheWithTimestamp(cache,req,c).then(function(){ return trimCacheLRU(RUNTIME_CACHE,RUNTIME_MAX,RUNTIME_MAX_AGE); }).catch(function(){}); }).catch(function(){ cacheWithTimestamp(cache,req,c).catch(function(){}); });
      }).catch(function(){}); }
      return res;
    }).catch(function(){
      // 🔥 [P1 修復] fetch 失敗時回傳 cached（即使過期都好過錯誤頁面）；
      // 若兩者都無，回傳離線 fallback 頁面而非 Response.error()
      if(cached) return cached;
      return caches.match('./offline.html').then(function(fb){ return fb||Response.error(); });
    });
    return cached||fp;
  });
}
function handleEnvConfig(req){
  return fetchWithAbort(req,5000).then(function(res){ if(res.ok){ var c=res.clone(); caches.open(RUNTIME_CACHE).then(function(cache){ cacheWithTimestamp(cache,req,c); }).catch(function(){}); } return res; }).catch(function(){ return caches.match(req).then(function(c){ return c||Response.error(); }); });
}
self.addEventListener('fetch',function(e){
  var req=e.request; if(req.method!=='GET') return; if(req.headers.has('range')) return;
  var url; try{ url=new URL(req.url); }catch(err){ return; }
  if(isEnvConfigRequest(url)){ e.respondWith(handleEnvConfig(req)); return; }
  if(req.mode==='navigate'){
    e.respondWith((e.preloadResponse?Promise.resolve(e.preloadResponse):Promise.resolve(null)).then(function(pre){
      if(pre){ var c=pre.clone(); caches.open(PRECACHE_NAME).then(function(cache){ cacheWithTimestamp(cache,req,c); }).catch(function(){}); return pre; }
      return handleNavigation(req);
    }).catch(function(){ return handleNavigation(req); }));
    return;
  }
  if(isApiRequest(url)){ e.respondWith(handleApi(req)); return; }
  if(isTileRequest(url)){ e.respondWith(handleTiles(req)); return; }
  if(isImageRequest(url)){ e.respondWith(handleImages(req)); return; }
  e.respondWith(handleStaticSWR(req));
});



