# FuzeFront Permissions System Guide

## Overview

This guide explains how to use the comprehensive permissions middleware system for protecting API endpoints in FuzeFront.

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
PermissionMiddleware.canCreateOrganization
PermissionMiddleware.canReadOrganization
PermissionMiddleware.canUpdateOrganization
PermissionMiddleware.canDeleteOrganization
PermissionMiddleware.canManageOrganization
```

### App Permissions

```typescript
PermissionMiddleware.canCreateApp
PermissionMiddleware.canReadApp
PermissionMiddleware.canUpdateApp
PermissionMiddleware.canDeleteApp
PermissionMiddleware.canInstallApp
PermissionMiddleware.canUninstallApp
```

### User Management Permissions

```typescript
PermissionMiddleware.canInviteUsers
PermissionMiddleware.canRemoveUsers
PermissionMiddleware.canUpdateUserRoles
PermissionMiddleware.canViewMembers
```

### Role-Based Permissions

```typescript
PermissionMiddleware.adminOnly // ['admin']
PermissionMiddleware.ownerOrAdmin // ['owner', 'admin']
PermissionMiddleware.memberOrAbove // ['owner', 'admin', 'member']
```

## Custom Permissions

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
    "tenant": "org-123"
  }
}
```

## Integration Example

```typescript
import express from 'express'
import { PermissionMiddleware } from '../middleware/permissions'
import { authMiddleware } from '../middleware/auth'

const router = express.Router()

// Organization routes
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

router.put(
  '/:organizationId',
  authMiddleware,
  PermissionMiddleware.canUpdateOrganization,
  async (req, res) => {
    // Update logic
    res.json(updatedOrganization)
  }
)

// App management
router.post(
  '/:organizationId/apps',
  authMiddleware,
  PermissionMiddleware.canCreateApp,
  async (req, res) => {
    // App creation logic
    res.status(201).json(newApp)
  }
)

export default router
```

## Best Practices

1. **Always use authentication middleware first**
2. **Use the most specific permission middleware available**
3. **Handle permission errors gracefully in your frontend**
4. **Use ownership checks for user-specific resources**
5. **Combine permissions when needed**

This middleware system provides comprehensive protection for your API endpoints while maintaining flexibility and performance.
