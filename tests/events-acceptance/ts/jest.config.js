module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/*.test.ts'],
  testTimeout: 60000,
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: false }] },
}
