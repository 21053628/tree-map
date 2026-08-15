/**
 * 樹木管理系統 - 認證服務模組（真實後端驗證版）
 * - 密碼唔再放前端，由 Apps Script 後端驗證
 * - 成功後攞 Token，存 4 小時，過期自動再問
 */
const AuthService = (function() {
  'use strict';

  const TOKEN_KEY = (typeof Config !== 'undefined' && Config.AUTH && Config.AUTH.STORAGE_KEY)
    ? Config.AUTH.STORAGE_KEY
    : 'tree_staff_token';
  // 🔥 [更新] 統一由 Config.AUTH.SESSION_DURATION 管理，預設縮短至 4 小時
  const SESSION_DURATION = (typeof Config !== 'undefined' && Config.AUTH && Config.AUTH.SESSION_DURATION)
    ? Config.AUTH.SESSION_DURATION
    : 4 * 60 * 60 * 1000;

  // token 改放 sessionStorage（XSS 洩漏面較小，關閉分頁即失效）
  function getStore() {
    try { return window.sessionStorage; } catch (e) { return null; }
  }

  function getToken() {
    try {
      const store = getStore();
      const raw = store ? store.getItem(TOKEN_KEY) : null;
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
        const store = getStore();
        if (store) {
          store.setItem(TOKEN_KEY, JSON.stringify({
            token: res.token,
            until: Date.now() + SESSION_DURATION
          }));
        }
        return true;
      }
      return false;
    } catch (e) {
      console.error('登入請求失敗:', e);
      return false;
    }
  }

  function logout() {
    const store = getStore();
    if (store) store.removeItem(TOKEN_KEY);
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