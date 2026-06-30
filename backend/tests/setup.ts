import path from 'path'

// Test DB config — env-overridable so the suite can run against any Postgres
// (CI service, a local throwaway container on another port, etc.). Defaults
// match the CI Postgres service / docker-compose.
process.env.NODE_ENV = 'test'
process.env.USE_POSTGRES = 'true'
process.env.DB_HOST = process.env.DB_HOST || 'localhost'
process.env.DB_PORT = process.env.DB_PORT || '5432'
process.env.DB_NAME = process.env.DB_NAME || 'fuzefront_platform'
process.env.DB_USER = process.env.DB_USER || 'postgres'
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'postgres'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-for-testing-only'
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

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
import { destroyPermitClient } from '../src/config/permit'

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

  // Destroy the Permit SDK's axios http agent so its keep-alive sockets are
  // released and jest can exit cleanly without --forceExit.
  destroyPermitClient()
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
