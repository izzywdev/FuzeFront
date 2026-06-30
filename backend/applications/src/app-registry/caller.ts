// Resolves the BOLA-safe caller context from the authenticated user. Mirrors the
// host backend's getMemberOrgIds + platform-admin convention
// (backend/src/routes/apps.ts): a caller's org scope is their ACTIVE
// organization_memberships; platform admin is the `admin` platform role.
import { db } from '../config/database'
import { AppCaller } from './service'

interface SessionUser {
  id: string
  roles?: string[]
}

/** Active org ids the caller belongs to. */
export async function getMemberOrgIds(userId: string): Promise<string[]> {
  const rows = await db('organization_memberships')
    .where('user_id', userId)
    .where('status', 'active')
    .select('organization_id')
  return rows.map((r: any) => r.organization_id).filter(Boolean)
}

/** Roles (owner/admin/member/…) the caller holds in a specific org. */
export async function getRolesInOrg(
  userId: string,
  organizationId: string
): Promise<string[]> {
  const rows = await db('organization_memberships')
    .where('user_id', userId)
    .where('organization_id', organizationId)
    .where('status', 'active')
    .select('role')
  return rows.map((r: any) => r.role).filter(Boolean)
}

export async function resolveCaller(user: SessionUser): Promise<AppCaller> {
  const roles = user.roles || []
  const organizationIds = await getMemberOrgIds(user.id)
  return {
    userId: user.id,
    organizationIds,
    roles,
    isPlatformAdmin: roles.includes('admin'),
  }
}
