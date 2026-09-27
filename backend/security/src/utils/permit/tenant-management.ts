import permit from '../../config/permit'
import { logger } from '../../lib/logger'
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
    logger.info({ tenantId: organization.id }, 'permit: tenant created')
    return true
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      logger.info(
        { tenantId: organization.id },
        'permit: tenant already exists (benign 409)'
      )
      return true
    }
    logger.error(
      { tenantId: organization.id, err: error },
      'permit: tenant create failed'
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
    logger.info({ tenantId: organizationId }, 'permit: tenant updated')
    return true
  } catch (error) {
    logger.error(
      { tenantId: organizationId, err: error },
      'permit: tenant update failed'
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
    logger.info({ tenantId: organizationId }, 'permit: tenant deleted')
    return true
  } catch (error) {
    logger.error(
      { tenantId: organizationId, err: error },
      'permit: tenant delete failed'
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
    logger.error(
      { tenantId: organizationId, err: error },
      'permit: tenant get failed'
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
    logger.error({ err: error }, 'permit: tenant list failed')
    return []
  }
}
