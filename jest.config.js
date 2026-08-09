/**
 * 樹木管理系統 - 單元測試配置 (Jest)
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
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js']
};
