import { App } from '../../types/shared';
export interface PermitResourceInstance {
    key: string;
    tenant: string;
    resource: string;
    attributes?: Record<string, any>;
}
/**
 * Creates a resource instance in Permit.io for an app
 */
export declare function createAppResourceInstance(app: App, organizationId: string): Promise<boolean>;
/**
 * Updates a resource instance in Permit.io
 */
export declare function updateResourceInstance(resourceKey: string, tenant: string, updates: Partial<PermitResourceInstance>): Promise<boolean>;
/**
 * Deletes a resource instance from Permit.io
 */
export declare function deleteResourceInstance(resourceKey: string): Promise<boolean>;
/**
 * Gets a resource instance from Permit.io
 */
export declare function getResourceInstance(resourceKey: string): Promise<any>;
/**
 * Lists resource instances for a tenant
 */
export declare function listResourceInstances(tenant: string, resourceType?: string): Promise<any>;
/**
 * Creates an organization resource instance
 */
export declare function createOrganizationResourceInstance(organizationId: string): Promise<boolean>;
/**
 * Records the parent→child link for the ReBAC org hierarchy by creating the
 * `parent` relationship tuple between two Organization instances. After this,
 * any user holding `org-admin` on `parentOrgId` derives `org-admin` on
 * `childOrgId` (and transitively down the tree).
 *
 * Idempotent: a benign "already exists" is treated as success.
 */
export declare function setOrganizationParent(childOrgId: string, parentOrgId: string): Promise<boolean>;
/**
 * Grants a user the ReBAC `org-admin` role on a specific Organization instance.
 * Use on the FuzeOne ROOT org to make a staff member an administrator of the
 * whole tree (children inherit via the `parent` relation), or on a specific org
 * to scope them to that subtree.
 */
export declare function assignOrgAdminRebac(userId: string, organizationId: string): Promise<boolean>;
/**
 * Grants access to a resource instance for a user
 */
export declare function grantResourceAccess(userId: string, resourceKey: string, tenant: string, role?: string): Promise<boolean>;
/**
 * Revokes access to a resource instance for a user
 */
export declare function revokeResourceAccess(userId: string, resourceKey: string, tenant: string, role?: string): Promise<boolean>;
//# sourceMappingURL=resource-instances.d.ts.map