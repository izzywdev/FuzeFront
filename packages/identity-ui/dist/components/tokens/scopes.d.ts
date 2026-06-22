/**
 * Canonical scope catalogue, grouped for the ScopeSelector UI. Mirrors the
 * backend `permitSchema` `<ResourceKey>:<action>` convention. Human labels are
 * resolved from the i18n `scopeLabels` map.
 */
export type ScopeGroupKey = 'apps' | 'organization' | 'userManagement';
export interface ScopeGroup {
    key: ScopeGroupKey;
    scopes: string[];
}
export declare const SCOPE_GROUPS: ScopeGroup[];
export declare const ALL_SCOPES: string[];
