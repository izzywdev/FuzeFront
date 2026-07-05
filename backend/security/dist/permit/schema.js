"use strict";
// Declarative Permit.io authorization schema (IaC). The single source of truth
// for the resources/actions the backend checks (src/utils/permit/permission-check.ts,
// src/middleware/permissions.ts) and the tenant roles it assigns
// (src/utils/permit/role-assignment.ts: owner/admin -> admin, member -> editor, viewer -> viewer).
//
// This base schema is the PLATFORM policy. Consumer products (e.g. FuzeMarket)
// declare their OWN resources/actions/roles as a ProductPolicy and the platform
// merges them — namespaced to avoid collisions — into this schema before syncing
// to Permit. See ./product-policy.ts and docs/consumers/authn-authz-integration.md.
Object.defineProperty(exports, "__esModule", { value: true });
exports.permitSchema = void 0;
const action = (name) => ({ name });
exports.permitSchema = {
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
};
//# sourceMappingURL=schema.js.map