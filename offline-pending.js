/**
 * 離線頁面 — 按鈕綁定 + 待同步記錄計數器
 * 從 IndexedDB outbox 讀取 pending/failed 記錄數，顯示在頁面底部
 */
(function(){
  'use strict';
  // 🔥 [CSP 相容] 按鈕事件改由 JS 綁定，避免 inline onclick 被 CSP script-src 阻擋
  var btnRetry = document.getElementById('btnRetry');
  if (btnRetry) btnRetry.addEventListener('click', function(){ location.reload(); });
  var btnHome = document.getElementById('btnHome');
  if (btnHome) btnHome.addEventListener('click', function(){ location.href = './index.html'; });

  try{
    var req=indexedDB.open('tree-offline');
    req.onsuccess=function(e){
      try{
        var db=e.target.result;
        if(!db.objectStoreNames.contains('outbox')) return;
        var tx=db.transaction('outbox','readonly');
        var store=tx.objectStore('outbox');
        var all=store.getAll();
        all.onsuccess=function(){
          var list=all.result||[];
          var pending=list.filter(function(r){return r.status==='queued'||r.status==='syncing';}).length;
          var failed=list.filter(function(r){return r.status==='failed';}).length;
          var el=document.getElementById('pendingInfo');
          if(pending||failed) el.textContent='待同步：'+pending+' 筆'+(failed?'（失敗 '+failed+' 筆可重試）':'');
        };
      }catch(_e){}
    };
  }catch(_e){}
})();