// Declarative Permit.io authorization schema (IaC). The single source of truth
// for the resources/actions the backend checks (src/utils/permit/permission-check.ts,
// src/middleware/permissions.ts) and the tenant roles it assigns
// (src/utils/permit/role-assignment.ts: owner/admin -> admin, member -> editor, viewer -> viewer).

// A resource attribute used by ABAC and/or carried on resource instances. The
// canonical example is `sensitivity` (LOW | MEDIUM | HIGH) — see the agent-scope
// conventions in docs/guides/PERMIT_AGENT_SCOPES.md.
export interface PermitResourceAttributeDef {
  type: 'string' | 'number' | 'bool' | 'time' | 'array' | 'json'
  description?: string
}

// An *instance-scoped* (a.k.a. resource) role. Unlike top-level tenant roles,
// these are only meaningful when assigned against a specific resource instance
// (e.g. one Secret). Out-of-scope = no assignment = deny.
export interface PermitResourceRoleDef {
  name: string
  permissions: string[] // bare action keys on THIS resource, e.g. "read"
}

export interface PermitResourceDef {
  key: string
  name: string
  actions: Record<string, { name: string }>
  // Optional ABAC attributes (e.g. sensitivity tier) declared on the resource.
  attributes?: Record<string, PermitResourceAttributeDef>
  // Optional instance-scoped roles (e.g. agent_reader, approved_release).
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
    // ---------------------------------------------------------------------
    // Secret — the canonical worked example for the shared agent-scope model
    // (per-resource scoping + sensitivity tiers + time-boxed approval grants).
    // Originated for the FuzeKeys MCP Secrets-Broker. Full conventions live in
    // docs/guides/PERMIT_AGENT_SCOPES.md. This pattern (a `sensitivity`
    // attribute + a non-sensitive `read` action + a default-denied
    // `read_sensitive` action + an instance-scoped `agent_reader` role + a
    // time-boxed `approved_release` role) is the template any resource that
    // needs auto-release/human-approval tiers should copy.
    // ---------------------------------------------------------------------
    {
      key: 'Secret',
      name: 'Secret',
      actions: {
        // LOW / MEDIUM secrets: in-scope agents may read directly.
        read: action('Read'),
        // HIGH secrets: a SEPARATE action that is NOT granted by the in-scope
        // role. Satisfied only by the time-boxed `approved_release` role the
        // broker assigns after a human approves the request.
        read_sensitive: action('Read Sensitive'),
      },
      attributes: {
        // LOW | MEDIUM | HIGH — drives which action the broker checks.
        sensitivity: {
          type: 'string',
          description:
            'Sensitivity tier: LOW|MEDIUM allow in-scope read; HIGH requires read_sensitive (human-approved).',
        },
      },
      roles: {
        // In-scope, non-sensitive. Assigned per-instance to an agent identity.
        // Grants `read` ONLY — never `read_sensitive`.
        agent_reader: {
          name: 'Agent Reader',
          permissions: ['read'],
        },
        // Time-boxed grant the broker assigns AFTER a human approves a HIGH
        // request, then revokes at expiry (TTL is broker-enforced; see docs).
        // Grants `read_sensitive` (and `read`) for the life of the grant.
        approved_release: {
          name: 'Approved Release',
          permissions: ['read', 'read_sensitive'],
        },
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
