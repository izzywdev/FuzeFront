// Platform-admin AUTHORIZATION POLICY (replaces the `roles.includes('admin')`
// magic-string check).
//
// A caller is a platform admin iff, on the ROOT organization (ROOT_ORG_ID), they
//   (a) are its OWNER (`organizations.owner_id`), OR
//   (b) hold an ACTIVE membership whose role ranks >= `admin`.
// This is the same "owner OR admin on the root org" authority the host backend
// already derives through Permit (`Organization:manage` on ROOT_ORG_ID); here it
// is read from the organizations/organization_memberships tables because this
// service owns no Permit-derived platform role and a Permit outage must not turn
// into a platform-wide lockout of the people who can fix it.
//
// FAILS CLOSED: any lookup error => NOT a platform admin (and it is logged, so a
// dropped column / wrong DB role is distinguishable from "genuinely not admin").
//
// SERVICE PRINCIPALS ARE NOT SUBJECT TO THIS. The synthetic consumer-registration
// caller has no users/org/membership row and must never be looked up here (doing
// so as a uuid CrashLooped FuzeHub for 6 days — see caller.ts). resolveCaller
// treats it as its own branch BEFORE this policy is ever consulted.
import { db } from '../config/database'
import { ROOT_ORG_ID } from './service'

/**
 * Mirror of backend/security/src/permit/schema.ts MEMBERSHIP_ROLE_RANK (S1).
 * Cross-service TS imports don't resolve (separate packages), so this is a copy;
 * tests/platform-admin.unit.test.ts parses the security source and fails if the
 * two ever drift.
 */
export const MEMBERSHIP_ROLE_RANK: Record<string, number> = {
  owner: 5,
  admin: 4,
  member: 3,
  viewer: 2,
  developer: 1,
}

/** The minimum rank that confers platform-admin authority on the root org. */
export const PLATFORM_ADMIN_MIN_RANK = MEMBERSHIP_ROLE_RANK.admin

/** True iff `role` is a known membership role ranking at or above `admin`. */
export function roleIsAdminOrHigher(role: unknown): boolean {
  if (typeof role !== 'string') return false
  const rank = MEMBERSHIP_ROLE_RANK[role]
  return typeof rank === 'number' && rank >= PLATFORM_ADMIN_MIN_RANK
}

export async function isRootOrgPlatformAdmin(userId: string): Promise<boolean> {
  try {
    const owned = await db('organizations')
      .where('id', ROOT_ORG_ID)
      .where('owner_id', userId)
      .where('is_active', true)
      .first()
    if (owned) return true

    const rows = await db('organization_memberships')
      .where('user_id', userId)
      .where('organization_id', ROOT_ORG_ID)
      .where('status', 'active')
      .select('role')
    return rows.some((r: any) => roleIsAdminOrHigher(r.role))
  } catch (error) {
    console.error(
      '[app-registry] root-org platform-admin lookup failed for user %s; treating as NOT platform admin (fail closed)',
      String(userId).replace(/[\r\n]+/g, ' '),
      error
    )
    return false
  }
}
