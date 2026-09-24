import permit from '../../config/permit'
import { logger } from '../../lib/logger'
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
export async function createAppResourceInstance(
  app: App,
  organizationId: string
): Promise<boolean> {
  try {
    const resourceInstance: PermitResourceInstance = {
      key: app.id,
      tenant: organizationId,
      resource: 'App',
      attributes: {
        name: app.name,
        url: app.url,
        iconUrl: app.iconUrl,
        isActive: app.isActive,
        isHealthy: app.isHealthy,
        integrationType: app.integrationType,
        description: app.description,
        visibility: app.visibility,
        marketplaceMetadata: app.marketplaceMetadata,
        isMarketplaceApproved: app.isMarketplaceApproved,
        installCount: app.installCount,
        rating: app.rating,
      },
    }

    await permit.api.resourceInstances.create(resourceInstance)
    logger.info(
      { appId: app.id, tenant: organizationId },
      'permit: app resource instance created'
    )
    return true
  } catch (error) {
    logger.error(
      { appId: app.id, tenant: organizationId, err: error },
      'permit: app resource instance create failed'
    )
    return false
  }
}

/**
 * Updates a resource instance in Permit.io
 */
export async function updateResourceInstance(
  resourceKey: string,
  tenant: string,
  updates: Partial<PermitResourceInstance>
): Promise<boolean> {
  try {
    await permit.api.resourceInstances.update(resourceKey, updates)
    logger.info({ resourceKey, tenant }, 'permit: resource instance updated')
    return true
  } catch (error) {
    logger.error(
      { resourceKey, tenant, err: error },
      'permit: resource instance update failed'
    )
    return false
  }
}

/**
 * Deletes a resource instance from Permit.io
 */
export async function deleteResourceInstance(
  resourceKey: string
): Promise<boolean> {
  try {
    await permit.api.resourceInstances.delete(resourceKey)
    logger.info({ resourceKey }, 'permit: resource instance deleted')
    return true
  } catch (error) {
    logger.error(
      { resourceKey, err: error },
      'permit: resource instance delete failed'
    )
    return false
  }
}

/**
 * Gets a resource instance from Permit.io
 */
export async function getResourceInstance(resourceKey: string) {
  try {
    const instance = await permit.api.resourceInstances.get(resourceKey)
    return instance
  } catch (error) {
    logger.error(
      { resourceKey, err: error },
      'permit: resource instance get failed'
    )
    return null
  }
}

/**
 * Lists resource instances for a tenant
 */
export async function listResourceInstances(
  tenant: string,
  resourceType?: string
) {
  try {
    const filter: any = { tenant }
    if (resourceType) {
      filter.resource = resourceType
    }

    const instances = await permit.api.resourceInstances.list(filter)
    return instances
  } catch (error) {
    logger.error(
      { tenant, resourceType, err: error },
      'permit: resource instance list failed'
    )
    return []
  }
}

/**
 * Creates an organization resource instance
 */
export async function createOrganizationResourceInstance(
  organizationId: string
): Promise<boolean> {
  try {
    const resourceInstance: PermitResourceInstance = {
      key: organizationId,
      tenant: organizationId, // Organization is a tenant for itself
      resource: 'Organization',
    }

    await permit.api.resourceInstances.create(resourceInstance)
    logger.info(
      { organizationId },
      'permit: organization resource instance created'
    )
    return true
  } catch (error) {
    logger.error(
      { organizationId, err: error },
      'permit: organization resource instance create failed'
    )
    return false
  }
}

/**
 * Grants access to a resource instance for a user
 */
export async function grantResourceAccess(
  userId: string,
  resourceKey: string,
  tenant: string,
  role: string = 'viewer'
): Promise<boolean> {
  try {
    await permit.api.roleAssignments.assign({
      user: userId,
      role,
      tenant,
      resource_instance: resourceKey,
    })
    logger.info(
      { userId, resourceKey, tenant, role },
      'permit: resource access granted'
    )
    return true
  } catch (error) {
    logger.error(
      { userId, resourceKey, tenant, role, err: error },
      'permit: resource access grant failed'
    )
    return false
  }
}

/**
 * Revokes access to a resource instance for a user
 */
export async function revokeResourceAccess(
  userId: string,
  resourceKey: string,
  tenant: string,
  role: string = 'viewer'
): Promise<boolean> {
  try {
    await permit.api.roleAssignments.unassign({
      user: userId,
      role,
      tenant,
      resource_instance: resourceKey,
    })
    logger.info(
      { userId, resourceKey, tenant, role },
      'permit: resource access revoked'
    )
    return true
  } catch (error) {
    logger.error(
      { userId, resourceKey, tenant, role, err: error },
      'permit: resource access revoke failed'
    )
    return false
  }
}
