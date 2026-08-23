/* ---------- 密碼／Token 工具 ---------- */
function checkPassword_(pw){
  const correct = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if(!correct) return false;
  return String(pw || '') === correct;
}

function createToken_(){
  const token = Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,'');
  CacheService.getScriptCache().put('TOKEN_' + token, '1', TOKEN_EXPIRY_SECONDS);
  return token;
}

function isValidToken_(token){
  if(!token) return false;
  return CacheService.getScriptCache().get('TOKEN_' + token) === '1';
}

/* ---------- 登入 rate-limit（防暴力破解） ---------- */
function loginFailKey_(){
  try { return 'LOGIN_FAIL_' + Session.getTemporaryActiveUserKey(); }
  catch(e) { return 'LOGIN_FAIL_GLOBAL'; }
}

function loginFailed_(){
  const cache = CacheService.getScriptCache();
  const key = loginFailKey_();
  const fails = parseInt(cache.get(key) || '0', 10) + 1;
  cache.put(key, String(fails), LOGIN_LOCK_SECONDS);
}

function loginAllowed_(){
  const cache = CacheService.getScriptCache();
  return parseInt(cache.get(loginFailKey_()) || '0', 10) < LOGIN_MAX_FAILURES;
}

function resetLoginFailures_(){
  try {
    CacheService.getScriptCache().remove(loginFailKey_());
  } catch(e) {}
}