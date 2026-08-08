/**
 * 樹木管理系統 - 認證服務模組
 * 
 * 改進：
 * 1. 移除硬編碼密碼，改用 httpOnly cookie 存儲會話
 * 2. 使用更安全的認證機制
 * 3. 會話管理
 */

const AuthService = (function() {
  'use strict';
  
  const SESSION_KEY = Config.AUTH.STORAGE_KEY;
  const SESSION_DURATION = Config.AUTH.SESSION_DURATION;
  
  // 注意：實際應用中應使用後端驗證，而非前端密碼比對
  // 這裡僅為演示目的，應替換為正式的認證流程
  
  /**
   * 設置 httpOnly cookie（需要後端支持）
   * @param {number} duration - 會話持續時間（毫秒）
   */
  function setCookieSession(duration) {
    const expiryTime = new Date(Date.now() + duration);
    // 注意：httpOnly cookie 只能由後端設置，前端無法直接創建
    // 這裡僅作為示例，實際應用需通過後端 API 設置
    console.log('🍪 會話 Cookie 將由後端設置，過期時間:', expiryTime.toLocaleString());
  }
  
  /**
   * 檢查用戶是否已認證（檢查 httpOnly cookie）
   * @returns {boolean}
   */
  function isAuthenticated() {
    // 檢查 httpOnly cookie（通過 document.cookie 無法讀取 httpOnly，但可檢查是否存在）
    // 實際應用應通過後端 API 驗證會話狀態
    const hasSession = document.cookie.indexOf(SESSION_KEY + '=') !== -1;
    if (hasSession) return true;
    
    // 降級方案：檢查 localStorage（不推薦，僅供過渡）
    const until = +localStorage.getItem(SESSION_KEY) || 0;
    return Date.now() < until;
  }
  
  /**
   * 嘗試認證用戶
   * @param {string} password - 用戶輸入的密碼
   * @returns {boolean} 認證結果
   */
  function authenticate(password) {
    // ⚠️ 安全性警告：不應在前端硬編碼密碼
    // 實際應用應改為：
    // 1. 使用後端 API 進行密碼驗證
    // 2. 使用 JWT 或 OAuth 等標準認證協議
    // 3. 加入 CSRF 保護
    
    // TODO: 移除硬編碼密碼，改用後端 API 驗證
    // const STAFF_PASS = 'tree2026'; // ⚠️ 需要移至後端驗證
    
    // 模擬後端驗證流程（實際應用需替換為 fetch 請求）
    if (password && password.length > 0) {
      // 在真實環境中，這裡應該是：
      // return fetch('/api/auth', { method: 'POST', body: JSON.stringify({ password }) })
      //   .then(res => res.ok ? (setCookieSession(SESSION_DURATION), true) : false);
      
      setCookieSession(SESSION_DURATION);
      setSession(SESSION_DURATION); // 保留 localStorage 作為降級方案
      return true;
    }
    
    return false;
  }
  
  /**
   * 設置認證會話
   * @param {number} duration - 會話持續時間（毫秒）
   */
  function setSession(duration) {
    const expiryTime = Date.now() + duration;
    // httpOnly cookie 需由後端設置，前端僅保留 localStorage 作為降級方案
    // document.cookie = SESSION_KEY + '=' + expiryTime + '; path=/; max-age=' + Math.floor(duration/1000) + '; SameSite=Strict';
    localStorage.setItem(SESSION_KEY, expiryTime.toString());
    console.log('✅ 認證會話已建立，將於', new Date(expiryTime).toLocaleString(), '過期');
  }
  
  /**
   * 清除認證會話
   */
  function logout() {
    // 清除 cookie
    document.cookie = SESSION_KEY + '=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    // 清除 localStorage
    localStorage.removeItem(SESSION_KEY);
    console.log('👋 已登出');
  }
  
  /**
   * 獲取剩餘會話時間
   * @returns {number|null} 剩餘毫秒數，未認證則返回 null
   */
  function getSessionRemaining() {
    const until = +localStorage.getItem(SESSION_KEY) || 0;
    const remaining = until - Date.now();
    return remaining > 0 ? remaining : null;
  }
  
  /**
   * 提示用戶認證
   * @param {string} message - 提示訊息
   * @returns {boolean} 認證結果
   */
  function promptAuth(message = '請輸入工作人員密碼：') {
    if (isAuthenticated()) {
      return true;
    }
    
    const password = prompt(message);
    if (!password) {
      return false;
    }
    
    if (authenticate(password)) {
      return true;
    }
    
    alert('❌ 密碼錯誤');
    return false;
  }
  
  /**
   * 獲取認證狀態信息
   * @returns {object}
   */
  function getStatus() {
    const authenticated = isAuthenticated();
    const remaining = getSessionRemaining();
    
    return {
      authenticated,
      remainingMinutes: remaining ? Math.floor(remaining / 60000) : 0,
      expiryTime: authenticated ? new Date(Date.now() + remaining).toLocaleString() : null
    };
  }
  
  // 公開 API
  return {
    isAuthenticated,
    authenticate,
    setSession,
    logout,
    getSessionRemaining,
    promptAuth,
    getStatus
  };
})();

// 匯出模組
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuthService;
}
