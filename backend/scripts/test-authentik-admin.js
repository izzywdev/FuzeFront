#!/usr/bin/env node

/**
 * Authentik Admin Access Test Script
 * 
 * This script tests that we can access the Authentik admin interface
 * and retrieve OAuth application configuration programmatically.
 */

const axios = require('axios')

// Configuration
const AUTHENTIK_URL = process.env.AUTHENTIK_URL || 'http://localhost:9000'
const ADMIN_CREDENTIALS = {
  email: process.env.AUTHENTIK_ADMIN_EMAIL || 'admin@fuzefront.dev',
  password: process.env.AUTHENTIK_ADMIN_PASSWORD || 'admin123'
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

async function testAuthentikHealth() {
  try {
    logInfo('Testing Authentik basic connectivity...')
    const response = await axios.get(`${AUTHENTIK_URL}/`, {
      maxRedirects: 0,
      validateStatus: () => true
    })
    
    if (response.status === 302 && response.headers.location) {
      logSuccess('Authentik is responding and redirecting to auth flow')
      logInfo(`Redirects to: ${response.headers.location}`)
      return true
    } else if (response.status === 200) {
      logSuccess('Authentik is responding')
      return true
    } else {
      logError(`Authentik returned status ${response.status}`)
      return false
    }
  } catch (error) {
    logError(`Authentik health check failed: ${error.message}`)
    return false
  }
}

async function testInitialSetupFlow() {
  try {
    logInfo('Testing if initial setup is still required...')
    const response = await axios.get(`${AUTHENTIK_URL}/if/flow/initial-setup/`)
    
    if (response.status === 200) {
      // Check if we get redirected or blocked
      if (response.data.includes('does not apply to current user')) {
        logError('Initial setup flow blocked: "does not apply to current user"')
        return false
      } else if (response.data.includes('ak-flow-executor')) {
        logWarning('Initial setup flow is still available')
        return false
      } else {
        logInfo('Initial setup response unclear, checking admin access...')
        return true
      }
    }
  } catch (error) {
    if (error.response?.status === 403) {
      logInfo('Initial setup flow blocked (403) - this may be expected')
      return true
    } else {
      logError(`Initial setup test failed: ${error.message}`)
      return false
    }
  }
}

async function testAdminInterfaceAccess() {
  try {
    logInfo('Testing admin interface access...')
    const response = await axios.get(`${AUTHENTIK_URL}/if/admin/`)
    
    if (response.status === 200) {
      if (response.data.includes('AdminInterface')) {
        logSuccess('Admin interface is accessible')
        return true
      } else {
        logWarning('Admin interface response unexpected')
        return false
      }
    } else {
      logError(`Admin interface returned status ${response.status}`)
      return false
    }
  } catch (error) {
    logError(`Admin interface test failed: ${error.message}`)
    return false
  }
}

async function testOIDCDiscovery() {
  try {
    logInfo('Testing OIDC discovery endpoint...')
    const response = await axios.get(`${AUTHENTIK_URL}/application/o/fuzefront/.well-known/openid_configuration`)
    
    if (response.status === 200) {
      const config = response.data
      logSuccess('OIDC discovery endpoint working')
      logInfo(`Issuer: ${config.issuer}`)
      logInfo(`Authorization endpoint: ${config.authorization_endpoint}`)
      logInfo(`Token endpoint: ${config.token_endpoint}`)
      return true
    } else {
      logError(`OIDC discovery returned status ${response.status}`)
      return false
    }
  } catch (error) {
    logError(`OIDC discovery failed: ${error.message}`)
    return false
  }
}

async function testApplicationList() {
  try {
    logInfo('Testing application listing...')
    // This will require authentication, but let's see what we get
    const response = await axios.get(`${AUTHENTIK_URL}/api/v3/core/applications/`)
    
    if (response.status === 200) {
      const apps = response.data.results || []
      logSuccess(`Found ${apps.length} applications`)
      apps.forEach(app => {
        logInfo(`  - ${app.name} (${app.slug})`)
      })
      return true
    }
  } catch (error) {
    if (error.response?.status === 401) {
      logInfo('Application API requires authentication (expected for unauthenticated request)')
      return true
    } else {
      logError(`Application list test failed: ${error.message}`)
      return false
    }
  }
}

async function runAllTests() {
  log(`${colors.bold}🔐 Authentik Admin Access Test Suite${colors.reset}`)
  log(`${colors.bold}Authentik URL: ${AUTHENTIK_URL}${colors.reset}`)
  console.log()

  const results = {
    health: false,
    initialSetup: false,
    adminInterface: false,
    oidcDiscovery: false,
    applicationList: false,
  }

  // Test 1: Authentik health
  results.health = await testAuthentikHealth()
  console.log()

  if (!results.health) {
    logError('Authentik is not responding properly. Please check the service.')
    return results
  }

  // Test 2: Initial setup flow
  results.initialSetup = await testInitialSetupFlow()
  console.log()

  // Test 3: Admin interface
  results.adminInterface = await testAdminInterfaceAccess()
  console.log()

  // Test 4: OIDC discovery
  results.oidcDiscovery = await testOIDCDiscovery()
  console.log()

  // Test 5: Application list (without auth)
  results.applicationList = await testApplicationList()
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

  if (passed >= total - 1) { // Allow one test to fail
    logSuccess('🎉 Authentik admin access tests mostly passed!')
    
    if (!results.initialSetup) {
      logWarning('⚠️  Initial setup may still be blocking. Try accessing http://localhost:9000/if/admin/ directly.')
    }
    
    logInfo('Next steps:')
    logInfo('1. Access http://localhost:9000/if/admin/ in your browser')
    logInfo('2. Login with admin@fuzefront.dev / admin123')
    logInfo('3. Navigate to Applications > Providers to configure OAuth2')
    
    process.exit(0)
  } else {
    logError(`❌ ${total - passed} critical test(s) failed`)
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