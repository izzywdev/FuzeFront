import { App } from '../../types/shared'
export interface PermitResourceInstance {
  key: string
  tenant: string
  resource: string
  attributes?: Record<string, any>
}
/**
 * Creates a resource instance in Permit.io for an app
 */
export declare function createAppResourceInstance(
  app: App,
  organizationId: string
): Promise<boolean>
/**
 * Updates a resource instance in Permit.io
 */
export declare function updateResourceInstance(
  resourceKey: string,
  tenant: string,
  updates: Partial<PermitResourceInstance>
): Promise<boolean>
/**
 * Deletes a resource instance from Permit.io
 */
export declare function deleteResourceInstance(
  resourceKey: string
): Promise<boolean>
/**
 * Gets a resource instance from Permit.io
 */
export declare function getResourceInstance(
  resourceKey: string
): Promise<import('permitio/build/main/openapi').ResourceInstanceRead | null>
/**
 * Lists resource instances for a tenant
 */
export declare function listResourceInstances(
  tenant: string,
  resourceType?: string
): Promise<import('permitio/build/main/openapi').ResourceInstanceRead[]>
/**
 * Creates an organization resource instance
 */
export declare function createOrganizationResourceInstance(
  organizationId: string
): Promise<boolean>
/**
 * Grants access to a resource instance for a user
 */
export declare function grantResourceAccess(
  userId: string,
  resourceKey: string,
  tenant: string,
  role?: string
): Promise<boolean>
/**
 * Revokes access to a resource instance for a user
 */
export declare function revokeResourceAccess(
  userId: string,
  resourceKey: string,
  tenant: string,
  role?: string
): Promise<boolean>
//# sourceMappingURL=resource-instances.d.ts.map
