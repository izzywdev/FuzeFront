import permit from '../../config/permit'
import { Organization } from '../../types/shared'

export interface PermitTenant {
  key: string
  name: string
  description?: string
  attributes?: Record<string, any>
}

/**
 * Returns true when `error` is a benign "already exists" conflict (HTTP 409 /
 * duplicate / already exists) rather than a real failure. Permit's SDK surfaces
 * the upstream status in a few different shapes depending on version, so we
 * probe all of them plus the message text.
 */
export function isAlreadyExistsError(error: any): boolean {
  if (!error) return false
  const status =
    error.status ??
    error.statusCode ??
    error.response?.status ??
    error.originalError?.response?.status
  if (status === 409) return true
  const message = String(
    error.message ?? error.response?.data?.message ?? ''
  ).toLowerCase()
  return (
    message.includes('409') ||
    message.includes('already exists') ||
    message.includes('duplicate') ||
    message.includes('conflict')
  )
}

/**
 * Creates a tenant in Permit.io for an organization.
 *
 * Idempotent: a 409 / "already exists" from a prior run is treated as success
 * so reconciliation can be re-run safely. Any other error is rethrown so the
 * caller records the step as `failed` (with `last_error`) and retries later.
 */
export async function createTenantInPermit(
  organization: Organization
): Promise<boolean> {
  const tenant: PermitTenant = {
    key: organization.id,
    name: organization.name,
    description: `Organization: ${organization.name} (${organization.type})`,
    attributes: {
      slug: organization.slug,
      type: organization.type,
      parent_id: organization.parent_id,
      owner_id: organization.owner_id,
      settings: organization.settings,
      metadata: organization.metadata,
      is_active: organization.is_active,
      created_at: organization.created_at,
      updated_at: organization.updated_at,
    },
  }

  try {
    await permit.api.tenants.create(tenant)
    console.log(`Tenant ${organization.id} created in Permit.io successfully`)
    return true
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      console.log(
        `Tenant ${organization.id} already exists in Permit.io (benign 409)`
      )
      return true
    }
    console.error(
      `Error creating tenant ${organization.id} in Permit.io:`,
      error
    )
    throw error
  }
}

/**
 * Updates a tenant in Permit.io
 */
export async function updateTenantInPermit(
  organizationId: string,
  updates: Partial<PermitTenant>
): Promise<boolean> {
  try {
    await permit.api.tenants.update(organizationId, updates)
    console.log(`Tenant ${organizationId} updated in Permit.io successfully`)
    return true
  } catch (error) {
    console.error(
      `Error updating tenant ${organizationId} in Permit.io:`,
      error
    )
    return false
  }
}

/**
 * Deletes a tenant from Permit.io
 */
export async function deleteTenantFromPermit(
  organizationId: string
): Promise<boolean> {
  try {
    await permit.api.tenants.delete(organizationId)
    console.log(`Tenant ${organizationId} deleted from Permit.io successfully`)
    return true
  } catch (error) {
    console.error(
      `Error deleting tenant ${organizationId} from Permit.io:`,
      error
    )
    return false
  }
}

/**
 * Gets tenant data from Permit.io
 */
export async function getTenantFromPermit(organizationId: string) {
  try {
    const tenant = await permit.api.tenants.get(organizationId)
    return tenant
  } catch (error) {
    console.error(
      `Error getting tenant ${organizationId} from Permit.io:`,
      error
    )
    return null
  }
}

/**
 * Lists all tenants in Permit.io
 */
export async function listTenantsFromPermit() {
  try {
    const tenants = await permit.api.tenants.list()
    return tenants
  } catch (error) {
    console.error('Error listing tenants from Permit.io:', error)
    return []
  }
}
