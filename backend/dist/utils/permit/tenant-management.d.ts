import { Organization } from '../../types/shared';
export interface PermitTenant {
    key: string;
    name: string;
    description?: string;
    attributes?: Record<string, any>;
}
/**
 * Returns true when `error` is a benign "already exists" conflict (HTTP 409 /
 * duplicate / already exists) rather than a real failure. Permit's SDK surfaces
 * the upstream status in a few different shapes depending on version, so we
 * probe all of them plus the message text.
 */
export declare function isAlreadyExistsError(error: any): boolean;
/**
 * Creates a tenant in Permit.io for an organization.
 *
 * Idempotent: a 409 / "already exists" from a prior run is treated as success
 * so reconciliation can be re-run safely. Any other error is rethrown so the
 * caller records the step as `failed` (with `last_error`) and retries later.
 */
export declare function createTenantInPermit(organization: Organization): Promise<boolean>;
/**
 * Updates a tenant in Permit.io
 */
export declare function updateTenantInPermit(organizationId: string, updates: Partial<PermitTenant>): Promise<boolean>;
/**
 * Deletes a tenant from Permit.io
 */
export declare function deleteTenantFromPermit(organizationId: string): Promise<boolean>;
/**
 * Gets tenant data from Permit.io
 */
export declare function getTenantFromPermit(organizationId: string): Promise<any>;
/**
 * Lists all tenants in Permit.io
 */
export declare function listTenantsFromPermit(): Promise<any>;
//# sourceMappingURL=tenant-management.d.ts.map