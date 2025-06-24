# Permissions Middleware Guide

This guide explains how to use the comprehensive permissions middleware system for protecting API endpoints in FuzeFront.

## Overview

The permissions middleware system provides multiple layers of authorization:

1. **Authentication** - Ensures user is logged in
2. **Role-based Access Control** - Checks user roles (admin, owner, member, viewer)
3. **Permission-based Access Control** - Uses Permit.io for fine-grained permissions
4. **Resource Ownership** - Checks if user owns specific resources
5. **Organization Context** - Ensures user has access to specific organizations

## Quick Start

### Basic Usage

```typescript
import { PermissionMiddleware } from '../middleware/permissions'

// Protect an organization endpoint
router.get(
  '/organizations/:organizationId',
  authMiddleware, // Your authentication middleware
  PermissionMiddleware.canReadOrganization,
  (req, res) => {
    // Handler code
  }
)

// Protect an app creation endpoint
router.post(
  '/organizations/:organizationId/apps',
  authMiddleware,
  PermissionMiddleware.canCreateApp,
  (req, res) => {
    // Handler code
  }
)

// Admin-only endpoint
router.get(
  '/admin/users',
  authMiddleware,
  PermissionMiddleware.adminOnly,
  (req, res) => {
    // Handler code
  }
)
```

## Available Middleware

### Organization Permissions

```typescript
// Organization CRUD operations
PermissionMiddleware.canCreateOrganization
PermissionMiddleware.canReadOrganization
PermissionMiddleware.canUpdateOrganization
PermissionMiddleware.canDeleteOrganization
PermissionMiddleware.canManageOrganization
```

### App Permissions

```typescript
// App CRUD operations
PermissionMiddleware.canCreateApp
PermissionMiddleware.canReadApp
PermissionMiddleware.canUpdateApp
PermissionMiddleware.canDeleteApp

// App marketplace operations
PermissionMiddleware.canInstallApp
PermissionMiddleware.canUninstallApp
```

### User Management Permissions

```typescript
// User management within organizations
PermissionMiddleware.canInviteUsers
PermissionMiddleware.canRemoveUsers
PermissionMiddleware.canUpdateUserRoles
PermissionMiddleware.canViewMembers
```

### Role-Based Permissions

```typescript
// Role-based access control
PermissionMiddleware.adminOnly // ['admin']
PermissionMiddleware.ownerOrAdmin // ['owner', 'admin']
PermissionMiddleware.memberOrAbove // ['owner', 'admin', 'member']
```

## Custom Permissions

### Basic Custom Permission

```typescript
import { requirePermission } from '../middleware/permissions'

router.get(
  '/custom-resource/:resourceId',
  authMiddleware,
  requirePermission({
    resource: 'CustomResource',
    action: 'read',
    requireOrganizationContext: true,
    getResourceKey: req => req.params.resourceId,
  }),
  (req, res) => {
    // Handler code
  }
)
```

### Advanced Custom Permission

```typescript
import { requirePermission } from '../middleware/permissions'

router.put(
  '/projects/:projectId/settings',
  authMiddleware,
  requirePermission({
    resource: 'Project',
    action: 'configure',
    getTenant: req => req.params.organizationId || req.user.organizationId,
    getResourceKey: req => req.params.projectId,
    requireOrganizationContext: true,
    fallbackToPublic: false,
  }),
  (req, res) => {
    // Handler code
  }
)
```

## Multiple Permission Options

```typescript
import { requireAnyPermission } from '../middleware/permissions'

// Allow access if user has ANY of these permissions
router.get(
  '/reports/:organizationId',
  authMiddleware,
  requireAnyPermission([
    {
      resource: 'Organization',
      action: 'manage',
      requireOrganizationContext: true,
    },
    { resource: 'Reports', action: 'read', requireOrganizationContext: true },
    { resource: 'Analytics', action: 'view', requireOrganizationContext: true },
  ]),
  (req, res) => {
    // Handler code
  }
)
```

## Ownership-Based Access

```typescript
import { requireOwnership } from '../middleware/permissions'
import { db } from '../config/database'

// Only allow resource owner to access
router.delete(
  '/user-profiles/:profileId',
  authMiddleware,
  requireOwnership(async req => {
    const profile = await db('user_profiles')
      .where('id', req.params.profileId)
      .first()
    return profile?.user_id || null
  }),
  (req, res) => {
    // Handler code
  }
)
```

## Error Handling

The middleware provides structured error responses:

### Authentication Error (401)

```json
{
  "error": "Authentication required",
  "code": "AUTH_REQUIRED"
}
```

### Permission Denied (403)

```json
{
  "error": "Insufficient permissions",
  "code": "PERMISSION_DENIED",
  "required": {
    "action": "read",
    "resource": "Organization",
    "tenant": "org-123",
    "resourceKey": "resource-456"
  }
}
```

### Organization Context Missing (400)

```json
{
  "error": "Organization context required",
  "code": "ORG_CONTEXT_REQUIRED"
}
```

### Permission Check Failed (500)

```json
{
  "error": "Permission check failed",
  "code": "PERMISSION_CHECK_ERROR"
}
```

## Integration Examples

### Organization Routes

```typescript
import express from 'express'
import {
  PermissionMiddleware,
  requireOwnership,
} from '../middleware/permissions'
import { authMiddleware } from '../middleware/auth'
import { db } from '../config/database'

const router = express.Router()

// List user's organizations
router.get(
  '/',
  authMiddleware,
  // No additional permissions needed - users can see their own orgs
  async (req, res) => {
    const organizations = await db('organizations')
      .join(
        'organization_memberships',
        'organizations.id',
        'organization_memberships.organization_id'
      )
      .where('organization_memberships.user_id', req.user.id)
      .select('organizations.*', 'organization_memberships.role')

    res.json({ organizations })
  }
)

// Get specific organization
router.get(
  '/:organizationId',
  authMiddleware,
  PermissionMiddleware.canReadOrganization,
  async (req, res) => {
    const organization = await db('organizations')
      .where('id', req.params.organizationId)
      .first()

    res.json(organization)
  }
)

// Create organization
router.post(
  '/',
  authMiddleware,
  // No permission check needed for creation - all users can create orgs
  async (req, res) => {
    // Organization creation logic
    res.status(201).json(newOrganization)
  }
)

// Update organization
router.put(
  '/:organizationId',
  authMiddleware,
  PermissionMiddleware.canUpdateOrganization,
  async (req, res) => {
    // Update logic
    res.json(updatedOrganization)
  }
)

// Delete organization (owner only)
router.delete(
  '/:organizationId',
  authMiddleware,
  requireOwnership(async req => {
    const org = await db('organizations')
      .where('id', req.params.organizationId)
      .first()
    return org?.owner_id || null
  }),
  async (req, res) => {
    // Delete logic
    res.status(204).send()
  }
)
```

### App Management Routes

```typescript
// List apps in organization
router.get(
  '/:organizationId/apps',
  authMiddleware,
  PermissionMiddleware.canReadOrganization,
  async (req, res) => {
    const apps = await db('apps').where(
      'organization_id',
      req.params.organizationId
    )

    res.json({ apps })
  }
)

// Create app
router.post(
  '/:organizationId/apps',
  authMiddleware,
  PermissionMiddleware.canCreateApp,
  async (req, res) => {
    // App creation logic
    res.status(201).json(newApp)
  }
)

// Update app
router.put(
  '/:organizationId/apps/:appId',
  authMiddleware,
  PermissionMiddleware.canUpdateApp,
  async (req, res) => {
    // Update logic
    res.json(updatedApp)
  }
)

// Install app from marketplace
router.post(
  '/:organizationId/apps/:appId/install',
  authMiddleware,
  PermissionMiddleware.canInstallApp,
  async (req, res) => {
    // Installation logic
    res.json({ installed: true })
  }
)
```

### User Management Routes

```typescript
// View organization members
router.get(
  '/:organizationId/members',
  authMiddleware,
  PermissionMiddleware.canViewMembers,
  async (req, res) => {
    const members = await db('organization_memberships')
      .join('users', 'organization_memberships.user_id', 'users.id')
      .where(
        'organization_memberships.organization_id',
        req.params.organizationId
      )
      .select(
        'users.id',
        'users.email',
        'users.first_name',
        'users.last_name',
        'organization_memberships.role'
      )

    res.json({ members })
  }
)

// Invite user to organization
router.post(
  '/:organizationId/members',
  authMiddleware,
  PermissionMiddleware.canInviteUsers,
  async (req, res) => {
    // Invitation logic
    res.status(201).json({ invited: true })
  }
)

// Update user role
router.put(
  '/:organizationId/members/:userId',
  authMiddleware,
  PermissionMiddleware.canUpdateUserRoles,
  async (req, res) => {
    // Role update logic
    res.json({ updated: true })
  }
)

// Remove user from organization
router.delete(
  '/:organizationId/members/:userId',
  authMiddleware,
  PermissionMiddleware.canRemoveUsers,
  async (req, res) => {
    // Removal logic
    res.status(204).send()
  }
)
```

## Advanced Patterns

### Conditional Permissions

```typescript
// Different permissions based on resource state
router.put(
  '/apps/:appId/publish',
  authMiddleware,
  async (req, res, next) => {
    const app = await db('apps').where('id', req.params.appId).first()

    if (app.status === 'draft') {
      // Draft apps need update permission
      return PermissionMiddleware.canUpdateApp(req, res, next)
    } else {
      // Published apps need manage permission
      return PermissionMiddleware.canManageOrganization(req, res, next)
    }
  },
  async (req, res) => {
    // Publish logic
  }
)
```

### Permission Composition

```typescript
// Combine multiple permission checks
const canManageAppSettings = [
  authMiddleware,
  PermissionMiddleware.canUpdateApp,
  requireRole(['admin', 'owner']), // Additional role check
]

router.put(
  '/apps/:appId/settings',
  ...canManageAppSettings,
  async (req, res) => {
    // Settings update logic
  }
)
```

### Dynamic Permission Context

```typescript
// Permission context based on request data
router.post(
  '/apps/:appId/deploy',
  authMiddleware,
  requirePermission({
    resource: 'App',
    action: 'deploy',
    getTenant: req => {
      // Get organization from app's organization
      return req.app.locals.appOrganization || req.params.organizationId
    },
    getResourceKey: req => req.params.appId,
  }),
  async (req, res) => {
    // Deployment logic
  }
)
```

## Testing Permissions

```typescript
// Example test for permission middleware
import request from 'supertest'
import { app } from '../src/app'

describe('Organization Permissions', () => {
  test('should allow organization owner to update organization', async () => {
    const response = await request(app)
      .put('/api/organizations/test-org-id')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Updated Name' })

    expect(response.status).toBe(200)
  })

  test('should deny organization update for non-members', async () => {
    const response = await request(app)
      .put('/api/organizations/test-org-id')
      .set('Authorization', `Bearer ${nonMemberToken}`)
      .send({ name: 'Updated Name' })

    expect(response.status).toBe(403)
    expect(response.body.code).toBe('ORG_PERMISSION_DENIED')
  })
})
```

## Best Practices

1. **Always use authentication middleware first**

   ```typescript
   router.get(
     '/protected',
     authMiddleware,
     PermissionMiddleware.canRead,
     handler
   )
   ```

2. **Use the most specific permission middleware available**

   ```typescript
   // Good
   PermissionMiddleware.canUpdateOrganization

   // Less specific
   PermissionMiddleware.custom({ resource: 'Organization', action: 'update' })
   ```

3. **Handle permission errors gracefully in your frontend**

   ```typescript
   try {
     await api.updateOrganization(orgId, data)
   } catch (error) {
     if (error.response?.data?.code === 'PERMISSION_DENIED') {
       showPermissionDeniedMessage()
     }
   }
   ```

4. **Use ownership checks for user-specific resources**

   ```typescript
   router.delete(
     '/profiles/:profileId',
     authMiddleware,
     requireOwnership(getProfileOwner),
     handler
   )
   ```

5. **Combine permissions when needed**
   ```typescript
   // Require both organization access AND admin role
   router.get(
     '/admin/organizations/:orgId/settings',
     authMiddleware,
     PermissionMiddleware.canReadOrganization,
     PermissionMiddleware.adminOnly,
     handler
   )
   ```

## Troubleshooting

### Common Issues

1. **"Organization context required" error**

   - Ensure the request includes `organizationId` in params or user context
   - Use `fallbackToPublic: true` for public resources

2. **Permission checks always fail**

   - Verify Permit.io setup and API key
   - Check that users and organizations are synced to Permit.io
   - Ensure roles are properly assigned

3. **Tests timing out**

   - Mock the permission check functions in tests
   - Use isolated test environments without database dependencies

4. **Performance issues**
   - Cache permission results when possible
   - Use bulk permission checks for multiple resources
   - Consider permission preloading for frequently accessed resources

This middleware system provides comprehensive protection for your API endpoints while maintaining flexibility and performance.
