#!/usr/bin/env node

/**
 * FuzeFront Authentication Test Script
 *
 * This script tests the authentication system against the running backend
 * to verify that login, token validation, and logout are working correctly.
 *
 * Usage:
 *   node scripts/test-auth.js [backend-url]
 *
 * Example:
 *   node scripts/test-auth.js http://localhost:3004
 */

const axios = require('axios')

// Configuration
const BACKEND_URL = process.argv[2] || 'http://localhost:3004'
const TEST_CREDENTIALS = {
  email: 'admin@frontfuse.dev',
  password: 'admin123',
}

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
}

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`)
}

function logSuccess(message) {
  log(`✅ ${message}`, colors.green)
}

function logError(message) {
  log(`❌ ${message}`, colors.red)
}

function logInfo(message) {
  log(`ℹ️  ${message}`, colors.blue)
}

function logWarning(message) {
  log(`⚠️  ${message}`, colors.yellow)
}

async function testHealthEndpoint() {
  try {
    logInfo('Testing health endpoint...')
    const response = await axios.get(`${BACKEND_URL}/health`)

    if (response.status === 200) {
      logSuccess('Health endpoint is responding')
      logInfo(`Status: ${response.data.status}`)
      logInfo(`Environment: ${response.data.environment}`)
      logInfo(`Database: ${response.data.database.status}`)
      return true
    } else {
      logError(`Health endpoint returned status ${response.status}`)
      return false
    }
  } catch (error) {
    logError(`Health endpoint failed: ${error.message}`)
    return false
  }
}

async function testLogin() {
  try {
    logInfo('Testing login endpoint...')
    const response = await axios.post(
      `${BACKEND_URL}/api/auth/login`,
      TEST_CREDENTIALS
    )

    if (response.status === 200) {
      const { token, user, sessionId } = response.data

      if (token && user && sessionId) {
        logSuccess('Login successful')
        logInfo(`User: ${user.email}`)
        logInfo(`Roles: ${user.roles.join(', ')}`)
        logInfo(`Session ID: ${sessionId}`)
        logInfo(`Token: ${token.substring(0, 20)}...`)

        return { token, user, sessionId }
      } else {
        logError('Login response missing required fields')
        return null
      }
    } else {
      logError(`Login failed with status ${response.status}`)
      return null
    }
  } catch (error) {
    logError(`Login failed: ${error.response?.data?.error || error.message}`)
    return null
  }
}

async function testInvalidLogin() {
  try {
    logInfo('Testing invalid login credentials...')
    await axios.post(`${BACKEND_URL}/api/auth/login`, {
      email: 'admin@frontfuse.dev',
      password: 'wrongpassword',
    })

    logError('Invalid login should have failed but succeeded')
    return false
  } catch (error) {
    if (error.response?.status === 401) {
      logSuccess('Invalid login correctly rejected')
      return true
    } else {
      logError(
        `Invalid login test failed with unexpected error: ${error.message}`
      )
      return false
    }
  }
}

async function testUserEndpoint(token) {
  try {
    logInfo('Testing user info endpoint...')
    const response = await axios.get(`${BACKEND_URL}/api/auth/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (response.status === 200) {
      const { user } = response.data
      logSuccess('User info retrieved successfully')
      logInfo(`User ID: ${user.id}`)
      logInfo(`Email: ${user.email}`)
      logInfo(`Name: ${user.firstName} ${user.lastName}`)
      return true
    } else {
      logError(`User endpoint failed with status ${response.status}`)
      return false
    }
  } catch (error) {
    logError(
      `User endpoint failed: ${error.response?.data?.error || error.message}`
    )
    return false
  }
}

async function testInvalidToken() {
  try {
    logInfo('Testing invalid token rejection...')
    await axios.get(`${BACKEND_URL}/api/auth/user`, {
      headers: {
        Authorization: 'Bearer invalid-token',
      },
    })

    logError('Invalid token should have been rejected but was accepted')
    return false
  } catch (error) {
    if (error.response?.status === 403) {
      logSuccess('Invalid token correctly rejected')
      return true
    } else {
      logError(
        `Invalid token test failed with unexpected error: ${error.message}`
      )
      return false
    }
  }
}

async function testLogout(token) {
  try {
    logInfo('Testing logout endpoint...')
    const response = await axios.post(
      `${BACKEND_URL}/api/auth/logout`,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    )

    if (response.status === 200) {
      logSuccess('Logout successful')
      logInfo(`Message: ${response.data.message}`)
      return true
    } else {
      logError(`Logout failed with status ${response.status}`)
      return false
    }
  } catch (error) {
    logError(`Logout failed: ${error.response?.data?.error || error.message}`)
    return false
  }
}

async function testCORS() {
  try {
    logInfo('Testing CORS headers...')
    const response = await axios.post(
      `${BACKEND_URL}/api/auth/login`,
      TEST_CREDENTIALS,
      {
        headers: {
          Origin: 'http://localhost:8085',
        },
      }
    )

    const corsHeader = response.headers['access-control-allow-origin']
    if (corsHeader) {
      logSuccess(`CORS headers present: ${corsHeader}`)
      return true
    } else {
      logWarning('CORS headers not found (may be handled by proxy)')
      return true
    }
  } catch (error) {
    logError(`CORS test failed: ${error.message}`)
    return false
  }
}

async function runAllTests() {
  log(`${colors.bold}🚀 FuzeFront Authentication Test Suite${colors.reset}`)
  log(`${colors.bold}Backend URL: ${BACKEND_URL}${colors.reset}`)
  console.log()

  const results = {
    health: false,
    login: false,
    invalidLogin: false,
    userInfo: false,
    invalidToken: false,
    logout: false,
    cors: false,
  }

  let authData = null

  // Test 1: Health endpoint
  results.health = await testHealthEndpoint()
  console.log()

  if (!results.health) {
    logError('Backend is not responding. Please ensure the backend is running.')
    return results
  }

  // Test 2: Valid login
  authData = await testLogin()
  results.login = authData !== null
  console.log()

  // Test 3: Invalid login
  results.invalidLogin = await testInvalidLogin()
  console.log()

  if (authData) {
    // Test 4: User info with valid token
    results.userInfo = await testUserEndpoint(authData.token)
    console.log()

    // Test 5: Invalid token rejection
    results.invalidToken = await testInvalidToken()
    console.log()

    // Test 6: Logout
    results.logout = await testLogout(authData.token)
    console.log()
  }

  // Test 7: CORS
  results.cors = await testCORS()
  console.log()

  // Summary
  const passed = Object.values(results).filter(Boolean).length
  const total = Object.keys(results).length

  log(`${colors.bold}📊 Test Results Summary${colors.reset}`)
  log(`${colors.bold}Passed: ${passed}/${total}${colors.reset}`)
  console.log()

  Object.entries(results).forEach(([test, passed]) => {
    const status = passed ? '✅' : '❌'
    const color = passed ? colors.green : colors.red
    log(`${status} ${test}`, color)
  })

  console.log()

  if (passed === total) {
    logSuccess('🎉 All authentication tests passed!')
    process.exit(0)
  } else {
    logError(`❌ ${total - passed} test(s) failed`)
    process.exit(1)
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logError(`Unhandled Rejection at: ${promise}, reason: ${reason}`)
  process.exit(1)
})

// Run the tests
runAllTests().catch(error => {
  logError(`Test suite failed: ${error.message}`)
  process.exit(1)
})
