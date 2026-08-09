/**
 * Utils.js 單元測試 - 座標轉換工具
 */

// 載入被測試的模組 (ES6 Modules)
const { CoordUtils } = require('../assets/js/utils.js');

describe('CoordUtils - 座標轉換工具', () => {
  
  describe('format1', () => {
    test('應該格式化數字到小數點後 1 位', () => {
      expect(CoordUtils.format1(22.3664)).toBe('22.4');
      expect(CoordUtils.format1(114.1748)).toBe('114.2');
      expect(CoordUtils.format1(0)).toBe('0.0');
      expect(CoordUtils.format1(100)).toBe('100.0');
    });

    test('應該處理負數', () => {
      expect(CoordUtils.format1(-22.3664)).toBe('-22.4');
    });
  });

  describe('format5', () => {
    test('應該格式化數字到小數點後 5 位', () => {
      expect(CoordUtils.format5(22.3664)).toBe('22.36640');
      expect(CoordUtils.format5(114.1748)).toBe('114.17480');
      expect(CoordUtils.format5(0)).toBe('0.00000');
    });

    test('應該處理高精度數字', () => {
      expect(CoordUtils.format5(22.3664123456)).toBe('22.36641');
      expect(CoordUtils.format5(114.1748987654)).toBe('114.17490');
    });
  });

  describe('toHK80', () => {
    test('應該將 WGS84 座標轉換為 HK80 座標', () => {
      const result = CoordUtils.toHK80(22.2783, 114.1748);
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('N');
      expect(result).toHaveProperty('E');
    });

    test('應該處理無效輸入', () => {
      expect(CoordUtils.toHK80(null, null)).toBeNull();
      expect(CoordUtils.toHK80(0, 0)).toBeNull();
      expect(CoordUtils.toHK80()).toBeNull();
    });

    test('應該使用快取機制', () => {
      // 第一次調用
      const result1 = CoordUtils.toHK80(22.2783, 114.1748);
      // 第二次相同輸入應該從快取獲取
      const result2 = CoordUtils.toHK80(22.2783, 114.1748);
      expect(result1).toEqual(result2);
    });
  });

  describe('toWGS84', () => {
    test('應該將 HK80 座標轉換為 WGS84 座標', () => {
      const hk80Coord = { N: 836694.05, E: 819069.8 };
      const result = CoordUtils.toWGS84(hk80Coord.N, hk80Coord.E);
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('lat');
      expect(result).toHaveProperty('lng');
    });

    test('應該使用快取機制', () => {
      const result1 = CoordUtils.toWGS84(836694.05, 819069.8);
      const result2 = CoordUtils.toWGS84(836694.05, 819069.8);
      expect(result1).toEqual(result2);
    });
  });

  describe('batchToHK80', () => {
    test('應該批量轉換多個座標', () => {
      const coords = [
        { lat: 22.2783, lng: 114.1748 },
        { lat: 22.2952, lng: 114.1722 },
        { lat: 22.3167, lng: 114.1833 }
      ];
      
      const results = CoordUtils.batchToHK80(coords);
      
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result).toHaveProperty('N');
        expect(result).toHaveProperty('E');
      });
    });

    test('應該處理空陣列', () => {
      const results = CoordUtils.batchToHK80([]);
      expect(results).toEqual([]);
    });
  });

  describe('clearCache', () => {
    test('應該清除所有快取', () => {
      // 先添加一些快取
      CoordUtils.toHK80(22.2783, 114.1748);
      
      // 檢查快取統計
      const statsBefore = CoordUtils.getCacheStats();
      expect(statsBefore.size).toBeGreaterThan(0);
      
      // 清除快取
      CoordUtils.clearCache();
      
      // 檢查快取已清除
      const statsAfter = CoordUtils.getCacheStats();
      expect(statsAfter.size).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    test('應該返回正確的快取統計信息', () => {
      const stats = CoordUtils.getCacheStats();
      
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('maxSize');
      expect(stats).toHaveProperty('usagePercent');
      expect(typeof stats.usagePercent).toBe('string');
      expect(stats.usagePercent).toMatch(/^\d+\.?\d*%$/);
    });
  });

  describe('preheatCache', () => {
    test('應該預熱常用座標轉換', () => {
      CoordUtils.clearCache();
      CoordUtils.preheatCache();
      
      const stats = CoordUtils.getCacheStats();
      expect(stats.size).toBeGreaterThan(0);
    });
  });
});
