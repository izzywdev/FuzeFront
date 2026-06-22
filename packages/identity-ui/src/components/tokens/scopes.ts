/**
 * Canonical scope catalogue, grouped for the ScopeSelector UI. Mirrors the
 * backend `permitSchema` `<ResourceKey>:<action>` convention. Human labels are
 * resolved from the i18n `scopeLabels` map.
 */
export type ScopeGroupKey = 'apps' | 'organization' | 'userManagement'

export interface ScopeGroup {
  key: ScopeGroupKey
  scopes: string[]
}

export const SCOPE_GROUPS: ScopeGroup[] = [
  {
    key: 'apps',
    scopes: ['App:read', 'App:create', 'App:update', 'App:delete', 'App:install', 'App:uninstall'],
  },
  {
    key: 'organization',
    scopes: ['Organization:read', 'Organization:update', 'Organization:manage'],
  },
  {
    key: 'userManagement',
    scopes: [
      'UserManagement:view_members',
      'UserManagement:invite',
      'UserManagement:remove',
      'UserManagement:update_role',
    ],
  },
]

export const ALL_SCOPES: string[] = SCOPE_GROUPS.flatMap((g) => g.scopes)
