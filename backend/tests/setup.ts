import path from 'path'
import http from 'http'
import https from 'https'

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

// ─── Prevent HTTP/HTTPS keep-alive open handles in tests ─────────────────────
//
// In Node 18+, http.globalAgent has keepAlive:true by default.  supertest
// creates an ephemeral server per request and calls server.close(), but
// server.close() does NOT force-close existing keep-alive connections.  Those
// linger for the server's keepAliveTimeout (5 s in Node 18), which means jest
// sees open handles after all tests finish and waits indefinitely.
//
// Fix: disable keep-alive on the global agents at the test-process level so
// every HTTP request (supertest loopback + any internal HTTP calls) sends
// "Connection: close", causing servers to close sockets immediately after
// each response.
//
// We also set both agents to maxSockets: Infinity to avoid connection queuing.
;(http.globalAgent as any).keepAlive = false
;(https.globalAgent as any).keepAlive = false

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

    // Give fire-and-forget provisioning calls (selfHealProvisioningOnLogin)
    // that were dispatched during login tests a brief window to complete their
    // in-flight DB queries and release borrowed connections back to the pool.
    // Without this, tarn.js pool.destroy() (called inside closeDatabase)
    // waits indefinitely for those borrowed connections, hanging jest.
    await new Promise<void>(resolve => {
      const t = setTimeout(resolve, 500)
      // Don't let the timer itself keep the event loop alive.
      if (t.unref) t.unref()
    })

    await closeDatabase()
    console.log('✅ Test database cleanup complete')
  } catch (error) {
    console.warn('⚠️ Error cleaning up test database:', error)
  }

  // Destroy the Node.js global http/https agents so any keep-alive sockets
  // (from supertest, axios, openid-client, or the Permit SDK) are released and
  // jest can exit cleanly without --forceExit.
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
