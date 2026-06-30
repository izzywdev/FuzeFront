// Declarative Permit.io authorization schema (IaC). The single source of truth
// for the resources/actions the backend checks (src/utils/permit/permission-check.ts,
// src/middleware/permissions.ts) and the tenant roles it assigns
// (src/utils/permit/role-assignment.ts: owner/admin -> admin, member -> editor, viewer -> viewer).

export interface PermitResourceDef {
  key: string
  name: string
  actions: Record<string, { name: string }>
}

export interface PermitRoleDef {
  key: string
  name: string
  permissions: string[] // "<ResourceKey>:<action>"
}

// A ReBAC relation between two resource types, e.g. an `Agent` instance is
// `delegate_of` a `User` instance. Declared here so the relationship is RECORDED
// in the shared Permit environment (for audit/visibility). Note: enforcement of
// agent authorization is done app-side by resolving the agent to its bound
// (user, tenant) and checking AS the user — see
// src/utils/permit/agent-identity.ts and
// docs/superpowers/plans/2026-06-30-agent-identities.md. The relation is the
// recorded contract, not the enforcement mechanism.
export interface PermitRelationDef {
  key: string // relation name, e.g. 'delegate_of'
  name: string
  // The resource type that is the SUBJECT of the relation (e.g. 'Agent') and the
  // resource type it points at (e.g. 'User'): "<subject> delegate_of <object>".
  subject_resource: string
  object_resource: string
}

export interface PermitSchema {
  resources: PermitResourceDef[]
  roles: PermitRoleDef[]
  // ReBAC relations between resource types. Optional so the schema stays
  // backward-compatible with the RBAC-only sync.
  relations?: PermitRelationDef[]
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
    // Machine-identity (agent) modeling. These resource types exist so the
    // `Agent —delegate_of→ User` relationship can be declared in Permit. They
    // are deliberately action-less: an agent is never authorized via its own
    // resource roles — its reach is resolved to the delegating user (see the
    // relation note above). Instances are keyed `agent:<sub>` / the user UUID.
    {
      key: 'User',
      name: 'User',
      actions: {},
    },
    {
      key: 'Agent',
      name: 'Agent',
      actions: {},
    },
  ],
  relations: [
    {
      key: 'delegate_of',
      name: 'Delegate of',
      subject_resource: 'Agent',
      object_resource: 'User',
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
