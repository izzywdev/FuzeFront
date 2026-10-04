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
    // Platform S2S identity foundation (izzywdev/FuzeFront#648). A generic
    // resource TYPE for machine-to-machine call targets — instances are keyed
    // per S2S relationship (e.g. "fuzecall_control_plane", "fuzex_frames"),
    // never as new resource *types*, so onboarding a new S2S consumer never
    // needs a schema change here. A service account (synced as a Permit user
    // via utils/permit/machine-roles.ts's syncMachineIdentityToPermit, key
    // `svc:<client_id>`) is granted `invoke` on a specific instance via the
    // `s2s-caller` resource-instance role — see grantServiceInvoke /
    // revokeServiceInvoke in that same file, and
    // docs/runbooks/s2s-client-credentials.md for the end-to-end recipe.
    {
      key: 'ServiceEndpoint',
      name: 'Service Endpoint',
      actions: {
        invoke: action('Invoke'),
      },
      roles: {
        's2s-caller': {
          name: 'S2S Caller',
          // Direct assignment only — no `granted_to` derivation. Each S2S
          // relationship is a deliberate, individually-revocable grant; nothing
          // should inherit `invoke` on a service endpoint transitively.
          permissions: ['invoke'],
        },
      },
    },
    // Selection lists (services/selection-list-service/openapi.yaml, "Authorization").
    // Per-list resource: instances are keyed per list id, and access is granted
    // as one of the five instance roles below via /authz/grants (resource =
    // { type: 'SelectionList', key: <listId> }). Direct assignment only — NO
    // `granted_to` derivation and no tenant role holds any SelectionList:*
    // action (see the SelectionListCatalog resource for tenant-level actions).
    // OPEN DESIGN QUESTION: deriving list-owner from Organization admin is
    // deliberately NOT declared; nothing writes a SelectionList->Organization
    // relation tuple, so it would be inert, and customer-org admins hold the
    // tenant `admin` role rather than ReBAC org-admin.
    {
      key: 'SelectionList',
      name: 'Selection List',
      actions: {
        read: action('Read'),
        add_value: action('Add Value'),
        update_value: action('Update Value'),
        remove_value: action('Remove Value'),
        translate: action('Translate'),
        update: action('Update'),
        delete: action('Delete'),
        manage_access: action('Manage Access'),
      },
      roles: {
        'list-owner': {
          name: 'List Owner',
          permissions: [
            'read', 'add_value', 'update_value', 'remove_value',
            'translate', 'update', 'delete', 'manage_access',
          ],
        },
        'list-editor': {
          name: 'List Editor',
          permissions: ['read', 'add_value', 'update_value', 'remove_value', 'translate', 'update'],
        },
        'list-contributor': {
          name: 'List Contributor',
          permissions: ['read', 'add_value', 'update_value', 'translate'],
        },
        'list-translator': {
          name: 'List Translator',
          permissions: ['read', 'translate'],
        },
        'list-viewer': {
          name: 'List Viewer',
          permissions: ['read'],
        },
      },
    },
    // Tenant-level selection-list catalog actions (no instance): list/create
    // lists, read the quota, resolve a list by name. Granted via the tenant
    // roles below; `developer` is deliberately excluded.
    {
      key: 'SelectionListCatalog',
      name: 'Selection List Catalog',
      actions: {
        list: action('List'),
        create: action('Create'),
        read_quota: action('Read Quota'),
        resolve: action('Resolve'),
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
    // docs/planning/developers-portal.md §5.3 — developers.fuzefront.com.
    // Deliberately separate from Organization/App/etc.: a `developer`
    // root-org sign-in grants ONLY these two resources, never
    // Organization:read/App:read/UserManagement:* — see the `developer`
    // role below, which does not inherit anything from viewer/editor/admin.
    {
      key: 'DevPortalCatalog',
      name: 'Developer Portal Catalog',
      actions: {
        read: action('Read'),
      },
    },
    {
      key: 'DevPortalPlayground',
      name: 'Developer Portal Playground',
      actions: {
        use: action('Use'),
        view_history: action('View History'),
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
        'SelectionListCatalog:list', 'SelectionListCatalog:create',
        'SelectionListCatalog:read_quota', 'SelectionListCatalog:resolve',
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
        'SelectionListCatalog:list', 'SelectionListCatalog:create', 'SelectionListCatalog:resolve',
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
        'SelectionListCatalog:list', 'SelectionListCatalog:resolve',
      ],
    },
    {
      key: 'developer',
      name: 'Developer',
      // docs/planning/developers-portal.md §5.3 — deliberately narrower than
      // `viewer`: catalog + sandbox access only, nothing about the rest of
      // the platform's tenant data. A root-org `developer` membership must
      // NOT be able to read Organization/App/UserManagement/Docs/Chat.
      permissions: ['DevPortalCatalog:read', 'DevPortalPlayground:use', 'DevPortalPlayground:view_history'],
    },
  ],
}
