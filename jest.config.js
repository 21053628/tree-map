/**
 * 樹木管理系統 - 單元測試配置 (Jest)
 * 
 * 更新以支援 ES6 Modules
 */
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'assets/js/**/*.js',
    '!assets/js/config.js'
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],
  // 轉換 JS 文件以支援 ES6 語法
  transform: {
    '\\.[jt]sx?$': 'babel-jest'
  },
  // 允許轉換 assets/js 目錄下的文件
  transformIgnorePatterns: [
    '/node_modules/(?!(axios|other-esm-module)/)'
  ]
};
