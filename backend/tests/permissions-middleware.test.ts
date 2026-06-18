import request from 'supertest'
import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import {
  requirePermission,
  requireOrganizationPermission,
  requireAppPermission,
  requireUserManagementPermission,
  requireRole,
  requireOwnership,
  requireAnyPermission,
  PermissionMiddleware,
  AuthenticatedRequest,
} from '../src/middleware/permissions'

// Mock the permission check functions
jest.mock('../src/utils/permit/permission-check', () => ({
  checkPermission: jest.fn(),
  checkOrganizationPermission: jest.fn(),
  checkAppPermission: jest.fn(),
  checkUserManagementPermission: jest.fn(),
}))

import {
  checkPermission,
  checkOrganizationPermission,
  checkAppPermission,
  checkUserManagementPermission,
} from '../src/utils/permit/permission-check'

const mockCheckPermission = checkPermission as jest.MockedFunction<
  typeof checkPermission
>
const mockCheckOrganizationPermission =
  checkOrganizationPermission as jest.MockedFunction<
    typeof checkOrganizationPermission
  >
const mockCheckAppPermission = checkAppPermission as jest.MockedFunction<
  typeof checkAppPermission
>
const mockCheckUserManagementPermission =
  checkUserManagementPermission as jest.MockedFunction<
    typeof checkUserManagementPermission
  >

// Test app setup
const app = express()
app.use(express.json())

// Mock user authentication middleware
const mockAuth = (req: AuthenticatedRequest, res: any, next: any) => {
  req.user = {
    id: 'test-user-id',
    email: 'test@example.com',
    roles: ['user'],
    organizationId: 'test-org-id',
  }
  next()
}

const mockAdminAuth = (req: AuthenticatedRequest, res: any, next: any) => {
  req.user = {
    id: 'admin-user-id',
    email: 'admin@example.com',
    roles: ['admin', 'user'],
    organizationId: 'test-org-id',
  }
  next()
}

// Test routes
app.get(
  '/test/generic-permission',
  mockAuth,
  requirePermission({
    resource: 'TestResource',
    action: 'read',
    requireOrganizationContext: true,
  }),
  (req, res) => res.json({ success: true })
)

app.get(
  '/test/organization/:organizationId',
  mockAuth,
  PermissionMiddleware.canReadOrganization,
  (req, res) => res.json({ success: true })
)

app.post(
  '/test/organization/:organizationId/apps',
  mockAuth,
  PermissionMiddleware.canCreateApp,
  (req, res) => res.json({ success: true })
)

app.get(
  '/test/organization/:organizationId/members',
  mockAuth,
  PermissionMiddleware.canViewMembers,
  (req, res) => res.json({ success: true })
)

app.get(
  '/test/admin-only',
  mockAuth,
  PermissionMiddleware.adminOnly,
  (req, res) => res.json({ success: true })
)

app.get(
  '/test/admin-only-with-admin',
  mockAdminAuth,
  PermissionMiddleware.adminOnly,
  (req, res) => res.json({ success: true })
)

app.get(
  '/test/ownership/:resourceId',
  mockAuth,
  requireOwnership(async req => {
    // Mock ownership check - return test-user-id for resource 'owned-resource'
    return req.params.resourceId === 'owned-resource'
      ? 'test-user-id'
      : 'other-user-id'
  }),
  (req, res) => res.json({ success: true })
)

app.get(
  '/test/any-permission/:organizationId',
  mockAuth,
  requireAnyPermission([
    {
      resource: 'Organization',
      action: 'read',
      requireOrganizationContext: true,
    },
    {
      resource: 'Organization',
      action: 'manage',
      requireOrganizationContext: true,
    },
  ]),
  (req, res) => res.json({ success: true })
)

describe('Permissions Middleware Tests', () => {
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks()
  })

  describe('Generic Permission Middleware', () => {
    test('should allow access when permission check passes', async () => {
      mockCheckPermission.mockResolvedValue(true)

      const response = await request(app).get('/test/generic-permission')

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      // The middleware must resolve the tenant from req.user.organizationId
      // (no :organizationId param on this route) and pass the configured
      // resource/action straight through to the permission layer.
      expect(mockCheckPermission).toHaveBeenCalledTimes(1)
      expect(mockCheckPermission).toHaveBeenCalledWith({
        user: 'test-user-id',
        action: 'read',
        resource: {
          type: 'TestResource',
          tenant: 'test-org-id',
          key: undefined,
        },
      })
    })

    test('should deny access when permission check fails', async () => {
      mockCheckPermission.mockResolvedValue(false)

      const response = await request(app).get('/test/generic-permission')

      expect(response.status).toBe(403)
      expect(response.body.error).toBe('Insufficient permissions')
      expect(response.body.code).toBe('PERMISSION_DENIED')
      // The downstream handler must NOT run when access is denied.
      expect(response.body.success).toBeUndefined()
      // The denial response should echo back what was required.
      expect(response.body.required).toMatchObject({
        action: 'read',
        resource: 'TestResource',
        tenant: 'test-org-id',
      })
    })

    test('should handle permission check errors gracefully', async () => {
      mockCheckPermission.mockRejectedValue(
        new Error('Permission service unavailable')
      )

      const response = await request(app).get('/test/generic-permission')

      expect(response.status).toBe(500)
      expect(response.body.error).toBe('Permission check failed')
      expect(response.body.code).toBe('PERMISSION_CHECK_ERROR')
      expect(response.body.success).toBeUndefined()
    })

    test('should deny access without consulting the permission layer when unauthenticated', async () => {
      // A route with the generic permission middleware but no auth middlware
      // in front of it must reject with 401 BEFORE calling checkPermission.
      const noAuthApp = express()
      noAuthApp.use(express.json())
      noAuthApp.get(
        '/test/generic-permission',
        requirePermission({
          resource: 'TestResource',
          action: 'read',
          requireOrganizationContext: true,
        }),
        (req, res) => res.json({ success: true })
      )

      const response = await request(noAuthApp).get('/test/generic-permission')

      expect(response.status).toBe(401)
      expect(response.body.error).toBe('Authentication required')
      expect(response.body.code).toBe('AUTH_REQUIRED')
      expect(mockCheckPermission).not.toHaveBeenCalled()
    })
  })

  describe('Organization Permission Middleware', () => {
    test('should allow organization access when permission granted', async () => {
      mockCheckOrganizationPermission.mockResolvedValue(true)

      const response = await request(app).get('/test/organization/test-org-123')

      expect(response.status).toBe(200)
      expect(mockCheckOrganizationPermission).toHaveBeenCalledWith(
        'test-user-id',
        'read',
        'test-org-123'
      )
    })

    test('should deny organization access when permission denied', async () => {
      mockCheckOrganizationPermission.mockResolvedValue(false)

      const response = await request(app).get('/test/organization/test-org-123')

      expect(response.status).toBe(403)
      expect(response.body.error).toBe('Insufficient organization permissions')
      expect(response.body.code).toBe('ORG_PERMISSION_DENIED')
      expect(response.body.success).toBeUndefined()
      expect(mockCheckOrganizationPermission).toHaveBeenCalledWith(
        'test-user-id',
        'read',
        'test-org-123'
      )
    })
  })

  describe('App Permission Middleware', () => {
    // The `create` action targets a not-yet-existing app, so the route that
    // gates creation (POST .../apps) carries no :appId param. The middleware
    // must therefore allow appId to be undefined for the create action and
    // delegate the decision to the permission layer (passing undefined appId).
    test('should allow app creation when permission granted', async () => {
      mockCheckAppPermission.mockResolvedValue(true)

      const response = await request(app)
        .post('/test/organization/test-org-123/apps')
        .send({ name: 'Test App' })

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      expect(mockCheckAppPermission).toHaveBeenCalledWith(
        'test-user-id',
        'create',
        undefined, // No appId in creation
        'test-org-123'
      )
    })

    test('should deny app creation when permission denied', async () => {
      mockCheckAppPermission.mockResolvedValue(false)

      const response = await request(app)
        .post('/test/organization/test-org-123/apps')
        .send({ name: 'Test App' })

      expect(response.status).toBe(403)
      expect(response.body.error).toBe('Insufficient app permissions')
      expect(response.body.code).toBe('APP_PERMISSION_DENIED')
      expect(response.body.success).toBeUndefined()
      expect(mockCheckAppPermission).toHaveBeenCalledWith(
        'test-user-id',
        'create',
        undefined,
        'test-org-123'
      )
    })
  })

  describe('User Management Permission Middleware', () => {
    test('should allow viewing members when permission granted', async () => {
      mockCheckUserManagementPermission.mockResolvedValue(true)

      const response = await request(app).get(
        '/test/organization/test-org-123/members'
      )

      expect(response.status).toBe(200)
      expect(mockCheckUserManagementPermission).toHaveBeenCalledWith(
        'test-user-id',
        'view_members',
        'test-org-123',
        undefined
      )
    })

    test('should deny viewing members when permission denied', async () => {
      mockCheckUserManagementPermission.mockResolvedValue(false)

      const response = await request(app).get(
        '/test/organization/test-org-123/members'
      )

      expect(response.status).toBe(403)
      expect(response.body.error).toBe(
        'Insufficient user management permissions'
      )
      expect(response.body.code).toBe('USER_MGMT_PERMISSION_DENIED')
      expect(response.body.success).toBeUndefined()
      expect(mockCheckUserManagementPermission).toHaveBeenCalledWith(
        'test-user-id',
        'view_members',
        'test-org-123',
        undefined
      )
    })
  })

  describe('Role-Based Access Control', () => {
    test('should deny access when user lacks required role', async () => {
      const response = await request(app).get('/test/admin-only')

      expect(response.status).toBe(403)
      expect(response.body.error).toBe('Insufficient role permissions')
      expect(response.body.code).toBe('ROLE_PERMISSION_DENIED')
      expect(response.body.required.roles).toEqual(['admin'])
      expect(response.body.current.roles).toEqual(['user'])
      expect(response.body.success).toBeUndefined()
    })

    test('should allow access when user has required role', async () => {
      const response = await request(app).get('/test/admin-only-with-admin')

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
    })
  })

  describe('Ownership Middleware', () => {
    test('should allow access when user owns resource', async () => {
      const response = await request(app).get('/test/ownership/owned-resource')

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
    })

    test('should deny access when user does not own resource', async () => {
      const response = await request(app).get('/test/ownership/other-resource')

      expect(response.status).toBe(403)
      expect(response.body.error).toBe(
        'Resource access denied - ownership required'
      )
      expect(response.body.code).toBe('OWNERSHIP_REQUIRED')
      expect(response.body.success).toBeUndefined()
    })

    test('should return 404 when the resource does not exist', async () => {
      // A separate route whose owner-resolver returns null (resource missing).
      const testApp = express()
      testApp.get(
        '/test/ownership-missing/:resourceId',
        mockAuth,
        requireOwnership(async () => null),
        (req, res) => res.json({ success: true })
      )

      const response = await request(testApp).get(
        '/test/ownership-missing/whatever'
      )

      expect(response.status).toBe(404)
      expect(response.body.error).toBe('Resource not found')
      expect(response.body.code).toBe('RESOURCE_NOT_FOUND')
      expect(response.body.success).toBeUndefined()
    })
  })

  describe('Any Permission Middleware', () => {
    test('should allow access when user has any of the required permissions', async () => {
      mockCheckPermission
        .mockResolvedValueOnce(false) // First permission check fails
        .mockResolvedValueOnce(true) // Second permission check passes

      const response = await request(app).get(
        '/test/any-permission/test-org-123'
      )

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
      // Both permissions are evaluated in order; the first (read) fails, the
      // second (manage) passes and short-circuits to allow.
      expect(mockCheckPermission).toHaveBeenCalledTimes(2)
      expect(mockCheckPermission).toHaveBeenNthCalledWith(1, {
        user: 'test-user-id',
        action: 'read',
        resource: { type: 'Organization', tenant: 'test-org-123', key: undefined },
      })
      expect(mockCheckPermission).toHaveBeenNthCalledWith(2, {
        user: 'test-user-id',
        action: 'manage',
        resource: { type: 'Organization', tenant: 'test-org-123', key: undefined },
      })
    })

    test('should deny access when user has none of the required permissions', async () => {
      mockCheckPermission.mockResolvedValue(false)

      const response = await request(app).get(
        '/test/any-permission/test-org-123'
      )

      expect(response.status).toBe(403)
      expect(response.body.error).toBe(
        'Insufficient permissions - none of the required permissions were found'
      )
      expect(response.body.code).toBe('NO_MATCHING_PERMISSIONS')
      expect(response.body.success).toBeUndefined()
      // Every configured permission must be attempted before denying.
      expect(mockCheckPermission).toHaveBeenCalledTimes(2)
    })
  })

  describe('Authentication Requirements', () => {
    test('should require authentication for all protected routes', async () => {
      // Create a route without authentication middleware
      const testApp = express()
      testApp.get(
        '/test/no-auth',
        PermissionMiddleware.canReadOrganization,
        (req, res) => res.json({ success: true })
      )

      const response = await request(testApp).get('/test/no-auth')

      expect(response.status).toBe(401)
      expect(response.body.error).toBe('Authentication required')
      expect(response.body.code).toBe('AUTH_REQUIRED')
    })
  })

  describe('Error Handling', () => {
    test('should handle organization context missing', async () => {
      const testApp = express()
      testApp.use(express.json())

      // Mock auth without organization context
      const noOrgAuth = (req: AuthenticatedRequest, res: any, next: any) => {
        req.user = {
          id: 'test-user-id',
          email: 'test@example.com',
          roles: ['user'],
          // No organizationId
        }
        next()
      }

      testApp.get(
        '/test/no-org-context',
        noOrgAuth,
        requirePermission({
          resource: 'TestResource',
          action: 'read',
          requireOrganizationContext: true,
        }),
        (req, res) => res.json({ success: true })
      )

      const response = await request(testApp).get('/test/no-org-context')

      expect(response.status).toBe(400)
      expect(response.body.error).toBe('Organization context required')
      expect(response.body.code).toBe('ORG_CONTEXT_REQUIRED')
    })

    test('should handle fallback to public when organization context missing', async () => {
      const testApp = express()
      testApp.use(express.json())

      const noOrgAuth = (req: AuthenticatedRequest, res: any, next: any) => {
        req.user = {
          id: 'test-user-id',
          email: 'test@example.com',
          roles: ['user'],
        }
        next()
      }

      testApp.get(
        '/test/fallback-public',
        noOrgAuth,
        requirePermission({
          resource: 'TestResource',
          action: 'read',
          fallbackToPublic: true,
        }),
        (req, res) => res.json({ success: true })
      )

      const response = await request(testApp).get('/test/fallback-public')

      expect(response.status).toBe(200)
      expect(response.body.success).toBe(true)
    })
  })

  describe('Convenience Middleware', () => {
    test('should have all expected convenience methods', () => {
      expect(PermissionMiddleware.canCreateOrganization).toBeDefined()
      expect(PermissionMiddleware.canReadOrganization).toBeDefined()
      expect(PermissionMiddleware.canUpdateOrganization).toBeDefined()
      expect(PermissionMiddleware.canDeleteOrganization).toBeDefined()
      expect(PermissionMiddleware.canManageOrganization).toBeDefined()

      expect(PermissionMiddleware.canCreateApp).toBeDefined()
      expect(PermissionMiddleware.canReadApp).toBeDefined()
      expect(PermissionMiddleware.canUpdateApp).toBeDefined()
      expect(PermissionMiddleware.canDeleteApp).toBeDefined()
      expect(PermissionMiddleware.canInstallApp).toBeDefined()
      expect(PermissionMiddleware.canUninstallApp).toBeDefined()

      expect(PermissionMiddleware.canInviteUsers).toBeDefined()
      expect(PermissionMiddleware.canRemoveUsers).toBeDefined()
      expect(PermissionMiddleware.canUpdateUserRoles).toBeDefined()
      expect(PermissionMiddleware.canViewMembers).toBeDefined()

      expect(PermissionMiddleware.adminOnly).toBeDefined()
      expect(PermissionMiddleware.ownerOrAdmin).toBeDefined()
      expect(PermissionMiddleware.memberOrAbove).toBeDefined()

      expect(PermissionMiddleware.custom).toBeDefined()
    })

    test('convenience methods bind the correct action to the permission layer', async () => {
      // canCreateOrganization must call the org permission check with 'create'.
      mockCheckOrganizationPermission.mockResolvedValue(true)
      const testApp = express()
      testApp.get(
        '/test/org-create/:organizationId',
        mockAuth,
        PermissionMiddleware.canCreateOrganization,
        (req, res) => res.json({ success: true })
      )

      const response = await request(testApp).get('/test/org-create/org-xyz')

      expect(response.status).toBe(200)
      expect(mockCheckOrganizationPermission).toHaveBeenCalledWith(
        'test-user-id',
        'create',
        'org-xyz'
      )
    })
  })
})
