/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // The package tsconfig is build-shaped (types: ["node"], include: src only), so
  // tests need their own or the jest globals do not resolve.
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tests/tsconfig.json' }],
  },
  // jose ships ESM-first; let ts-jest transpile it rather than choke on `import`.
  transformIgnorePatterns: ['node_modules/(?!(jose)/)'],
  testTimeout: 15000,
}
