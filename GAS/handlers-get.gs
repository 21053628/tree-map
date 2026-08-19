function handleGetBootstrap_(){
  const cache = CacheService.getScriptCache();
  const cached = cache.get(BOOTSTRAP_CACHE_KEY);
  if(cached){
    return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
  }
  const payload = {ok:true, data: { projects: rows_(SH_PRJ), trees: rows_(SH_TREES) }};
  const jsonStr = JSON.stringify(payload);
  try { cache.put(BOOTSTRAP_CACHE_KEY, jsonStr, BOOTSTRAP_CACHE_TTL); }
  catch(e) { console.warn('⚠️ 快取太大，跳過'); }
  return ContentService.createTextOutput(jsonStr).setMimeType(ContentService.MimeType.JSON);
}

function handleGetPing_(){
  return json_({ok:true, pong: Date.now()});
}

function handleGetTree_(p){
  const trees = getCachedRows_(SH_TREES, TREES_CACHE_KEY, CACHE_TTL);
  const list = trees.filter(r => String(r.tree_id) === p.id);
  let t = null;
  if(p.prj){ t = list.find(r => String(r.project_id||'') === p.prj) || null; }
  if(!t) t = list[0] || null;
  return json_({ok:true, data: t});
}

function handleGetInspections_(p){
  let list = getCachedRows_(SH_INS, INSPECTIONS_CACHE_KEY, CACHE_TTL).filter(r => String(r.tree_id) === p.id);
  if(p.prj){ list = list.filter(r => String(r.project_id||'') === p.prj); }
  return json_({ok:true, data: list});
}

function handleGetProjects_(){
  const projects = getCachedRows_(SH_PRJ, PROJECTS_CACHE_KEY, CACHE_TTL);
  return json_({ok:true, data: projects});
}

function handleGetTrees_(p){
  let trees = getCachedRows_(SH_TREES, TREES_CACHE_KEY, CACHE_TTL);
  if(p.project){ trees = trees.filter(t => String(t.project_id) === p.project); }
  return json_({ok:true, data: trees});
}