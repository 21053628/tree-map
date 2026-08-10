/**
 * 樹木管理系統 - 認證服務模組（真實後端驗證版）
 * - 密碼唔再放前端，由 Apps Script 後端驗證
 * - 成功後攞 Token，存 4 小時，過期自動再問
 */
const AuthService = (function() {
  'use strict';

  const TOKEN_KEY = 'tree_staff_token';
  // 🔥 [更新] 將前端 Session 改為 4 小時 (14,400,000 毫秒)
  const SESSION_DURATION = 4 * 60 * 60 * 1000; 

  function getToken() {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (obj && obj.token && obj.until > Date.now()) return obj.token;
    } catch (e) {}
    return null;
  }

  function isAuthenticated() {
    return !!getToken();
  }

  /* 將密碼送去後端驗證，成功就存 Token */
  async function authenticate(password) {
    try {
      const response = await fetch(Config.API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ type: 'login', password: password })
      });
      const res = await response.json();
      if (res && res.ok && res.token) {
        localStorage.setItem(TOKEN_KEY, JSON.stringify({
          token: res.token,
          until: Date.now() + SESSION_DURATION
        }));
        return true;
      }
      return false;
    } catch (e) {
      console.error('登入請求失敗:', e);
      return false;
    }
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
  }

  /* 工作人員閘：已登入直接放行；未登入彈密碼框驗證 */
  async function promptAuth(message) {
    if (isAuthenticated()) return true;
    for (;;) {
      const password = prompt(message || '🔒 請輸入工作人員密碼：');
      if (password === null) return false;
      if (await authenticate(password)) return true;
      alert('❌ 密碼錯誤');
    }
  }

  return { getToken, isAuthenticated, authenticate, logout, promptAuth };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuthService;
}