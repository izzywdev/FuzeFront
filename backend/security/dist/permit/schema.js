"use strict";
// Declarative Permit.io authorization schema (IaC). The single source of truth
// for the resources/actions the backend checks (src/utils/permit/permission-check.ts,
// src/middleware/permissions.ts) and the tenant roles it assigns
// (src/utils/permit/role-assignment.ts: owner/admin -> admin, member -> editor, viewer -> viewer).
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
            ],
        },
        {
            key: 'editor',
            name: 'Editor',
            permissions: [
                'Organization:read',
                'App:create', 'App:read', 'App:update', 'App:install', 'App:uninstall',
                'UserManagement:view_members',
            ],
        },
        {
            key: 'viewer',
            name: 'Viewer',
            permissions: [
                'Organization:read',
                'App:read',
                'UserManagement:view_members',
            ],
        },
    ],
};
//# sourceMappingURL=schema.js.map