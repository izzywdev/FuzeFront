// Resolves the BOLA-safe caller context from the authenticated user. Mirrors the
// host backend's getMemberOrgIds: a caller's org scope is their ACTIVE
// organization_memberships. Platform admin is an AUTHORIZATION POLICY — owner OR
// admin-or-higher on the ROOT org (platform-admin.ts) — not a role string.
import { db } from '../config/database'
import { AppCaller } from './service'
import { SYNTHETIC_CONSUMER_USER_ID } from '../middleware/consumer-auth'
import { isEffectiveAccessEnabled, isPrivateOwnerOnlyEnabled } from './flags'
import { isRootOrgPlatformAdmin } from './platform-admin'

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
  // empty org list, not a query. The service principal is its OWN branch: it is
  // platform-trusted by the pre-shared secret consumer-auth already verified
  // (which is what attaches its `admin` role), so it is authorised from that
  // role and NEVER passed through the root-org owner/admin policy used for real
  // users below — it has no users/org/membership row to look up.
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

  // Real users: platform admin = owner OR admin-or-higher on the ROOT org.
  // `roles` (the JWT platform-role string) is deliberately NOT consulted.
  const isPlatformAdmin = await isRootOrgPlatformAdmin(user.id)

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

  // FFRNT-379 / S4 — `private` = creator/owner-only. Only when the release flag
  // is on do we resolve the orgs the caller OWNS (the "owner-context" that may
  // read a private app it did not create) and mark the caller so canRead/list
  // apply the tightened rule. Flag off => both fields stay UNSET and reads are
  // byte-identical to pre-S4.
  const privateOwnerOnly = await isPrivateOwnerOnlyEnabled({ userId: user.id })
  const ownedOrgIds = privateOwnerOnly ? await getOwnedOrgIds(user.id) : undefined

  return {
    userId: user.id,
    organizationIds,
    roles,
    isPlatformAdmin,
    effectiveReadOrgIds,
    ...(privateOwnerOnly ? { privateOwnerOnly: true, ownedOrgIds } : {}),
  }
}
