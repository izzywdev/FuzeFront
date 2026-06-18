import path from 'path'

// Mock environment variables for PostgreSQL testing
process.env.NODE_ENV = 'test'
process.env.USE_POSTGRES = 'true'
process.env.DB_HOST = 'localhost'
process.env.DB_PORT = '5432'
process.env.DB_NAME = 'fuzefront_platform'
process.env.DB_USER = 'postgres'
process.env.DB_PASSWORD = 'postgres'
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only'
process.env.FRONTEND_URL = 'http://localhost:3000'

// Global test timeout
jest.setTimeout(10000)

import {
  db,
  waitForPostgres,
  ensureDatabase,
  runMigrations,
  runSeeds,
  closeDatabase,
} from '../src/config/database'

// Global setup for all tests
beforeAll(async () => {
  try {
    console.log('🔧 Setting up test database...')

    // 1. Wait for PostgreSQL to be available
    await waitForPostgres()

    // 2. Ensure the database exists
    await ensureDatabase()

    // 3. Apply the real Knex migrations (loaded as .ts under ts-jest) so the
    //    schema matches the app + seeds (the old custom script was stale).
    await runMigrations()

    // 4. Run seeds for test data
    await runSeeds()

    console.log('✅ Test database setup complete')
  } catch (error) {
    console.error('❌ Test database setup failed:', error)
    throw error
  }
})

// Clean up after all tests
afterAll(async () => {
  try {
    console.log('🧹 Cleaning up test database...')
    await closeDatabase()
    console.log('✅ Test database cleanup complete')
  } catch (error) {
    console.warn('⚠️ Error cleaning up test database:', error)
  }
})

// Add custom matchers or global test utilities here
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidJWT(): R
    }
  }
}

expect.extend({
  toBeValidJWT(received: string) {
    const jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/
    const pass = jwtRegex.test(received)

    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid JWT`,
        pass: true,
      }
    } else {
      return {
        message: () => `expected ${received} to be a valid JWT`,
        pass: false,
      }
    }
  },
})
