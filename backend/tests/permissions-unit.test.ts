import {
  requirePermission,
  requireOrganizationPermission,
  requireRole,
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
} from '../src/utils/permit/permission-check'

const mockCheckPermission = checkPermission as jest.MockedFunction<
  typeof checkPermission
>
const mockCheckOrganizationPermission =
  checkOrganizationPermission as jest.MockedFunction<
    typeof checkOrganizationPermission
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
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
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

      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })

    test('should use custom tenant getter', async () => {
      mockCheckPermission.mockResolvedValue(true)

      const middleware = requirePermission({
        resource: 'TestResource',
        action: 'read',
        getTenant: req => 'custom-tenant-id',
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
      expect(next).toHaveBeenCalled()
      expect(req.organization).toEqual({ id: 'test-org-123', role: 'unknown' })
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

    test('should require organization ID', async () => {
      const middleware = requireOrganizationPermission('read')

      await middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Organization ID required',
        code: 'ORG_ID_REQUIRED',
      })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('requireRole', () => {
    test('should allow access when user has required role', () => {
      req.user!.roles = ['admin', 'user']

      const middleware = requireRole(['admin'])

      middleware(req as AuthenticatedRequest, res, next)

      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
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

      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })

    test('should handle missing roles array', () => {
      req.user!.roles = undefined

      const middleware = requireRole(['admin'])

      middleware(req as AuthenticatedRequest, res, next)

      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({
        error: 'Insufficient role permissions',
        code: 'ROLE_PERMISSION_DENIED',
        required: { roles: ['admin'] },
        current: { roles: [] },
      })
    })
  })

  describe('PermissionMiddleware convenience methods', () => {
    test('should have all expected methods', () => {
      expect(PermissionMiddleware.canCreateOrganization).toBeDefined()
      expect(PermissionMiddleware.canReadOrganization).toBeDefined()
      expect(PermissionMiddleware.canUpdateOrganization).toBeDefined()
      expect(PermissionMiddleware.canDeleteOrganization).toBeDefined()
      expect(PermissionMiddleware.canManageOrganization).toBeDefined()

      expect(PermissionMiddleware.canCreateApp).toBeDefined()
      expect(PermissionMiddleware.canReadApp).toBeDefined()
      expect(PermissionMiddleware.canUpdateApp).toBeDefined()
      expect(PermissionMiddleware.canDeleteApp).toBeDefined()

      expect(PermissionMiddleware.adminOnly).toBeDefined()
      expect(PermissionMiddleware.ownerOrAdmin).toBeDefined()
      expect(PermissionMiddleware.memberOrAbove).toBeDefined()

      expect(PermissionMiddleware.custom).toBeDefined()
    })
  })
})
