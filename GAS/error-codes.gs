/* error-codes.gs - 對外一般錯誤碼統一出口 */
var ERROR_CODES_ = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_JSON: 'INVALID_JSON',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_LOCATION: 'INVALID_LOCATION',
  UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION',
  UNAUTHORIZED: 'UNAUTHORIZED',
  AUTH_FAILED: 'AUTH_FAILED',
  CSRF_INVALID: 'CSRF_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFLICT: 'CONFLICT',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  SYSTEM_BUSY: 'SYSTEM_BUSY',
  INTERNAL_READ_ERROR: 'INTERNAL_READ_ERROR',
  INTERNAL_WRITE_ERROR: 'INTERNAL_WRITE_ERROR'
};

/**
 * 對外統一錯誤回應：僅回傳一般錯誤碼，不外洩中文明文或 err.message
 * 內部原始訊息透過 console.error 保留於伺服器日誌
 */
function errJson_(code, details, extra){
  var payload = { ok: false, error_code: code, error: code };
  if(details && details.length) payload.details = details;
  if(extra && typeof extra === 'object'){
    for(var k in extra){ if(extra.hasOwnProperty(k) && k !== 'ok' && k !== 'error' && k !== 'error_code') payload[k]=extra[k]; }
  }
  return json_(payload);
}

function errJsonWithLog_(code, originalMessage, details){
  try { console.error('[' + code + '] ' + String(originalMessage || '')); } catch(e){}
  return errJson_(code, details);
}
