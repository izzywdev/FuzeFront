/** Canonical active membership proof; independent of display-ID feature flags. */
import { isUuid, parseId, toUuid } from '@izzywdev/fuzefront-identity'
import { db } from '../config/database'

function canonical(type: 'organization' | 'user', value: unknown): string {
  if (typeof value !== 'string' || value.length > 255) throw new Error('Invalid identifier')
  return isUuid(value) ? value.toLowerCase() : toUuid(parseId(type, value))
}

export async function proveSessionTenant(userId: string, tenant: unknown): Promise<string | null> {
  const tenantId = canonical('organization', tenant)
  const subject = canonical('user', userId)
  const membership = await db('organization_memberships as membership')
    .join('organizations as organization', 'organization.id', 'membership.organization_id')
    .where('membership.user_id', subject)
    .where('membership.organization_id', tenantId)
    .where('membership.status', 'active')
    .where('organization.is_active', true)
    .select('membership.id')
    .first()
  return membership ? tenantId : null
}

export function canonicalSessionTenant(value: unknown): string {
  return canonical('organization', value)
}
