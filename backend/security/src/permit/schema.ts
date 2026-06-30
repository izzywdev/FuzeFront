// Declarative Permit.io authorization schema (IaC). The single source of truth
// for the resources/actions the backend checks (src/utils/permit/permission-check.ts,
// src/middleware/permissions.ts) and the tenant roles it assigns
// (src/utils/permit/role-assignment.ts: owner/admin -> admin, member -> editor, viewer -> viewer).
//
// This base schema is the PLATFORM policy. Consumer products (e.g. FuzeMarket)
// declare their OWN resources/actions/roles as a ProductPolicy and the platform
// merges them — namespaced to avoid collisions — into this schema before syncing
// to Permit. See ./product-policy.ts and docs/consumers/authn-authz-integration.md.

export interface PermitActionDef {
  name: string
}

// A ReBAC role *scoped to a resource instance*. Unlike the top-level tenant roles
// below, these are granted ON a specific resource instance and can be *derived*
// from a role the user holds on a RELATED instance (granted_to). This is how the
// FuzeOne root → child-tenant hierarchy works: an admin on the parent Organization
// instance derives admin on every child Organization instance reachable via the
// `parent` relation.
export interface PermitResourceRoleDef {
  name: string
  // Bare action keys on THIS resource, e.g. ['read', 'update'].
  permissions: string[]
  // ReBAC derivation: grant this role to users who already hold `role` on the
  // instance reachable from this one via `linked_by_relation`.
  granted_to?: {
    users_with_role: Array<{
      role: string
      on_resource: string
      linked_by_relation: string
    }>
  }
}

export interface PermitResourceDef {
  key: string
  name: string
  actions: Record<string, PermitActionDef>
  // ReBAC: named relations from this resource to another resource, e.g.
  // { parent: 'Organization' }. Required for instance-role derivation.
  relations?: Record<string, string>
  // ReBAC: resource-instance-scoped roles (with optional derivation). Distinct
  // from the top-level tenant `roles` array.
  roles?: Record<string, PermitResourceRoleDef>
}

export interface PermitRoleDef {
  key: string
  name: string
  permissions: string[] // "<ResourceKey>:<action>"
}

export interface PermitSchema {
  resources: PermitResourceDef[]
  roles: PermitRoleDef[]
}

const action = (name: string) => ({ name })

export const permitSchema: PermitSchema = {
  resources: [
    {
      key: 'Organization',
      name: 'Organization',
      actions: {
        create: action('Create'),
        read: action('Read'),
        update: action('Update'),
        delete: action('Delete'),
        manage: action('Manage'),
      },
      // ReBAC org hierarchy: FuzeOne is the root/parent tenant; customer orgs are
      // its children. An Organization instance may point at its parent.
      relations: {
        parent: 'Organization',
      },
      // `org-admin` on a parent Organization instance derives `org-admin` on every
      // child instance via `parent` — so FuzeOne staff (admin on the root org)
      // manage all child tenants without per-tenant assignment. This is additive
      // to the top-level `admin`/`editor`/`viewer` tenant roles below.
      roles: {
        'org-admin': {
          name: 'Organization Admin (ReBAC)',
          permissions: ['create', 'read', 'update', 'delete', 'manage'],
          granted_to: {
            users_with_role: [
              {
                role: 'org-admin',
                on_resource: 'Organization',
                linked_by_relation: 'parent',
              },
            ],
          },
        },
      },
    },
    {
      key: 'App',
      name: 'App',
      actions: {
        create: action('Create'),
        read: action('Read'),
        update: action('Update'),
        delete: action('Delete'),
        install: action('Install'),
        uninstall: action('Uninstall'),
      },
    },
    {
      key: 'UserManagement',
      name: 'User Management',
      actions: {
        invite: action('Invite'),
        remove: action('Remove'),
        update_role: action('Update Role'),
        view_members: action('View Members'),
      },
    },
    {
      key: 'Docs',
      name: 'Docs',
      actions: {
        read: action('Read'),
      },
    },
    {
      key: 'Chat',
      name: 'Chat',
      actions: {
        stream: action('Stream'),
        manage: action('Manage'),
      },
    },
  ],
  roles: [
    {
      key: 'admin',
      name: 'Admin',
      permissions: [
        'Organization:create', 'Organization:read', 'Organization:update',
        'Organization:delete', 'Organization:manage',
        'App:create', 'App:read', 'App:update', 'App:delete', 'App:install', 'App:uninstall',
        'UserManagement:invite', 'UserManagement:remove',
        'UserManagement:update_role', 'UserManagement:view_members',
        'Docs:read',
        'Chat:stream', 'Chat:manage',
      ],
    },
    {
      key: 'editor',
      name: 'Editor',
      permissions: [
        'Organization:read',
        'App:create', 'App:read', 'App:update', 'App:install', 'App:uninstall',
        'UserManagement:view_members',
        'Docs:read',
        'Chat:stream',
      ],
    },
    {
      key: 'viewer',
      name: 'Viewer',
      permissions: [
        'Organization:read',
        'App:read',
        'UserManagement:view_members',
        'Docs:read',
        'Chat:stream',
      ],
    },
  ],
}
