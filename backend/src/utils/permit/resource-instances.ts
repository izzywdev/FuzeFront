import permit from '../../config/permit'
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
export async function updateResourceInstance(
  resourceKey: string,
  tenant: string,
  updates: Partial<PermitResourceInstance>
): Promise<boolean> {
  try {
    await permit.api.resourceInstances.update(resourceKey, updates)
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
export async function deleteResourceInstance(
  resourceKey: string
): Promise<boolean> {
  try {
    await permit.api.resourceInstances.delete(resourceKey)
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
export async function getResourceInstance(resourceKey: string) {
  try {
    const instance = await permit.api.resourceInstances.get(resourceKey)
    return instance
  } catch (error) {
    console.error(`Error getting resource instance ${resourceKey}:`, error)
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

// ReBAC org hierarchy ------------------------------------------------------
// FuzeOne is the root/parent tenant; customer organizations are its children.
// The schema declares Organization.relations.parent and an `org-admin` resource
// role that derives parent→child (see src/permit/schema.ts). The two helpers
// below are the *provisioning* side: link a child org to its parent, and grant a
// user org-admin on a specific Organization instance (FuzeOne staff get it on the
// root org and thereby derive admin on every child).

/**
 * Records the parent→child link for the ReBAC org hierarchy by creating the
 * `parent` relationship tuple between two Organization instances. After this,
 * any user holding `org-admin` on `parentOrgId` derives `org-admin` on
 * `childOrgId` (and transitively down the tree).
 *
 * Idempotent: a benign "already exists" is treated as success.
 */
export async function setOrganizationParent(
  childOrgId: string,
  parentOrgId: string
): Promise<boolean> {
  try {
    await permit.api.relationshipTuples.create({
      subject: `Organization:${childOrgId}`,
      relation: 'parent',
      object: `Organization:${parentOrgId}`,
      tenant: childOrgId,
    })
    console.log(
      `Org hierarchy: ${childOrgId} parent set to ${parentOrgId} in Permit.io`
    )
    return true
  } catch (error: any) {
    const msg = String(error?.message ?? '').toLowerCase()
    if (msg.includes('already exists') || msg.includes('409') || msg.includes('duplicate')) {
      return true
    }
    console.error(
      `Error setting org parent (${childOrgId} -> ${parentOrgId}):`,
      error
    )
    return false
  }
}

/**
 * Grants a user the ReBAC `org-admin` role on a specific Organization instance.
 * Use on the FuzeOne ROOT org to make a staff member an administrator of the
 * whole tree (children inherit via the `parent` relation), or on a specific org
 * to scope them to that subtree.
 */
export async function assignOrgAdminRebac(
  userId: string,
  organizationId: string
): Promise<boolean> {
  try {
    await permit.api.roleAssignments.assign({
      user: userId,
      role: 'org-admin',
      tenant: organizationId,
      resource_instance: `Organization:${organizationId}`,
    })
    console.log(
      `ReBAC org-admin granted to ${userId} on Organization ${organizationId}`
    )
    return true
  } catch (error) {
    console.error(
      `Error granting ReBAC org-admin to ${userId} on ${organizationId}:`,
      error
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
    console.log(
      `Access revoked for user ${userId} from resource ${resourceKey}`
    )
    return true
  } catch (error) {
    console.error(`Error revoking resource access:`, error)
    return false
  }
}
