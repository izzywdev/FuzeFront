// Load environment variables
require('dotenv').config()

// Comprehensive Permissions Test Suite
async function runComprehensiveTests() {
  console.log('🧪 Comprehensive Permissions System Tests')
  console.log('='.repeat(60))

  let testCount = 0
  let passCount = 0
  let suiteCount = 0

  function suite(name, testFn) {
    suiteCount++
    console.log(`\n${suiteCount}. ${name}`)
    console.log('-'.repeat(name.length + 4))
    testFn()
  }

  function test(name, testFn) {
    testCount++
    try {
      const result = testFn()
      if (result === true || result === undefined) {
        console.log(`  ✅ ${name}`)
        passCount++
      } else {
        console.log(`  ❌ ${name} - Expected true, got ${result}`)
      }
    } catch (error) {
      console.log(`  ❌ ${name} - Error: ${error.message}`)
    }
  }

  function expect(actual) {
    return {
      toBe: expected => actual === expected,
      toBeDefined: () => actual !== undefined,
      toBeFunction: () => typeof actual === 'function',
      toBeObject: () => typeof actual === 'object' && actual !== null,
      toHaveProperty: prop => actual && actual.hasOwnProperty(prop),
    }
  }

  // Mock functions for testing
  function createMockRequest(overrides = {}) {
    return {
      user: { id: 'test-user', email: 'test@example.com', roles: ['user'] },
      params: {},
      body: {},
      query: {},
      headers: {},
      ...overrides,
    }
  }

  function createMockResponse() {
    const res = {
      statusCode: 200,
      jsonData: null,
      status: function (code) {
        this.statusCode = code
        return this
      },
      json: function (data) {
        this.jsonData = data
        return this
      },
      send: function (data) {
        this.sendData = data
        return this
      },
    }
    return res
  }

  function createMockNext() {
    let called = false
    const next = function () {
      called = true
    }
    next.wasCalled = () => called
    return next
  }

  try {
    // Import all modules
    const {
      PermissionMiddleware,
      requirePermission,
      requireRole,
      requireOrganizationPermission,
      requireAppPermission,
      requireUserManagementPermission,
      requireOwnership,
      requireAnyPermission,
    } = require('../dist/middleware/permissions')

    const {
      checkPermitConnection,
    } = require('../dist/utils/permit/sync-existing-data')

    // Test Suite 1: Module Imports
    suite('Module Imports', () => {
      test('should import PermissionMiddleware', () => {
        return expect(PermissionMiddleware).toBeDefined()
      })

      test('should import requirePermission factory', () => {
        return expect(requirePermission).toBeFunction()
      })

      test('should import requireRole factory', () => {
        return expect(requireRole).toBeFunction()
      })

      test('should import all permission functions', () => {
        return (
          expect(requireOrganizationPermission).toBeFunction() &&
          expect(requireAppPermission).toBeFunction() &&
          expect(requireUserManagementPermission).toBeFunction() &&
          expect(requireOwnership).toBeFunction() &&
          expect(requireAnyPermission).toBeFunction()
        )
      })
    })

    // Test Suite 2: PermissionMiddleware Convenience Methods
    suite('PermissionMiddleware Convenience Methods', () => {
      const organizationMethods = [
        'canCreateOrganization',
        'canReadOrganization',
        'canUpdateOrganization',
        'canDeleteOrganization',
        'canManageOrganization',
      ]

      const appMethods = [
        'canCreateApp',
        'canReadApp',
        'canUpdateApp',
        'canDeleteApp',
        'canInstallApp',
        'canUninstallApp',
      ]

      const userMgmtMethods = [
        'canInviteUsers',
        'canRemoveUsers',
        'canUpdateUserRoles',
        'canViewMembers',
      ]

      const roleMethods = ['adminOnly', 'ownerOrAdmin', 'memberOrAbove']

      test('should have all organization methods', () => {
        return organizationMethods.every(method =>
          expect(PermissionMiddleware[method]).toBeFunction()
        )
      })

      test('should have all app methods', () => {
        return appMethods.every(method =>
          expect(PermissionMiddleware[method]).toBeFunction()
        )
      })

      test('should have all user management methods', () => {
        return userMgmtMethods.every(method =>
          expect(PermissionMiddleware[method]).toBeFunction()
        )
      })

      test('should have all role-based methods', () => {
        return roleMethods.every(method =>
          expect(PermissionMiddleware[method]).toBeFunction()
        )
      })

      test('should have custom method', () => {
        return expect(PermissionMiddleware.custom).toBeFunction()
      })

      test('should have correct number of methods', () => {
        const totalMethods =
          organizationMethods.length +
          appMethods.length +
          userMgmtMethods.length +
          roleMethods.length +
          1 // +1 for custom
        return Object.keys(PermissionMiddleware).length >= totalMethods
      })
    })

    // Test Suite 3: Role-Based Access Control
    suite('Role-Based Access Control', () => {
      test('should allow access with correct role', () => {
        const middleware = requireRole(['admin'])
        const req = createMockRequest({
          user: { id: 'test', roles: ['admin', 'user'] },
        })
        const res = createMockResponse()
        const next = createMockNext()

        middleware(req, res, next)

        return (
          expect(next.wasCalled()).toBe(true) &&
          expect(res.statusCode).toBe(200)
        )
      })

      test('should deny access with wrong role', () => {
        const middleware = requireRole(['admin'])
        const req = createMockRequest({
          user: { id: 'test', roles: ['user'] },
        })
        const res = createMockResponse()
        const next = createMockNext()

        middleware(req, res, next)

        return (
          expect(next.wasCalled()).toBe(false) &&
          expect(res.statusCode).toBe(403)
        )
      })

      test('should allow access with any of multiple roles', () => {
        const middleware = requireRole(['admin', 'moderator'])
        const req = createMockRequest({
          user: { id: 'test', roles: ['moderator', 'user'] },
        })
        const res = createMockResponse()
        const next = createMockNext()

        middleware(req, res, next)

        return expect(next.wasCalled()).toBe(true)
      })

      test('should handle missing user', () => {
        const middleware = requireRole(['admin'])
        const req = createMockRequest({ user: undefined })
        const res = createMockResponse()
        const next = createMockNext()

        middleware(req, res, next)

        return (
          expect(next.wasCalled()).toBe(false) &&
          expect(res.statusCode).toBe(401)
        )
      })
    })

    // Test Suite 4: Middleware Creation
    suite('Middleware Creation', () => {
      test('requirePermission should create middleware function', () => {
        const middleware = requirePermission({
          resource: 'TestResource',
          action: 'read',
        })
        return expect(middleware).toBeFunction()
      })

      test('requireRole should create middleware function', () => {
        const middleware = requireRole(['admin'])
        return expect(middleware).toBeFunction()
      })

      test('all require functions should create middleware', () => {
        const middlewares = [
          requireOrganizationPermission('read'),
          requireAppPermission('read'),
          requireUserManagementPermission('invite'),
          requireOwnership(async () => 'owner-id'),
          requireAnyPermission([{ resource: 'Test', action: 'read' }]),
        ]
        return middlewares.every(mw => expect(mw).toBeFunction())
      })
    })

    // Test Suite 5: Error Handling
    suite('Error Handling', () => {
      test('should return 401 for missing authentication', () => {
        const middleware = requirePermission({
          resource: 'TestResource',
          action: 'read',
        })
        const req = createMockRequest({ user: undefined })
        const res = createMockResponse()
        const next = createMockNext()

        middleware(req, res, next)

        return (
          expect(res.statusCode).toBe(401) &&
          expect(res.jsonData).toHaveProperty('code') &&
          expect(res.jsonData.code).toBe('AUTH_REQUIRED')
        )
      })

      test('should return structured error responses', () => {
        const middleware = requireRole(['admin'])
        const req = createMockRequest({
          user: { id: 'test', roles: ['user'] },
        })
        const res = createMockResponse()
        const next = createMockNext()

        middleware(req, res, next)

        return (
          expect(res.jsonData).toHaveProperty('error') &&
          expect(res.jsonData).toHaveProperty('code') &&
          expect(res.jsonData.code).toBe('ROLE_PERMISSION_DENIED')
        )
      })
    })

    // Test Suite 6: Permit.io Integration
    suite('Permit.io Integration', () => {
      test('should have Permit.io utilities available', () => {
        return expect(checkPermitConnection).toBeFunction()
      })
    })

    // Final Results
    console.log('\n' + '='.repeat(60))
    console.log(
      `🎉 Comprehensive Tests completed: ${passCount}/${testCount} passed`
    )
    console.log(`📊 Test Suites: ${suiteCount}`)

    if (passCount === testCount) {
      console.log('✅ All tests passed!')
      return true
    } else {
      console.log(`❌ ${testCount - passCount} tests failed!`)
      return false
    }
  } catch (error) {
    console.error('❌ Test suite failed:', error.message)
    return false
  }
}

// Run comprehensive tests
runComprehensiveTests()
  .then(success => {
    process.exit(success ? 0 : 1)
  })
  .catch(error => {
    console.error('Test runner error:', error)
    process.exit(1)
  })
