import { Database } from 'sqlite3'
import path from 'path'

// Mock environment variables
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-only'
process.env.FRONTEND_URL = 'http://localhost:3000'

// Global test timeout
jest.setTimeout(10000)

// Global setup for all tests
beforeAll(async () => {
  // Initialize test database
  const testDbPath = path.join(__dirname, '../test.sqlite')

  // Clean up any existing test database
  try {
    const fs = require('fs')
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath)
    }
  } catch (error) {
    // Ignore errors if file doesn't exist
  }
})

// Clean up after all tests
afterAll(async () => {
  // Close any open connections
  // Clean up test database
  try {
    const fs = require('fs')
    const testDbPath = path.join(__dirname, '../test.sqlite')
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath)
    }
  } catch (error) {
    console.warn('Error cleaning up test database:', error)
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
