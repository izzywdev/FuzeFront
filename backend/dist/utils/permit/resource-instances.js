'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
exports.createAppResourceInstance = createAppResourceInstance
exports.updateResourceInstance = updateResourceInstance
exports.deleteResourceInstance = deleteResourceInstance
exports.getResourceInstance = getResourceInstance
exports.listResourceInstances = listResourceInstances
exports.createOrganizationResourceInstance = createOrganizationResourceInstance
exports.grantResourceAccess = grantResourceAccess
exports.revokeResourceAccess = revokeResourceAccess
const permit_1 = __importDefault(require('../../config/permit'))
/**
 * Creates a resource instance in Permit.io for an app
 */
async function createAppResourceInstance(app, organizationId) {
  try {
    const resourceInstance = {
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
    await permit_1.default.api.resourceInstances.create(resourceInstance)
    console.log(
      `App resource instance ${app.id} created in Permit.io for tenant ${organizationId}`
    )
    return true
  } catch (error) {
    console.error(`Error creating app resource instance ${app.id}:`, error)
    return false
  }
}
/**
 * Updates a resource instance in Permit.io
 */
async function updateResourceInstance(resourceKey, tenant, updates) {
  try {
    await permit_1.default.api.resourceInstances.update(resourceKey, updates)
    console.log(`Resource instance ${resourceKey} updated in Permit.io`)
    return true
  } catch (error) {
    console.error(`Error updating resource instance ${resourceKey}:`, error)
    return false
  }
}
/**
 * Deletes a resource instance from Permit.io
 */
async function deleteResourceInstance(resourceKey) {
  try {
    await permit_1.default.api.resourceInstances.delete(resourceKey)
    console.log(`Resource instance ${resourceKey} deleted from Permit.io`)
    return true
  } catch (error) {
    console.error(`Error deleting resource instance ${resourceKey}:`, error)
    return false
  }
}
/**
 * Gets a resource instance from Permit.io
 */
async function getResourceInstance(resourceKey) {
  try {
    const instance =
      await permit_1.default.api.resourceInstances.get(resourceKey)
    return instance
  } catch (error) {
    console.error(`Error getting resource instance ${resourceKey}:`, error)
    return null
  }
}
/**
 * Lists resource instances for a tenant
 */
async function listResourceInstances(tenant, resourceType) {
  try {
    const filter = { tenant }
    if (resourceType) {
      filter.resource = resourceType
    }
    const instances = await permit_1.default.api.resourceInstances.list(filter)
    return instances
  } catch (error) {
    console.error(
      `Error listing resource instances for tenant ${tenant}:`,
      error
    )
    return []
  }
}
/**
 * Creates an organization resource instance
 */
async function createOrganizationResourceInstance(organizationId) {
  try {
    const resourceInstance = {
      key: organizationId,
      tenant: organizationId, // Organization is a tenant for itself
      resource: 'Organization',
    }
    await permit_1.default.api.resourceInstances.create(resourceInstance)
    console.log(
      `Organization resource instance ${organizationId} created in Permit.io`
    )
    return true
  } catch (error) {
    console.error(
      `Error creating organization resource instance ${organizationId}:`,
      error
    )
    return false
  }
}
/**
 * Grants access to a resource instance for a user
 */
async function grantResourceAccess(
  userId,
  resourceKey,
  tenant,
  role = 'viewer'
) {
  try {
    await permit_1.default.api.roleAssignments.assign({
      user: userId,
      role,
      tenant,
      resource_instance: resourceKey,
    })
    console.log(
      `Access granted to user ${userId} for resource ${resourceKey} with role ${role}`
    )
    return true
  } catch (error) {
    console.error(`Error granting resource access:`, error)
    return false
  }
}
/**
 * Revokes access to a resource instance for a user
 */
async function revokeResourceAccess(
  userId,
  resourceKey,
  tenant,
  role = 'viewer'
) {
  try {
    await permit_1.default.api.roleAssignments.unassign({
      user: userId,
      role,
      tenant,
      resource_instance: resourceKey,
    })
    console.log(
      `Access revoked for user ${userId} from resource ${resourceKey}`
    )
    return true
  } catch (error) {
    console.error(`Error revoking resource access:`, error)
    return false
  }
}
//# sourceMappingURL=resource-instances.js.map
