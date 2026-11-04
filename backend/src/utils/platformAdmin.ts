import { db } from '../config/database'
import { ROOT_ORG_ID } from '../migrations/015_seed_root_platform_organization'

/**
 * Platform-admin AUTHORIZATION POLICY for the host backend — the same rule as
 * applications-service `app-registry/platform-admin.ts`: a user is a platform
 * admin iff they OWN the root org or hold an ACTIVE membership on it whose role
 * ranks >= admin (S1's MEMBERSHIP_ROLE_RANK in backend/security/src/permit/
 * schema.ts; mirrored here because that package is not importable from the host).
 * It replaces the `roles.includes('admin')` magic-role-string check. Fails CLOSED
 * on any lookup error.
 */
const ROLE_RANK: Record<string, number> = { owner: 5, admin: 4, member: 3, viewer: 2, developer: 1 }

export async function isRootOrgPlatformAdmin(userId: string): Promise<boolean> {
  try {
    const owned = await db('organizations')
      .where({ id: ROOT_ORG_ID, owner_id: userId, is_active: true })
      .first()
    if (owned) return true
    const rows = await db('organization_memberships')
      .where({ user_id: userId, organization_id: ROOT_ORG_ID, status: 'active' })
      .select('role')
    return rows.some((r: any) => (ROLE_RANK[r.role] ?? 0) >= ROLE_RANK.admin)
  } catch (error) {
    console.error('[platformAdmin] root-org lookup failed; treating as NOT platform admin (fail closed)', error)
    return false
  }
}
