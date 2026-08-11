// Resolves the BOLA-safe caller context from the authenticated user. Mirrors the
// host backend's getMemberOrgIds + platform-admin convention
// (backend/src/routes/apps.ts): a caller's org scope is their ACTIVE
// organization_memberships; platform admin is the `admin` platform role.
import { db } from '../config/database'
import { AppCaller } from './service'
import { SYNTHETIC_CONSUMER_USER_ID } from '../middleware/consumer-auth'

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
    return {
      userId: user.id,
      organizationIds: [],
      roles,
      isPlatformAdmin: roles.includes('admin'),
    }
  }

  const organizationIds = await getMemberOrgIds(user.id)
  return {
    userId: user.id,
    organizationIds,
    roles,
    isPlatformAdmin: roles.includes('admin'),
  }
}
