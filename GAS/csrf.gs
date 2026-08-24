/* ---------- CSRF Token 工具（同步器模式：每次成功使用後旋轉，防止重放攻擊） ---------- */
function issueCsrfToken_(sessionToken){
  const token = Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,'');
  CacheService.getScriptCache().put('CSRF_' + token, String(sessionToken || ''), CSRF_EXPIRY_SECONDS);
  return token;
}

/**
 * 唯讀檢查 CSRF Token（不消耗，供失敗分支保留 token，避免用戶被鎖）
 */
function isValidCsrfToken_(csrfToken, sessionToken){
  if(!csrfToken || !sessionToken) return false;
  const cache = CacheService.getScriptCache();
  return cache.get('CSRF_' + csrfToken) === String(sessionToken);
}

/**
 * 原名：isValidCsrfToken_ 同義（向後相容）
 */
function peekCsrfToken_(csrfToken, sessionToken){
  return isValidCsrfToken_(csrfToken, sessionToken);
}

/**
 * 🔥 [P0 修復] 校驗並旋轉 CSRF Token（one-time token）
 * 成功時刪除舊 token 並簽發新 token，回傳新 token；
 * 失敗時回傳 null（舊 token 不存在或不匹配）
 */
function rotateCsrfToken_(csrfToken, sessionToken){
  if(!peekCsrfToken_(csrfToken, sessionToken)) return null;
  const cache = CacheService.getScriptCache();
  cache.remove('CSRF_' + csrfToken);
  return issueCsrfToken_(sessionToken);
}

// Apps Script 無法讀取自訂 HTTP Header，故 CSRF Token 以 JSON body 為主、query 參數為輔
function getCsrfTokenFromRequest_(e, d){
  if(d && d.csrf_token) return String(d.csrf_token);
  if(e && e.parameter){
    if(e.parameter['X-CSRF-Token']) return String(e.parameter['X-CSRF-Token']);
    if(e.parameter['csrf_token']) return String(e.parameter['csrf_token']);
  }
  return '';
}

/**
 * 🔥 [P0 修復] 清理孤兒相片：當 create_tree 鎖內失敗時，刪除已上傳到 Drive 嘅相片
 * 從 lh3.googleusercontent.com/d/<fileId>=w1200 格式提取 fileId
 */
function deleteDriveFilesByUrls_(urls){
  if(!urls || !urls.length) return;
  for(var i=0; i<urls.length; i++){
    try{
      var url = String(urls[i] || '');
      var m = url.match(/\/d\/([^/=?]+)/);
      if(m && m[1]){
        var fileId = m[1];
        try{ DriveApp.getFileById(fileId).setTrashed(true); }catch(e){}
      }
    }catch(e){}
  }
}