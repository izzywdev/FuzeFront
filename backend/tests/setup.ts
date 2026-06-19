import path from 'path'
import { Client } from 'pg'

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

// Create the test database if it doesn't exist yet.
// In CI the Postgres service container starts without a pre-created DB that
// matches our configured DB_NAME.  The test user (postgres in CI) is a
// superuser and can CREATE DATABASE.  In production this step is handled by
// the privileged Helm bootstrap Job instead — ensureDatabase() only verifies.
async function bootstrapTestDatabase(): Promise<void> {
  const dbName = process.env.DB_NAME || 'fuzefront_platform'
  const clientConfig: any = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: 'postgres',
    user: process.env.DB_USER || 'postgres',
  }
  if (process.env.DB_PASSWORD) {
    clientConfig.password = process.env.DB_PASSWORD
  }
  const client = new Client(clientConfig)
  await client.connect()
  try {
    const { rows } = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    )
    if (rows.length === 0) {
      // Safe: dbName comes from a controlled env var, not user input
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`)
      console.log(`✅ Created test database "${dbName}"`)
    }
  } finally {
    await client.end()
  }
}

// Global setup for all tests
beforeAll(async () => {
  try {
    console.log('🔧 Setting up test database...')

    // 1. Wait for PostgreSQL to be available
    await waitForPostgres()

    // 2. Create the database if it wasn't pre-provisioned (CI Postgres service)
    await bootstrapTestDatabase()

    // 3. Ensure the database exists
    await ensureDatabase()

    // 4. Apply the real Knex migrations (loaded as .ts under ts-jest) so the
    //    schema matches the app + seeds (the old custom script was stale).
    await runMigrations()

    // 5. Run seeds for test data
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
