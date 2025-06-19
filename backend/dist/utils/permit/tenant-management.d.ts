import { Organization } from '../../types/shared'
export interface PermitTenant {
  key: string
  name: string
  description?: string
  attributes?: Record<string, any>
}
/**
 * Creates a tenant in Permit.io for an organization
 */
export declare function createTenantInPermit(
  organization: Organization
): Promise<boolean>
/**
 * Updates a tenant in Permit.io
 */
export declare function updateTenantInPermit(
  organizationId: string,
  updates: Partial<PermitTenant>
): Promise<boolean>
/**
 * Deletes a tenant from Permit.io
 */
export declare function deleteTenantFromPermit(
  organizationId: string
): Promise<boolean>
/**
 * Gets tenant data from Permit.io
 */
export declare function getTenantFromPermit(
  organizationId: string
): Promise<import('permitio').TenantRead | null>
/**
 * Lists all tenants in Permit.io
 */
export declare function listTenantsFromPermit(): Promise<
  import('permitio').TenantRead[]
>
//# sourceMappingURL=tenant-management.d.ts.map
