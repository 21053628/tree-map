/**
 * Api.js 單元測試 - API 服務
 */

// Mock AuthService before importing ApiService
const mockAuthService = {
  promptAuth: jest.fn(),
  getToken: jest.fn(),
  logout: jest.fn(),
  isAuthenticated: jest.fn()
};

// 在導入前設定全域 AuthService
global.AuthService = mockAuthService;

// Mock fetch API
global.fetch = jest.fn();

// 導入 Config 和 ApiService
const { Config } = require('../assets/js/config.js');
const { ApiService } = require('../assets/js/api.js');

describe('ApiService - API 服務', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    
    // 重置 mock AuthService
    mockAuthService.promptAuth.mockResolvedValue(false);
    mockAuthService.getToken.mockReturnValue(null);
    mockAuthService.logout.mockReset();
    mockAuthService.isAuthenticated.mockReturnValue(false);
    
    global.AuthService = mockAuthService;
    
    ApiService.resetStats();
    ApiService.clearCache();
    
    // 初始化 API 服務
    ApiService.init(Config.API_ENDPOINT);
  });

  describe('init', () => {
    test('應該正確初始化 API 端點', () => {
      expect(() => ApiService.init(Config.API_ENDPOINT)).not.toThrow();
    });

    test('當沒有提供端點時應該拋出錯誤', () => {
      expect(() => ApiService.init()).toThrow('API 端點未提供');
      expect(() => ApiService.init(null)).toThrow('API 端點未提供');
    });
  });

  describe('get', () => {
    test('應該成功執行 GET 請求', async () => {
      const mockData = { trees: [{ id: 1, name: 'Tree 1' }] };
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockData
      });

      const result = await ApiService.get('trees');
      
      expect(result).toEqual(mockData);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('action=trees'),
        expect.objectContaining({
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        })
      );
    });

    test('應該處理帶參數的 GET 請求', async () => {
      const mockData = { project: { id: 1, name: 'Project 1' } };
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockData
      });

      const result = await ApiService.get('project', { id: 1 });
      
      expect(result).toEqual(mockData);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('action=project&id=1'),
        expect.anything()
      );
    });

    test('當 HTTP 狀態碼非 200 時應該拋出錯誤', async () => {
      // Mock fetch 返回一個會導致超時的 Promise，模擬網絡錯誤
      global.fetch.mockImplementation(() => {
        return Promise.reject(new Error('Network error: HTTP 500'));
      });

      await expect(ApiService.get('invalid')).rejects.toThrow();
    });

    test('應該使用快取機制', async () => {
      const mockData = { data: 'test-data' };
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockData
      });

      // 第一次請求
      await ApiService.get('test');
      // 第二次相同請求應該從快取獲取
      await ApiService.get('test');
      
      // fetch 應該只被調用一次
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('post', () => {
    test('應該成功執行 POST 請求 (非寫入操作)', async () => {
      const mockResponse = { ok: true, id: 123 };
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      // 使用非寫入類型的操作，不需要認證
      const payload = { type: 'read_only', data: { treeId: 1 } };
      const result = await ApiService.post(payload);
      
      expect(result).toEqual(mockResponse);
      expect(fetch).toHaveBeenCalledWith(
        Config.API_ENDPOINT,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"type":"read_only"')
        })
      );
    });

    test('對於寫入操作應該要求認證', async () => {
      // 設定 mock 返回已認證
      mockAuthService.promptAuth.mockResolvedValue(true);
      mockAuthService.getToken.mockReturnValue('test-token');
      
      const mockResponse = { ok: true };
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      await ApiService.post({ type: 'inspection', data: {} });
      
      expect(mockAuthService.promptAuth).toHaveBeenCalled();
      expect(mockAuthService.getToken).toHaveBeenCalled();
    });

    test('當用戶取消認證時應該返回錯誤', async () => {
      mockAuthService.promptAuth.mockResolvedValue(false);

      const result = await ApiService.post({ type: 'update_tree', data: {} });
      
      expect(result.ok).toBe(false);
      expect(result.error).toContain('未登入');
      expect(fetch).not.toHaveBeenCalled();
    });

    test('當收到 UNAUTHORIZED 錯誤時應該登出用戶', async () => {
      // 先通過認證
      mockAuthService.promptAuth.mockResolvedValue(true);
      mockAuthService.getToken.mockReturnValue('test-token');
      
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, error: 'UNAUTHORIZED' })
      });

      const result = await ApiService.post({ type: 'checkin', data: {} });
      
      expect(result.error).toContain('未登入或登入已過期');
      expect(mockAuthService.logout).toHaveBeenCalled();
    });

    test('對於讀取操作不應該要求認證', async () => {
      const mockResponse = { ok: true, data: [] };
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      await ApiService.post({ type: 'read_only', data: {} });
      
      expect(AuthService.promptAuth).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    test('應該返回正確的統計信息', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] })
      });

      await ApiService.get('test');
      
      const stats = ApiService.getStats();
      
      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('totalErrors');
      expect(stats).toHaveProperty('cacheHits');
      expect(stats).toHaveProperty('hitRate');
      expect(stats.totalRequests).toBeGreaterThan(0);
    });
  });

  describe('resetStats', () => {
    test('應該重置所有統計計數器', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network error'));

      try {
        await ApiService.get('test');
      } catch (e) {}
      
      ApiService.resetStats();
      
      const stats = ApiService.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalErrors).toBe(0);
      expect(stats.cacheHits).toBe(0);
    });
  });

  describe('clearCache', () => {
    test('應該清除所有響應快取', async () => {
      const mockData = { data: 'test' };
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockData
      });

      // 第一次請求 - 會存入快取
      await ApiService.get('cached-data');
      
      // 清除快取
      ApiService.clearCache();
      
      // 第二次請求 - 因為快取已清除，會重新發起網絡請求
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockData
      });
      await ApiService.get('cached-data');
      
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('debouncedLoad', () => {
    test('應該延遲執行加載函數', async () => {
      const loadFn = jest.fn(() => Promise.resolve({ data: 'loaded' }));
      
      // 快速連續調用多次
      ApiService.debouncedLoad(loadFn);
      ApiService.debouncedLoad(loadFn);
      ApiService.debouncedLoad(loadFn);
      
      // 等待防抖時間
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // loadFn 應該只被調用一次
      expect(loadFn).toHaveBeenCalledTimes(1);
    });
  });
});
