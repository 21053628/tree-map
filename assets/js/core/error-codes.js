/**
 * core/error-codes.js - 對外一般錯誤碼 → 使用者提示 對照表（ES Module）
 */

const M = {
  INVALID_REQUEST: '請求格式不正確，請稍後再試',
  INVALID_JSON: '請求格式不正確，請稍後再試',
  VALIDATION_FAILED: '資料驗證失敗，請檢查輸入後再試',
  INVALID_LOCATION: '位置超出香港範圍，請檢查座標後再試',
  UNSUPPORTED_OPERATION: '不支援的操作',
  UNAUTHORIZED: '登入驗證失敗，請重新登入後再試',
  AUTH_FAILED: '密碼錯誤',
  CSRF_INVALID: '安全驗證已失效，請重新登入後再試',
  CSRF_TOKEN_INVALID: '安全驗證已失效，請重新登入後再試',
  RATE_LIMITED: '嘗試太頻繁，請稍後再試',
  CONFLICT: '資料已存在或衝突，請改用其他編號後再試',
  VERSION_CONFLICT: '版本衝突：此樹木已被其他人更新，請重新載入頁面後再編輯',
  UPLOAD_FAILED: '相片上傳失敗，請稍後再試',
  SYSTEM_BUSY: '系統忙碌中，請稍後再試',
  INTERNAL_READ_ERROR: '伺服器讀取失敗，請稍後再試',
  INTERNAL_WRITE_ERROR: '伺服器寫入失敗，請稍後再試',
  API_NOT_FOUND: '找不到服務部署，請檢查部署網址',
  API_FORBIDDEN: '服務拒絕存取，請檢查權限',
  API_SERVER_ERROR: '伺服器錯誤，請稍後再試',
  API_HTML_RESPONSE: '服務回應異常，請確認使用正式 /exec 網址',
  API_INVALID_JSON: '服務回應格式錯誤，請稍後再試',
  OFFLINE: '離線中，請連線後再試',
  TIMEOUT: '連線逾時，請稍後再試',
  OK_DUPLICATE: '已處理過，無需重複提交'
};

const FIELD_CODE_MSG = {
  'REQUIRED': '為必填',
  'TOO_LONG': '過長',
  'INVALID_FORMAT': '格式不正確',
  'INVALID_PARAMS': '參數錯誤',
  'MISSING_LOCATION': '缺少位置',
  'TOO_MANY_FILES': '數量過多',
  'FILE_TOO_LARGE': '檔案過大',
  'UNSUPPORTED_FORMAT': '不支援的格式',
  'EMPTY': '不可為空',
  'INVALID_BASE64': '格式不正確',
  'MIME_MISMATCH': '格式與內容不符',
  'UNKNOWN_FORMAT': '無法識別格式',
  'DECODE_FAILED': '解碼失敗',
  'DECODE_EMPTY': '解碼後為空',
  'INVALID_NUMBER': '必須為有效數字',
  'INVALID_VALUE': '值不正確',
  'VERSION_CONFLICT': '版本衝突，請重新載入',
  'INVALID': '不正確',
  'ALREADY_EXISTS': '已存在',
  'UNSUPPORTED': '不支援'
};

function codeOf(data) {
  if (!data) return '';
  return String(data.error_code || data.error || data.code || '').trim();
}

function messageFor(code, fallback) {
  if (!code) return fallback || '請求失敗，請稍後再試';
  return M[code] || fallback || '請求失敗，請稍後再試';
}

function detailMessage(details) {
  if (!details || !details.length) return '';
  const first = details[0];
  const f = first.field ? first.field + ' ' : '';
  const c = FIELD_CODE_MSG[first.code] || first.code || '';
  return c ? (f + c) : '';
}

function messageForResponse(data, fallback) {
  const code = codeOf(data);
  // 🔥 [P0 修復] 優先檢查細節碼：若係 VERSION_CONFLICT 用專用訊息，唔用 CONFLICT 嘅預設文字
  if (data && data.details && data.details.length) {
    for (let i = 0; i < data.details.length; i++) {
      if (data.details[i].code === 'VERSION_CONFLICT') {
        return M['VERSION_CONFLICT'] || '版本衝突：此樹木已被其他人更新，請重新載入';
      }
    }
  }
  const msg = messageFor(code, '');
  if (msg && data && data.details && data.details.length) {
    const dmsg = detailMessage(data.details);
    if (dmsg) return msg + '（' + dmsg + '）';
  }
  return msg || fallback || '請求失敗，請稍後再試';
}

export const ErrorCodes = {
  MESSAGES: M,
  FIELD_CODE_MSG,
  codeOf,
  messageFor,
  messageForResponse,
  detailMessage
};

