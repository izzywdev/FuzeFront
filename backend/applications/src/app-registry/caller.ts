// Resolves the BOLA-safe caller context from the authenticated user. Mirrors the
// host backend's getMemberOrgIds + platform-admin convention
// (backend/src/routes/apps.ts): a caller's org scope is their ACTIVE
// organization_memberships; platform admin is the `admin` platform role.
import { db } from '../config/database'
import { AppCaller } from './service'
import { SYNTHETIC_CONSUMER_USER_ID } from '../middleware/consumer-auth'
import { isEffectiveAccessEnabled } from './flags'

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

/**
 * FFRNT-377 / S2 — org ids the caller OWNS (`organizations.owner_id`), which is
 * a distinct relationship from an `organization_memberships` row: an org owner
 * may have no membership row yet still, by ownership, have effective read
 * access to the org's apps ("I'm the owner but see nothing"). Returns [] on any
 * error so a lookup failure fails CLOSED (reads fall back to memberships only)
 * — but LOGS it, so a non-transient fault (dropped column, wrong DB role)
 * is distinguishable from a caller who genuinely owns no org, rather than
 * presenting as the very "owner sees nothing" bug this exists to fix.
 *
 * Filters `is_active = true`: `DELETE /api/organizations/:id` only SOFT-deletes
 * (sets `is_active = false`) and leaves `owner_id` intact, so without this an
 * owner would keep reading a deactivated org's apps forever. This matches the
 * `o.is_active = true` rule in default-installs.ts and the `status = 'active'`
 * rule in getMemberOrgIds — an inactive org grants no reads by either path.
 */
export async function getOwnedOrgIds(userId: string): Promise<string[]> {
  try {
    const rows = await db('organizations')
      .where('owner_id', userId)
      .where('is_active', true)
      .select('id')
    return rows.map((r: any) => r.id).filter(Boolean)
  } catch (error) {
    console.error(
      '[app-registry] getOwnedOrgIds failed for user %s; owner reads fall back to memberships only',
      userId,
      error
    )
    return []
  }
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

  // THE SERVICE CALLER HAS NO `users` ROW, AND MUST NOT BE LOOKED UP AS IF IT DID.
  //
  // Consumer products register via an init container presenting the pre-shared
  // CONSUMER_REGISTRATION_SECRET; consumer-auth then attaches a synthetic user
  // whose id is the string 'consumer-registration'. That is not a UUID, and
  // `organization_memberships.user_id` is `table.uuid(...)` — so passing it to
  // getMemberOrgIds made Postgres throw `invalid input syntax for type uuid`,
  // which the routes' try/catch turned into `500 {"error":"internal_error"}`.
  //
  // This broke the ENTIRE consumer registration path, not one product. GET
  // /apps/:slug is the first call register.sh makes (the idempotency probe), so
  // every consumer 500'd on its first request, retried five times, and then
  // hard-failed by design — leaving the pod in Init:CrashLoopBackOff and the
  // product absent from the portal. Observed in prod on FuzeHub: 1619 restarts
  // over 6d11h, all of them
  //   GET /api/v1/app-registry/apps/fuzehub -> 500 {"message":"Failed to get app"}
  //
  // It reads as a consumer bug — the consumer's pod is the thing crash-looping —
  // which is why it survived: the fault is here, in the platform.
  //
  // A service caller belongs to no organization, so the correct answer is an
  // empty org list, not a query. `isPlatformAdmin` still comes from `roles`
  // below, exactly as before; the consumer's `admin` role is what authorises it,
  // and nothing about that changes.
  if (user.id === SYNTHETIC_CONSUMER_USER_ID) {
    // A service principal owns no org — effective access adds nothing. Leave
    // effectiveReadOrgIds UNSET so reads fall back to its (empty) memberships.
    return {
      userId: user.id,
      organizationIds: [],
      roles,
      isPlatformAdmin: roles.includes('admin'),
    }
  }

  const organizationIds = await getMemberOrgIds(user.id)

  // FFRNT-377 / S2 — effective READ access (flag default ON). When on, the
  // read-org set is memberships ∪ orgs the caller OWNS (organizations.owner_id)
  // — so an org owner with no membership row still reads the org's apps. When
  // off, this is byte-identical to pre-S2 raw-membership reads.
  //
  // Only compute a DISTINCT effective set when the flag is on. When off we leave
  // effectiveReadOrgIds undefined rather than aliasing `organizationIds`: canRead
  // and list() fall back via `caller.effectiveReadOrgIds ?? caller.organizationIds`,
  // so the read-set never shares an array object with the mutation-set that
  // canMutate reads — an in-place mutation of one can't silently change the other.
  const useEffective = await isEffectiveAccessEnabled({ userId: user.id })
  let effectiveReadOrgIds: string[] | undefined
  if (useEffective) {
    const ownedOrgIds = await getOwnedOrgIds(user.id)
    effectiveReadOrgIds = Array.from(new Set([...organizationIds, ...ownedOrgIds]))
  }

  return {
    userId: user.id,
    organizationIds,
    roles,
    isPlatformAdmin: roles.includes('admin'),
    effectiveReadOrgIds,
  }
}
