/**
 * Auth.js 單元測試 - 認證服務
 */

const AuthService = require('../assets/js/auth.js');

// Mock fetch API
global.fetch = jest.fn();

describe('AuthService - 認證服務', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  describe('isAuthenticated', () => {
    test('當沒有 Token 時應該返回 false', () => {
      expect(AuthService.isAuthenticated()).toBe(false);
    });

    test('當有有效 Token 時應該返回 true', () => {
      const tokenData = JSON.stringify({
        token: 'test-token-123',
        until: Date.now() + 30 * 60 * 1000 // 30 分鐘後過期
      });
      localStorage.getItem.mockReturnValue(tokenData);
      
      expect(AuthService.isAuthenticated()).toBe(true);
    });

    test('當 Token 過期時應該返回 false', () => {
      const tokenData = JSON.stringify({
        token: 'expired-token',
        until: Date.now() - 1000 // 已過期
      });
      localStorage.getItem.mockReturnValue(tokenData);
      
      expect(AuthService.isAuthenticated()).toBe(false);
    });
  });

  describe('getToken', () => {
    test('當沒有 Token 時應該返回 null', () => {
      expect(AuthService.getToken()).toBeNull();
    });

    test('當有有效 Token 時應該返回 Token', () => {
      const tokenData = JSON.stringify({
        token: 'test-token-123',
        until: Date.now() + 30 * 60 * 1000
      });
      localStorage.getItem.mockReturnValue(tokenData);
      
      expect(AuthService.getToken()).toBe('test-token-123');
    });

    test('當 localStorage 解析失敗時應該返回 null', () => {
      localStorage.getItem.mockReturnValue('invalid-json');
      
      expect(AuthService.getToken()).toBeNull();
    });
  });

  describe('authenticate', () => {
    test('成功驗證時應該返回 true', async () => {
      global.fetch.mockResolvedValueOnce({
        json: async () => ({ ok: true, token: 'new-token-456' })
      });

      const result = await AuthService.authenticate('correct-password');
      
      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        Config.API_ENDPOINT,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"password":"correct-password"')
        })
      );
      expect(localStorage.setItem).toHaveBeenCalled();
    });

    test('驗證失敗時應該返回 false', async () => {
      global.fetch.mockResolvedValueOnce({
        json: async () => ({ ok: false, error: 'Invalid password' })
      });

      const result = await AuthService.authenticate('wrong-password');
      
      expect(result).toBe(false);
    });

    test('網絡錯誤時應該返回 false', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await AuthService.authenticate('any-password');
      
      expect(result).toBe(false);
    });
  });

  describe('logout', () => {
    test('應該移除儲存的 Token', () => {
      AuthService.logout();
      
      expect(localStorage.removeItem).toHaveBeenCalledWith('tree_staff_token');
    });
  });

  describe('promptAuth', () => {
    test('當已經認證時應該直接返回 true', async () => {
      const tokenData = JSON.stringify({
        token: 'valid-token',
        until: Date.now() + 30 * 60 * 1000
      });
      localStorage.getItem.mockReturnValue(tokenData);

      const result = await AuthService.promptAuth();
      
      expect(result).toBe(true);
      expect(global.prompt).not.toHaveBeenCalled();
    });

    test('當用戶取消時應該返回 false', async () => {
      // 確保沒有 Token，會進入密碼輸入流程
      localStorage.getItem.mockReturnValue(null);
      global.prompt.mockReturnValue(null); // 用戶點擊取消
      
      const result = await AuthService.promptAuth();
      
      expect(result).toBe(false);
    });

    test('密碼正確時應該返回 true', async () => {
      // 確保沒有 Token
      localStorage.getItem.mockReturnValue(null);
      global.prompt.mockReturnValue('correct-password');
      global.fetch.mockResolvedValueOnce({
        json: async () => ({ ok: true, token: 'new-token' })
      });

      const result = await AuthService.promptAuth();
      
      expect(result).toBe(true);
    });

    test('密碼錯誤後重新輸入正確密碼應該返回 true', async () => {
      // 確保沒有 Token
      localStorage.getItem.mockReturnValue(null);
      
      let callCount = 0;
      global.prompt.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? 'wrong-password' : 'correct-password';
      });
      
      let fetchCallCount = 0;
      global.fetch.mockImplementation(() => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return Promise.resolve({
            json: async () => ({ ok: false, error: 'Invalid' })
          });
        } else {
          return Promise.resolve({
            json: async () => ({ ok: true, token: 'new-token' })
          });
        }
      });

      const result = await AuthService.promptAuth();
      
      expect(result).toBe(true);
      expect(global.prompt).toHaveBeenCalledTimes(2);
    });
  });
});
