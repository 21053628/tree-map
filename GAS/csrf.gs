/* ---------- CSRF Token 工具（同步器模式：後端發行、前端從 body 回傳） ---------- */
function issueCsrfToken_(sessionToken){
  const token = Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,'');
  CacheService.getScriptCache().put('CSRF_' + token, String(sessionToken || ''), CSRF_EXPIRY_SECONDS);
  return token;
}

function isValidCsrfToken_(csrfToken, sessionToken){
  if(!csrfToken || !sessionToken) return false;
  const cache = CacheService.getScriptCache();
  return cache.get('CSRF_' + csrfToken) === String(sessionToken);
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