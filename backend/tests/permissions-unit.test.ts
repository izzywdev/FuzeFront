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

// This is a focused UNIT test of the permission middleware factories in
// src/middleware/permissions.ts. The middleware delegates the actual
// allow/deny decision to the pure functions in
// src/utils/permit/permission-check.ts (which in turn call the external Permit
// SDK). Those functions are the seam we mock so we can drive every branch of
// the middleware deterministically and assert:
//   - the EXACT arguments the middleware passes down (request -> permission
//     check translation, tenant/resource-key resolution, precedence rules)
//   - the EXACT HTTP status + JSON body the middleware returns on each branch
//   - the request side effects (req.organization) the middleware sets for
//     downstream handlers
//   - that next() is / is not invoked appropriately
//
// No DB or HTTP server is needed: the middleware itself contains no DB access,
// so exercising it directly with mocked req/res/next is the genuine unit under
// test. (The global tests/setup.ts still stands up Postgres for the whole run;
// this suite simply does not depend on it.)
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

describe('Permissions Middleware Unit Tests', () => {
  let req: Partial<AuthenticatedRequest>
  let res: any
  let next: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()

    req = {
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
        roles: ['user'],
        organizationId: 'test-org-id',
      },
      params: {},
      body: {},
    }

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    }

    next = jest.fn()
  })

  describe('requirePermission', () => {
    test('should allow access when permission check passes', async () => {
      mockCheckPermission.mockResolvedValue(true)

      const middleware = requirePermission({
        resource: 'TestResource',
        action: 'read',
        requireOrganizationContext: true,
      })

      await middleware(req as AuthenticatedRequest, res, next)

      expect(mockCheckPermission).toHaveBeenCalledWith({
        user: 'test-user-id',
        action: 'read',
        resource: {
          type: 'TestResource',
          tenant: 'test-org-id',
          key: undefined,
        },
      })
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
      // On success the middleware must publish the resolved tenant as
      // organization context for downstream handlers.
      expect(req.organization).toEqual({ id: 'test-org-id', role: 'unknown' })
    })

    test('should deny access when permission check fails', async () => {
      mockCheckPermission.mockResolvedValue(false)

      const middleware = requirePermission({
        resource: 'TestResource',
        action: 'read',
        requireOrganizationContext: true,
      })

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Insufficient permissions',
        code: 'PERMISSION_DENIED',
        required: {
          action: 'read',
          resource: 'TestResource',
          tenant: 'test-org-id',
          resourceKey: undefined,
        },
      })
      expect(next).not.toHaveBeenCalled()
      // Denied requests must NOT leak organization context downstream.
      expect(req.organization).toBeUndefined()
    })

    test('should require authentication', async () => {
      delete req.user

      const middleware = requirePermission({
        resource: 'TestResource',
        action: 'read',
      })

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      })
      expect(next).not.toHaveBeenCalled()
      // Authentication is checked before any permission lookup happens.
      expect(mockCheckPermission).not.toHaveBeenCalled()
    })

    test('should prefer params.organizationId over user.organizationId for tenant', async () => {
      mockCheckPermission.mockResolvedValue(true)
      req.params!.organizationId = 'param-org-id'
      // req.user.organizationId is 'test-org-id' — params must win.

      const middleware = requirePermission({
        resource: 'TestResource',
        action: 'read',
        requireOrganizationContext: true,
      })

      await middleware(req as AuthenticatedRequest, res, next)

      expect(mockCheckPermission).toHaveBeenCalledWith({
        user: 'test-user-id',
        action: 'read',
        resource: {
          type: 'TestResource',
          tenant: 'param-org-id',
          key: undefined,
        },
      })
      expect(req.organization).toEqual({ id: 'param-org-id', role: 'unknown' })
      expect(next).toHaveBeenCalledTimes(1)
    })

    test('should handle missing organization context', async () => {
      req.user!.organizationId = undefined
      req.params = {}

      const middleware = requirePermission({
        resource: 'TestResource',
        action: 'read',
        requireOrganizationContext: true,
      })

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Organization context required',
        code: 'ORG_CONTEXT_REQUIRED',
      })
      expect(next).not.toHaveBeenCalled()
      expect(mockCheckPermission).not.toHaveBeenCalled()
    })

    test('should return 400 when no tenant and neither orgContext nor fallback configured', async () => {
      req.user!.organizationId = undefined
      req.params = {}

      const middleware = requirePermission({
        resource: 'TestResource',
        action: 'read',
        // no requireOrganizationContext, no fallbackToPublic
      })

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Organization context required',
        code: 'ORG_CONTEXT_REQUIRED',
      })
      expect(next).not.toHaveBeenCalled()
      expect(mockCheckPermission).not.toHaveBeenCalled()
    })

    test('should fallback to public when configured', async () => {
      req.user!.organizationId = undefined
      req.params = {}

      const middleware = requirePermission({
        resource: 'TestResource',
        action: 'read',
        fallbackToPublic: true,
      })

      await middleware(req as AuthenticatedRequest, res, next)

      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
      // Public fallback skips the permission check entirely.
      expect(mockCheckPermission).not.toHaveBeenCalled()
    })

    test('should use custom tenant getter', async () => {
      mockCheckPermission.mockResolvedValue(true)

      const middleware = requirePermission({
        resource: 'TestResource',
        action: 'read',
        getTenant: () => 'custom-tenant-id',
      })

      await middleware(req as AuthenticatedRequest, res, next)

      expect(mockCheckPermission).toHaveBeenCalledWith({
        user: 'test-user-id',
        action: 'read',
        resource: {
          type: 'TestResource',
          tenant: 'custom-tenant-id',
          key: undefined,
        },
      })
      expect(req.organization).toEqual({
        id: 'custom-tenant-id',
        role: 'unknown',
      })
    })

    test('should use custom resource key getter', async () => {
      mockCheckPermission.mockResolvedValue(true)
      req.params!.resourceId = 'test-resource-123'

      const middleware = requirePermission({
        resource: 'TestResource',
        action: 'read',
        requireOrganizationContext: true,
        getResourceKey: req => req.params?.resourceId,
      })

      await middleware(req as AuthenticatedRequest, res, next)

      expect(mockCheckPermission).toHaveBeenCalledWith({
        user: 'test-user-id',
        action: 'read',
        resource: {
          type: 'TestResource',
          tenant: 'test-org-id',
          key: 'test-resource-123',
        },
      })
    })

    test('should handle permission check errors', async () => {
      mockCheckPermission.mockRejectedValue(
        new Error('Permission service unavailable')
      )

      const middleware = requirePermission({
        resource: 'TestResource',
        action: 'read',
        requireOrganizationContext: true,
      })

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Permission check failed',
        code: 'PERMISSION_CHECK_ERROR',
      })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('requireOrganizationPermission', () => {
    test('should allow access when organization permission granted', async () => {
      mockCheckOrganizationPermission.mockResolvedValue(true)
      req.params!.organizationId = 'test-org-123'

      const middleware = requireOrganizationPermission('read')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(mockCheckOrganizationPermission).toHaveBeenCalledWith(
        'test-user-id',
        'read',
        'test-org-123'
      )
      expect(next).toHaveBeenCalledTimes(1)
      expect(req.organization).toEqual({ id: 'test-org-123', role: 'unknown' })
    })

    test('should resolve organization id from params.id when organizationId absent', async () => {
      mockCheckOrganizationPermission.mockResolvedValue(true)
      req.params!.id = 'org-from-id-param'

      const middleware = requireOrganizationPermission('manage')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(mockCheckOrganizationPermission).toHaveBeenCalledWith(
        'test-user-id',
        'manage',
        'org-from-id-param'
      )
      expect(next).toHaveBeenCalledTimes(1)
      expect(req.organization).toEqual({
        id: 'org-from-id-param',
        role: 'unknown',
      })
    })

    test('should deny access when organization permission denied', async () => {
      mockCheckOrganizationPermission.mockResolvedValue(false)
      req.params!.organizationId = 'test-org-123'

      const middleware = requireOrganizationPermission('read')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Insufficient organization permissions',
        code: 'ORG_PERMISSION_DENIED',
        required: { action: 'read', organizationId: 'test-org-123' },
      })
      expect(next).not.toHaveBeenCalled()
    })

    test('should require authentication', async () => {
      delete req.user
      req.params!.organizationId = 'test-org-123'

      const middleware = requireOrganizationPermission('read')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      })
      expect(next).not.toHaveBeenCalled()
      expect(mockCheckOrganizationPermission).not.toHaveBeenCalled()
    })

    test('should require organization ID', async () => {
      const middleware = requireOrganizationPermission('read')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Organization ID required',
        code: 'ORG_ID_REQUIRED',
      })
      expect(next).not.toHaveBeenCalled()
      expect(mockCheckOrganizationPermission).not.toHaveBeenCalled()
    })

    test('should return 500 when the permission check throws', async () => {
      mockCheckOrganizationPermission.mockRejectedValue(new Error('boom'))
      req.params!.organizationId = 'test-org-123'

      const middleware = requireOrganizationPermission('read')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Organization permission check failed',
        code: 'ORG_PERMISSION_ERROR',
      })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('requireAppPermission', () => {
    test('should allow access when app permission granted', async () => {
      mockCheckAppPermission.mockResolvedValue(true)
      req.params!.appId = 'app-123'
      req.params!.organizationId = 'org-123'

      const middleware = requireAppPermission('install')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(mockCheckAppPermission).toHaveBeenCalledWith(
        'test-user-id',
        'install',
        'app-123',
        'org-123'
      )
      expect(next).toHaveBeenCalledTimes(1)
      expect(req.organization).toEqual({ id: 'org-123', role: 'unknown' })
    })

    test('should fall back to user.organizationId for tenant and params.id for app', async () => {
      mockCheckAppPermission.mockResolvedValue(true)
      req.params!.id = 'app-from-id'
      // no params.organizationId -> falls back to req.user.organizationId

      const middleware = requireAppPermission('read')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(mockCheckAppPermission).toHaveBeenCalledWith(
        'test-user-id',
        'read',
        'app-from-id',
        'test-org-id'
      )
      expect(req.organization).toEqual({ id: 'test-org-id', role: 'unknown' })
    })

    test('should require an app id', async () => {
      req.params!.organizationId = 'org-123'

      const middleware = requireAppPermission('read')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        error: 'App ID required',
        code: 'APP_ID_REQUIRED',
      })
      expect(next).not.toHaveBeenCalled()
      expect(mockCheckAppPermission).not.toHaveBeenCalled()
    })

    test('should require organization context', async () => {
      req.user!.organizationId = undefined
      req.params!.appId = 'app-123'

      const middleware = requireAppPermission('read')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Organization context required',
        code: 'ORG_CONTEXT_REQUIRED',
      })
      expect(next).not.toHaveBeenCalled()
      expect(mockCheckAppPermission).not.toHaveBeenCalled()
    })

    test('should deny when app permission is not granted', async () => {
      mockCheckAppPermission.mockResolvedValue(false)
      req.params!.appId = 'app-123'
      req.params!.organizationId = 'org-123'

      const middleware = requireAppPermission('delete')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Insufficient app permissions',
        code: 'APP_PERMISSION_DENIED',
        required: { action: 'delete', appId: 'app-123', organizationId: 'org-123' },
      })
      expect(next).not.toHaveBeenCalled()
    })

    test('should require authentication', async () => {
      delete req.user
      req.params!.appId = 'app-123'
      req.params!.organizationId = 'org-123'

      const middleware = requireAppPermission('read')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('requireUserManagementPermission', () => {
    test('should allow access and pass target user id', async () => {
      mockCheckUserManagementPermission.mockResolvedValue(true)
      req.params!.organizationId = 'org-123'
      req.params!.userId = 'target-user-9'

      const middleware = requireUserManagementPermission('remove')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(mockCheckUserManagementPermission).toHaveBeenCalledWith(
        'test-user-id',
        'remove',
        'org-123',
        'target-user-9'
      )
      expect(next).toHaveBeenCalledTimes(1)
      expect(req.organization).toEqual({ id: 'org-123', role: 'unknown' })
    })

    test('should read target user id from body when not in params', async () => {
      mockCheckUserManagementPermission.mockResolvedValue(true)
      req.params!.organizationId = 'org-123'
      req.body = { userId: 'body-user-7' }

      const middleware = requireUserManagementPermission('invite')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(mockCheckUserManagementPermission).toHaveBeenCalledWith(
        'test-user-id',
        'invite',
        'org-123',
        'body-user-7'
      )
    })

    test('should require organization context', async () => {
      req.user!.organizationId = undefined

      const middleware = requireUserManagementPermission('view_members')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Organization context required',
        code: 'ORG_CONTEXT_REQUIRED',
      })
      expect(next).not.toHaveBeenCalled()
      expect(mockCheckUserManagementPermission).not.toHaveBeenCalled()
    })

    test('should deny when user management permission not granted', async () => {
      mockCheckUserManagementPermission.mockResolvedValue(false)
      req.params!.organizationId = 'org-123'

      const middleware = requireUserManagementPermission('update_role')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Insufficient user management permissions',
        code: 'USER_MGMT_PERMISSION_DENIED',
        required: {
          action: 'update_role',
          organizationId: 'org-123',
          targetUserId: undefined,
        },
      })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('requireRole', () => {
    test('should allow access when user has required role', () => {
      req.user!.roles = ['admin', 'user']

      const middleware = requireRole(['admin'])

      middleware(req as AuthenticatedRequest, res, next)

      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
    })

    test('should require authentication', () => {
      delete req.user

      const middleware = requireRole(['admin'])

      middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      })
      expect(next).not.toHaveBeenCalled()
    })

    test('should deny access when user lacks required role', () => {
      req.user!.roles = ['user']

      const middleware = requireRole(['admin'])

      middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Insufficient role permissions',
        code: 'ROLE_PERMISSION_DENIED',
        required: { roles: ['admin'] },
        current: { roles: ['user'] },
      })
      expect(next).not.toHaveBeenCalled()
    })

    test('should allow access when user has any of multiple required roles', () => {
      req.user!.roles = ['member', 'user']

      const middleware = requireRole(['admin', 'member'])

      middleware(req as AuthenticatedRequest, res, next)

      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
    })

    test('should handle missing roles array', () => {
      req.user!.roles = undefined as any

      const middleware = requireRole(['admin'])

      middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Insufficient role permissions',
        code: 'ROLE_PERMISSION_DENIED',
        required: { roles: ['admin'] },
        current: { roles: [] },
      })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('requireOwnership', () => {
    test('should allow access when caller owns the resource', async () => {
      const getOwner = jest.fn().mockResolvedValue('test-user-id')

      const middleware = requireOwnership(getOwner)

      await middleware(req as AuthenticatedRequest, res, next)

      expect(getOwner).toHaveBeenCalledWith(req)
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
    })

    test('should return 404 when the resource owner cannot be resolved', async () => {
      const getOwner = jest.fn().mockResolvedValue(null)

      const middleware = requireOwnership(getOwner)

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Resource not found',
        code: 'RESOURCE_NOT_FOUND',
      })
      expect(next).not.toHaveBeenCalled()
    })

    test('should deny access when caller is not the owner', async () => {
      const getOwner = jest.fn().mockResolvedValue('someone-else')

      const middleware = requireOwnership(getOwner)

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Resource access denied - ownership required',
        code: 'OWNERSHIP_REQUIRED',
      })
      expect(next).not.toHaveBeenCalled()
    })

    test('should return 500 when the owner lookup throws', async () => {
      const getOwner = jest.fn().mockRejectedValue(new Error('db down'))

      const middleware = requireOwnership(getOwner)

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Ownership check failed',
        code: 'OWNERSHIP_CHECK_ERROR',
      })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('requireAnyPermission', () => {
    test('should allow access as soon as one permission matches', async () => {
      // First check denies, second grants -> should pass on the second.
      mockCheckPermission
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
      req.params!.organizationId = 'org-123'

      const middleware = requireAnyPermission([
        { resource: 'A', action: 'read' },
        { resource: 'B', action: 'update' },
      ])

      await middleware(req as AuthenticatedRequest, res, next)

      expect(mockCheckPermission).toHaveBeenCalledTimes(2)
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
      expect(req.organization).toEqual({ id: 'org-123', role: 'unknown' })
    })

    test('should deny when none of the permissions match', async () => {
      mockCheckPermission.mockResolvedValue(false)
      req.params!.organizationId = 'org-123'

      const middleware = requireAnyPermission([
        { resource: 'A', action: 'read' },
        { resource: 'B', action: 'update' },
      ])

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        error:
          'Insufficient permissions - none of the required permissions were found',
        code: 'NO_MATCHING_PERMISSIONS',
        required: [
          { action: 'read', resource: 'A' },
          { action: 'update', resource: 'B' },
        ],
      })
      expect(next).not.toHaveBeenCalled()
    })

    test('should require authentication', async () => {
      delete req.user

      const middleware = requireAnyPermission([
        { resource: 'A', action: 'read' },
      ])

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      })
      expect(next).not.toHaveBeenCalled()
      expect(mockCheckPermission).not.toHaveBeenCalled()
    })
  })

  describe('PermissionMiddleware convenience methods', () => {
    test('should expose all expected middleware as callable functions', () => {
      const expected = [
        'canCreateOrganization',
        'canReadOrganization',
        'canUpdateOrganization',
        'canDeleteOrganization',
        'canManageOrganization',
        'canCreateApp',
        'canReadApp',
        'canUpdateApp',
        'canDeleteApp',
        'canInstallApp',
        'canUninstallApp',
        'canInviteUsers',
        'canRemoveUsers',
        'canUpdateUserRoles',
        'canViewMembers',
        'adminOnly',
        'ownerOrAdmin',
        'memberOrAbove',
        'custom',
      ] as const

      for (const name of expected) {
        expect(typeof (PermissionMiddleware as any)[name]).toBe('function')
      }
    })

    test('adminOnly should behave as requireRole(["admin"])', () => {
      req.user!.roles = ['admin']
      PermissionMiddleware.adminOnly(req as AuthenticatedRequest, res, next)
      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
    })

    test('memberOrAbove should deny a plain user', () => {
      req.user!.roles = ['user']
      PermissionMiddleware.memberOrAbove(req as AuthenticatedRequest, res, next)
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Insufficient role permissions',
        code: 'ROLE_PERMISSION_DENIED',
        required: { roles: ['owner', 'admin', 'member'] },
        current: { roles: ['user'] },
      })
      expect(next).not.toHaveBeenCalled()
    })

    test('canDeleteApp should delegate to checkAppPermission with action "delete"', async () => {
      mockCheckAppPermission.mockResolvedValue(true)
      req.params!.appId = 'app-xyz'
      req.params!.organizationId = 'org-xyz'

      await PermissionMiddleware.canDeleteApp(
        req as AuthenticatedRequest,
        res,
        next
      )

      expect(mockCheckAppPermission).toHaveBeenCalledWith(
        'test-user-id',
        'delete',
        'app-xyz',
        'org-xyz'
      )
      expect(next).toHaveBeenCalledTimes(1)
    })
  })
})
