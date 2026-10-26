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

// ---------------------------------------------------------------------------
// Tenant-role hierarchy (FFRNT-376). The platform's org roles form a strict
// inclusion chain — a higher role carries every permission of the one below
// it: owner/admin ⊇ member/editor ⊇ viewer. Rather than hand-maintaining three
// overlapping permission lists (which silently drift), each higher role is
// COMPOSED as the lower role's set plus its own additions, so the inclusion is
// true by construction. The emitted permission sets are byte-identical to the
// prior hand-written lists; permit-role-hierarchy.test.ts fails CI if the chain
// is ever broken.
//
// `developer` is deliberately OUTSIDE this chain (developers-portal.md §5.3): a
// root-org developer gets catalog + sandbox only and must NOT inherit viewer's
// Organization/App/UserManagement/Docs/Chat reads.
// ---------------------------------------------------------------------------

const uniq = (perms: string[]): string[] => Array.from(new Set(perms))

// Lowest tier.
const viewerPermissions = uniq([
  'Organization:read',
  'App:read',
  'UserManagement:view_members',
  'Docs:read',
  'Chat:stream',
  'SelectionListCatalog:list',
  'SelectionListCatalog:resolve',
  'SelectionListCatalog:read_shared',
])

// member → editor: everything a viewer can do, plus authoring apps and lists.
const editorPermissions = uniq([
  ...viewerPermissions,
  'App:create',
  'App:update',
  'App:install',
  'App:uninstall',
  'SelectionListCatalog:create',
])

// owner/admin → admin: everything an editor can do, plus org lifecycle, member
// management, app deletion, chat management, and platform catalog ops.
const adminPermissions = uniq([
  ...editorPermissions,
  'Organization:create',
  'Organization:update',
  'Organization:delete',
  'Organization:manage',
  'App:delete',
  'UserManagement:invite',
  'UserManagement:remove',
  'UserManagement:update_role',
  'Chat:manage',
  'SelectionListCatalog:read_quota',
  'SelectionListCatalog:publish_platform',
])

// developer: orthogonal to the chain above (NOT a superset of viewer).
const developerPermissions = uniq([
  'DevPortalCatalog:read',
  'DevPortalPlayground:use',
  'DevPortalPlayground:view_history',
])

/**
 * Canonical DB-membership-role → Permit-tenant-role mapping. One source of
 * truth for utils/permit/role-assignment.ts (which previously inlined this
 * three times). Encodes the hierarchy's top collapse: a DB `owner` and a DB
 * `admin` both receive the Permit `admin` role — an org owner is implicitly the
 * top role and needs no separate lower-role assignment to hold lower-role
 * access, because `admin` already includes it. `member` → `editor`,
 * `viewer` → `viewer`, `developer` → `developer` (orthogonal).
 */
export const MEMBERSHIP_TO_PERMIT_ROLE: Record<
  'owner' | 'admin' | 'member' | 'viewer' | 'developer',
  string
> = {
  owner: 'admin',
  admin: 'admin',
  member: 'editor',
  viewer: 'viewer',
  developer: 'developer',
}

/** Fallback Permit role for an unknown membership role (least privilege). */
export const DEFAULT_PERMIT_ROLE = 'viewer'

/**
 * The tenant-role inclusion chain, lowest → highest. Each entry's permission
 * set must be a superset of the previous entry's — asserted by the drift test.
 * `developer` is intentionally absent (orthogonal).
 */
export const PERMIT_TENANT_ROLE_CHAIN = ['viewer', 'editor', 'admin'] as const

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
      // "Org-held, user-originated" ownership (docs/planning/app-builder-and-ownership.md).
      // The creator of an app holds this role ON that app instance, in the owning
      // org's tenant (applications-service assigns it via assignAppCreatorRole,
      // behind fuzefront.apps.creator-ownership). Direct assignment only — no
      // `granted_to` derivation; org owners/admins keep control through their
      // tenant roles, never through this one. Deliberately NO `delete`/`create`:
      // removing an org's app stays an org-admin decision. The grant lives and
      // dies with the org membership — see PermitAuthorizationProvider.removeMember,
      // which revokes instance-scoped assignments too.
      roles: {
        creator: {
          name: 'App Creator',
          permissions: ['read', 'update', 'install', 'uninstall'],
        },
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
        // Contract 4.1.0 (docs/planning/selection-lists-shared-and-fork.md).
        // read_shared: the membership proof behind list `visibility` — the
        // service admits a read of an `org` list (same org) or a `platform`
        // common list without an instance grant only when the caller holds
        // this IN ITS OWN TENANT. Confers no SelectionList:* action.
        read_shared: action('Read Shared Lists'),
        // publish_platform: create / promote / purge a `platform` common list.
        // Granted via tenant `admin`, but the service evaluates it in the
        // PLATFORM organization's tenant and requires the caller to act there,
        // so a customer-org admin holding it in its own tenant cannot publish.
        publish_platform: action('Publish Platform Lists'),
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
    // owner/admin → admin ⊇ member/editor ⊇ viewer. Each list is composed from
    // the one below it (see the hierarchy block above) so the inclusion is
    // drift-proof; the emitted sets are identical to the prior hand-written lists.
    { key: 'admin', name: 'Admin', permissions: adminPermissions },
    { key: 'editor', name: 'Editor', permissions: editorPermissions },
    { key: 'viewer', name: 'Viewer', permissions: viewerPermissions },
    // Orthogonal to the chain above — NOT a superset of viewer
    // (docs/planning/developers-portal.md §5.3): catalog + sandbox only, never
    // Organization/App/UserManagement/Docs/Chat.
    { key: 'developer', name: 'Developer', permissions: developerPermissions },
  ],
}
