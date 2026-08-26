/**
 * 樹木管理系統 - 認證服務模組（真實後端驗證版）
 * - 密碼不再放在前端，由 Apps Script 後端驗證
 * - 成功後取得 Token，僅存於 sessionStorage，存 4 小時，過期自動重新詢問
 * - CSRF Token 與會話 Token 一同存儲，每次請求需攜帶
 * - 不將 Token 或 CSRF Token 寫入 localStorage
 */
import { Config } from './config.js';
import { ApiService } from './api.js';
import { ErrorCodes } from './core/error-codes.js';
export const AuthService = (function() {
  'use strict';

  const TOKEN_KEY = (Config.AUTH && Config.AUTH.STORAGE_KEY)
    ? Config.AUTH.STORAGE_KEY
    : 'tree_staff_token';
  const CSRF_KEY = 'tree_csrf_token';
  let lastAuthError = null;
  let promptPromise = null;
  let reauthPromise = null;
  // 🔥 [更新] 統一由 Config.AUTH.SESSION_DURATION 管理，預設縮短至 4 小時
  const SESSION_DURATION = (Config.AUTH && Config.AUTH.SESSION_DURATION)
    ? Config.AUTH.SESSION_DURATION
    : 4 * 60 * 60 * 1000;

  // Token 及 CSRF 只保留於 sessionStorage；關閉分頁後必須重新驗證。
  function getStore() {
    try { return window.sessionStorage; } catch (e) { return null; }
  }

  // 清除舊版本留下的 persistent credentials，避免升級後 localStorage 仍殘留 Token。
  function clearLegacyPersistentCredentials_() {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(CSRF_KEY);
    } catch (e) { /* intentionally ignored: optional fallback failure */ }
  }

  clearLegacyPersistentCredentials_();

  function getToken() {
    try {
      const store = getStore();
      const raw = store ? store.getItem(TOKEN_KEY) : null;
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (obj && obj.token && obj.until > Date.now()) return obj.token;
    } catch (e) { /* intentionally ignored: optional fallback failure */ }
    return null;
  }

  /** 獲取 CSRF Token */
  function getCsrfToken() {
    try {
      const store = getStore();
      return store ? store.getItem(CSRF_KEY) : null;
    } catch (e) {
      return null;
    }
  }

  /** 🔥 [P0 修復] 更新 CSRF Token（後端每次成功寫入後旋轉，前端需同步） */
  function setCsrfToken(token){
    if(!token) return;
    try{
      const store = getStore();
      if(store) store.setItem(CSRF_KEY, String(token));
    }catch(e){ /* intentionally ignored: optional fallback failure */ }
  }

  /** 生成加密安全的隨機 CSRF Token（保留供相容舊呼叫） */
  function generateCsrfToken() {
    try {
      const array = new Uint8Array(32);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(array);
        return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) { /* intentionally ignored: optional fallback failure */ }
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  function isAuthenticated() {
    // GAS 寫入請求同時需要 session token 及後端發出的 CSRF token。
    return !!getToken() && !!getCsrfToken();
  }

  /* 將密碼送去後端驗證，成功就存 Token 和 CSRF Token */
  async function authenticate(password) {
    lastAuthError = null;
    try {
      const response = await fetch(Config.API_ENDPOINT, {
        method: 'POST',
        // 登入請求不帶自訂 header，避免 OPTIONS preflight。
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ type: 'login', password: password })
      });

      const res = (ApiService && ApiService.parseResponse)
        ? await ApiService.parseResponse(response, 'POST login')
        : await response.text().then(function(body) {
            try {
              return body ? JSON.parse(body) : null;
            } catch (parseError) {
              throw new Error('登入回應不是有效 JSON，請確認 GAS 使用正式 /exec 部署網址。', { cause: parseError });
            }
          });

      if (!(res && res.ok && res.token && res.csrf_token)) {
        const code = res && (res.error_code || res.error) ? String(res.error_code || res.error) : 'AUTH_FAILED';
        const fallback = (ErrorCodes && ErrorCodes.messageFor) ? ErrorCodes.messageFor(code, '登入失敗，請稍後再試') : '登入失敗，請稍後再試';
        const backendError = String(fallback);
        const authError = new Error(backendError);
        authError.code = code;
        authError.backendResponse = res || null;
        lastAuthError = authError;
        return false;
      }

      const store = getStore();
      if (!store) {
        lastAuthError = new Error('瀏覽器不允許使用 sessionStorage，無法保存登入狀態');
        lastAuthError.code = 'AUTH_STORAGE_UNAVAILABLE';
        return false;
      }

      // token 與 CSRF 必須由 GAS 成對發行，不能本地生成 CSRF。
      store.setItem(TOKEN_KEY, JSON.stringify({
        token: String(res.token),
        until: Date.now() + SESSION_DURATION
      }));
      store.setItem(CSRF_KEY, String(res.csrf_token));
      // 防止舊版本 backup 在登入後重新出現；新版本不會寫入 localStorage。
      clearLegacyPersistentCredentials_();

      // 確認保存後仍能讀到完整的一對憑證。
      if (!getToken() || !getCsrfToken()) {
        logout();
        lastAuthError = new Error('登入成功但無法保存登入憑證，請重新載入頁面後再試');
        lastAuthError.code = 'AUTH_STORAGE_WRITE_FAILED';
        return false;
      }

      return true;
    } catch (e) {
      lastAuthError = e;
      console.error('登入請求失敗:', e);
      return false;
    }
  }

  function logout() {
    const store = getStore();
    if (store) {
      store.removeItem(TOKEN_KEY);
      store.removeItem(CSRF_KEY);
    }
    // 同步清除舊版本可能留下的 persistent credentials。
    clearLegacyPersistentCredentials_();
  }

  /** @deprecated GAS 無法讀取自訂 HTTP Header（Apps Script 限制），
   * CSRF Token 已透過 request body 傳送（見 api.js post 函數）。
   * 此函數保留僅供相容性，新程式碼請勿使用。 */
  function addCsrfHeader(headers) {
    const csrfToken = getCsrfToken();
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    return headers;
  }

  /* 工作人員閘：共用同一個 prompt，避免多個請求同時登入 */
  function promptAuth(message) {
    if (isAuthenticated()) return Promise.resolve(true);
    if (promptPromise) return promptPromise;

    promptPromise = (async function() {
      const password = prompt(message || '🔒 請輸入工作人員密碼：');
      if (password === null) return false;

      const authenticated = await authenticate(password);
      if (!authenticated && lastAuthError) {
        alert('❌ ' + lastAuthError.message);
      }
      return authenticated;
    })();

    return promptPromise.finally(function() {
      promptPromise = null;
    });
  }

  /* 強制重新登入只允許一個流程，避免前景和離線同步互相 logout。 */
  function reauthenticate(message) {
    if (reauthPromise) return reauthPromise;

    reauthPromise = (async function() {
      logout();
      return await promptAuth(message || '🔐 登入狀態已失效，請重新輸入工作人員密碼：');
    })();

    return reauthPromise.finally(function() {
      reauthPromise = null;
    });
  }

  return {
    getToken,
    getCsrfToken,
    setCsrfToken,
    isAuthenticated,
    authenticate,
    logout,
    promptAuth,
    reauthenticate,
    addCsrfHeader,
    generateCsrfToken
  };
})();
