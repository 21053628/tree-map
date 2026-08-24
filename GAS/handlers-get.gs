function handleGetBootstrap_(p){
  p = p || {};
  var bypass = (String(p.nocache)==='1' || String(p.bust)==='1');
  if(bypass){ try{ cacheRemoveChunked_(BOOTSTRAP_CACHE_KEY); }catch(e){} try{ cacheRemoveChunked_(TREES_CACHE_KEY); }catch(e){} try{ cacheRemoveChunked_(PROJECTS_CACHE_KEY); }catch(e){} }
  const cache = CacheService.getScriptCache();
  // 🔥 [P0 修復] 改為分段快取：projects / trees 分別存入獨立 cache key，
  // 避免單一 bootstrap JSON 超過 GAS ScriptCache 100KB 上限時成個快取失效
  // 🔥 [P1 修復] 改用 cacheGetChunked_ 支援分片快取（>100KB 資料）
  var cachedProjects = null;
  var cachedTrees = null;
  try {
    var cp = cacheGetChunked_(PROJECTS_CACHE_KEY);
    if (cp !== null) cachedProjects = cp;
  } catch(e) {}
  try {
    var ct = cacheGetChunked_(TREES_CACHE_KEY);
    if (ct !== null) cachedTrees = ct;
  } catch(e) {}
  const cached = cache.get(BOOTSTRAP_CACHE_KEY);
  if(cached && !bypass){
    return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
  }
  // 兼容舊格式：若 bootstrap 快取已失效，但分段快取仍在，則用分段快取組裝
  if(!bypass && cachedProjects !== null && cachedTrees !== null){
    var projectsFromCache = null, treesFromCache = null;
    try{ projectsFromCache = JSON.parse(cachedProjects); }catch(e){}
    try{ treesFromCache = JSON.parse(cachedTrees); }catch(e){}
    if(projectsFromCache !== null && treesFromCache !== null){
      const payload = {ok:true, data: { projects: projectsFromCache, trees: treesFromCache }};
      const jsonStr = JSON.stringify(payload);
      console.log('📦 bootstrap (cached parts) size:', jsonStr.length, 'bytes');
      return ContentService.createTextOutput(jsonStr).setMimeType(ContentService.MimeType.JSON);
    }
  }
  const projects = rows_(SH_PRJ);
  const trees = rows_(SH_TREES);
  const payload = {ok:true, data: { projects: projects, trees: trees }};
  const jsonStr = JSON.stringify(payload);
  console.log('📦 bootstrap size:', jsonStr.length, 'bytes');
  // 分段寫入：每段遠低於 100KB 上限（projects 通常 <1KB；trees 即使大，獨立 cache 也較易命中）
  // 🔥 [P1 修復] 改用 cachePutChunked_ 支援大於 100KB 嘅 payload 分片快取
  cachePutChunked_(PROJECTS_CACHE_KEY, JSON.stringify(projects), BOOTSTRAP_CACHE_TTL);
  cachePutChunked_(TREES_CACHE_KEY, JSON.stringify(trees), BOOTSTRAP_CACHE_TTL);
  // 保留舊 bootstrap 快取（若未超上限仍可用），但唔再依賴佢
  if(jsonStr.length <= 100000){
    try { cache.put(BOOTSTRAP_CACHE_KEY, jsonStr, BOOTSTRAP_CACHE_TTL); }
    catch(e) { try{ console.warn('⚠️ 快取太大跳過（size=' + jsonStr.length + '）'); }catch(_){} }
  }
  return ContentService.createTextOutput(jsonStr).setMimeType(ContentService.MimeType.JSON);
}

function handleGetPing_(){
  return json_({ok:true, pong: Date.now()});
}

function handleGetTree_(p){
  var wantPrj = String(p.prj||'').trim();
  var wantId = String(p.id||'').trim();
  if(!wantId) return json_({ok:true, data: null});
  // 🔥 [P0 修復] 強制帶地盤參數，避免跨地盤回傳錯嘅樹木（tree_id 唔一定跨地盤唯一）
  if(!wantPrj) return json_({ok:true, data: null});
  const trees = getCachedRows_(SH_TREES, TREES_CACHE_KEY, CACHE_TTL);
  const list = trees.filter(function(r){ return String(r.tree_id||'').trim() === wantId; });
  const t = list.find(function(r){ return String(r.project_id||'').trim() === wantPrj; }) || null;
  return json_({ok:true, data: t});
}

function handleGetInspections_(p){
  var raw = getCachedRows_(SH_INS, INSPECTIONS_CACHE_KEY, (typeof INSPECTIONS_TTL!=='undefined'?INSPECTIONS_TTL:120));
  var wantId = String(p.id||'').trim();
  var wantPrj = String(p.prj||'').trim();
  var list = raw.filter(function(r){ return String(r.tree_id||'').trim() === wantId; });
  if(wantPrj){ list = list.filter(function(r){ return String(r.project_id||'').trim() === wantPrj; }); }
  // ---- 固定排序：time DESC, inspection_id ASC（穩定排序，同日多筆以 ID 打破平手）----
  list.sort(function(a,b){
    var ta = String(a.time || '');
    var tb = String(b.time || '');
    if(ta !== tb) return tb.localeCompare(ta);
    var ida = String(a.inspection_id || '');
    var idb = String(b.inspection_id || '');
    return ida.localeCompare(idb);
  });
  var hasCursor = p.cursor !== undefined && p.cursor !== null && String(p.cursor).trim() !== '';
  var hasLimit = p.limit !== undefined && p.limit !== null && String(p.limit).trim() !== '';
  // 相容：舊版不帶 cursor/limit 時回全量（維持既有前端可用）
  if(!hasCursor && !hasLimit){
    return json_({ok:true, data: list});
  }
  var limit = hasLimit ? parseInt(p.limit, 10) : 20;
  if(isNaN(limit) || limit <= 0) limit = 20;
  if(limit > 50) limit = 50;
  var start = 0;
  if(hasCursor){
    var cur = decodeCursor_(p.cursor);
    if(!cur){
      return typeof errJson_==='function' ? errJson_(ERROR_CODES_.VALIDATION_FAILED, [{field:'cursor', code:'INVALID_CURSOR'}]) : json_({ok:false, error_code:ERROR_CODES_.VALIDATION_FAILED, error:ERROR_CODES_.VALIDATION_FAILED, details:[{field:'cursor', code:'INVALID_CURSOR'}]});
    }
    var idx = -1;
    for(var i=0;i<list.length;i++){
      if(String(list[i].inspection_id)===String(cur.id) && String(list[i].time)===String(cur.t)){
        idx = i; break;
      }
    }
    if(idx===-1){
      for(var j=0;j<list.length;j++){ if(String(list[j].inspection_id)===String(cur.id)){ idx=j; break; } }
    }
    if(idx===-1){
      return typeof errJson_==='function' ? errJson_(ERROR_CODES_.VALIDATION_FAILED, [{field:'cursor', code:'INVALID_CURSOR'}]) : json_({ok:false, error_code:ERROR_CODES_.VALIDATION_FAILED, error:ERROR_CODES_.VALIDATION_FAILED, details:[{field:'cursor', code:'INVALID_CURSOR'}]});
    }
    start = idx + 1;
  }
  var page = list.slice(start, start + limit);
  var hasMore = (start + limit) < list.length;
  var nextCursor = null;
  if(hasMore && page.length>0){
    nextCursor = encodeCursor_(page[page.length-1]);
  }
  return json_({ok:true, data: page, pagination:{next_cursor: nextCursor, has_more: hasMore, limit: limit}});
}

function encodeCursor_(row){
  try{
    var payload = {t: String(row.time||''), id: String(row.inspection_id||'')};
    var json = JSON.stringify(payload);
    return Utilities.base64Encode(json, Utilities.Charset.UTF_8);
  } catch(e){ return null; }
}

function decodeCursor_(cursor){
  try{
    var s = String(cursor).trim();
    try{ s = decodeURIComponent(s); } catch(e2){}
    // base64url 相容：- -> +, _ -> /
    s = s.replace(/-/g,'+').replace(/_/g,'/');
    while(s.length % 4 !== 0) s += '=';
    var json = Utilities.newBlob(Utilities.base64Decode(s)).getDataAsString();
    var obj = JSON.parse(json);
    if(!obj || !obj.id) return null;
    return {t: String(obj.t||''), id: String(obj.id)};
  } catch(e){ return null; }
}

function handleGetProjects_(){
  const projects = getCachedRows_(SH_PRJ, PROJECTS_CACHE_KEY, CACHE_TTL);
  return json_({ok:true, data: projects});
}

function handleGetSpecies_(){
  // 預留：若尚未建立物種工作表，回空陣列並提示前端回退靜態 JSON
  try{
    if(typeof SH_SPECIES === 'undefined' || !SH_SPECIES) return json_({ok:true, data: []});
  }catch(e){ return json_({ok:true, data: []}); }
  try{
    var rows = getCachedRows_(SH_SPECIES, (typeof SPECIES_CACHE_KEY !== 'undefined' ? SPECIES_CACHE_KEY : 'species_all'), (typeof SPECIES_TTL !== 'undefined' ? SPECIES_TTL : 86400));
    // 僅保留 id/name 必要欄位，避免洩漏多餘欄
    if(rows && rows.length){
      rows = rows.map(function(r){ return {id: Number(r.id), name: String(r.name||'').trim()}; }).filter(function(x){ return x.name; });
    }
    return json_({ok:true, data: rows || []});
  }catch(e){
    console.warn('handleGetSpecies_ fallback:', e && e.message ? e.message : String(e));
    return json_({ok:true, data: []});
  }
}

function handleGetTrees_(p){
  var bypass = (String(p.nocache)==='1' || String(p.bust)==='1' || String(p.nocache)==='true');
  if(bypass){ try{ cacheRemoveChunked_(TREES_CACHE_KEY); }catch(e){} try{ cacheRemoveChunked_(BOOTSTRAP_CACHE_KEY); }catch(e){} }
  let trees = getCachedRows_(SH_TREES, TREES_CACHE_KEY, CACHE_TTL, {nocache: bypass?'1':''});
  var wantProject = p.project ? String(p.project).replace(/^\ufeff/, '').trim() : '';
  var wantLower = wantProject.toLowerCase();
  var before = trees.length;
  var distinctBefore=''; try{ distinctBefore=JSON.stringify([...new Set(trees.map(function(r){return String(r.project_id||'').replace(/^\ufeff/, '').trim();}))]).slice(0,300); }catch(e){ distinctBefore='err'; }
  if(wantProject){
    trees = trees.filter(function(t){ return String(t.project_id||'').replace(/^\ufeff/, '').trim().toLowerCase() === wantLower; });
    if(!trees.length && before>0){
      try{ console.warn('[handleGetTrees_] backend 0 for project='+wantProject+' lower='+wantLower+' rows='+before+' distinct='+distinctBefore); }catch(e){}
    } else {
      try{ console.log('[handleGetTrees_] project='+wantProject+' matched='+trees.length+'/'+before); }catch(e){}
    }
  }
  // ---- viewport / bbox 過濾（按需載入）----
  // 支援 ?bbox=south,west,north,east 或 ?south=&west=&north=&east=
  var south=null, west=null, north=null, east=null;
  if(p.bbox){
    var parts = String(p.bbox).split(',').map(function(v){ return Number(String(v).trim()); });
    if(parts.length===4 && parts.every(function(v){ return isFinite(v); })){
      south=parts[0]; west=parts[1]; north=parts[2]; east=parts[3];
    }
  } else if(p.south!==undefined && p.west!==undefined && p.north!==undefined && p.east!==undefined){
    south=Number(p.south); west=Number(p.west); north=Number(p.north); east=Number(p.east);
  }
  if(isFinite(south) && isFinite(west) && isFinite(north) && isFinite(east)){
    var sMin=Math.min(south,north), sMax=Math.max(south,north);
    var wMin=Math.min(west,east), wMax=Math.max(west,east);
    trees = trees.filter(function(t){
      var lat=+t.lat, lng=+t.lng;
      if(!lat || !lng || isNaN(lat) || isNaN(lng)) return false;
      return lat>=sMin && lat<=sMax && lng>=wMin && lng<=wMax;
    });
  }
  // 可選分頁（避免單次回傳過大）
  var limit = p.limit ? parseInt(p.limit,10) : 0;
  var offset = p.offset ? parseInt(p.offset,10) : 0;
  if(limit>0 && limit<=5000){
    if(offset<0) offset=0;
    trees = trees.slice(offset, offset+limit);
  }
  return json_({ok:true, data: trees});
}