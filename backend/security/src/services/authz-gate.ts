/**
 * Authorization gate for the Security API's authz-graph MUTATION and
 * ENUMERATION endpoints (`/authz/grants`, `/authz/permissions`,
 * `/tenants/:id/members|roles`).
 *
 * Authentication only proves WHO the caller is. This module decides whether a
 * HUMAN (session) caller may administer the TARGET tenant/resource, via the
 * neutral `AuthorizationProvider.check()` — never a vendor SDK, never the
 * caller's own claims or request body.
 *
 * Rules (human callers):
 *  - Tenant-wide grant/revoke and member/role management require
 *    `Organization:manage` on the TARGET tenant. Only the tenant `admin` role
 *    (and the derived ReBAC `org-admin`) hold it, so a caller can never mint a
 *    role broader than the one that authorizes them, and has no standing in a
 *    tenant they do not administer.
 *  - A resource-instance-scoped grant/revoke is additionally allowed to a
 *    holder of `manage_access` on that exact instance, but only for roles that
 *    are not tenant-level roles (anti-escalation: instance access never
 *    confers a tenant role).
 *  - Fail closed: a provider that throws is a 502 (never an allow); a falsy or
 *    non-`true` decision is a 403.
 *
 * Platform scope (`/tenants` collection). Creating a tenant, and enumerating
 * EVERY tenant, are platform acts, not acts inside any one tenant. They require
 * `Organization:manage` on the platform ROOT tenant (`ROOT_ORG_ID`) — held only
 * by FuzeFront platform staff (the root-org `admin` / the derived ReBAC
 * `org-admin`, i.e. an "Employee", see services/employeeRole.ts) — or, for a
 * machine caller, the `authz:admin` scope. Everyone else may list only the
 * tenants they belong to (see `authorizePlatformAdmin`).
 *
 * Machine (client_credentials) callers keep the existing `AUTHZ_ADMIN_SCOPE`
 * contract; that check lives in the route and is intentionally NOT changed
 * here. A machine caller that already passed it is allowed through.
 */
import type { AuthorizationProvider, AuthzQuery, ResourceRef } from '../providers/AuthorizationProvider'
import { ROOT_ORG_ID } from '../migrations/014_seed_root_platform_organization'

export interface GateCaller {
  id: string
  kind: 'human' | 'machine'
  /** Only populated for machine callers (the introspected `scope` claim). */
  scopes?: string[]
}

export interface GateResult {
  allowed: boolean
  /** Present iff `allowed` is false. */
  status?: 403 | 502
  code?: 'FORBIDDEN' | 'PROVIDER_UNAVAILABLE'
  error?: string
}

/** Scope a machine caller must hold to mutate the authorization graph over HTTP. */
export const AUTHZ_ADMIN_SCOPE = 'authz:admin'

/** The check that means "may administer this tenant" (Permit `admin` + derived `org-admin`). */
export const TENANT_ADMIN_RESOURCE = 'Organization'
export const TENANT_ADMIN_ACTION = 'manage'

/** Instance-level administration of a resource (e.g. a selection list's access roster). */
export const RESOURCE_ADMIN_ACTION = 'manage_access'

/**
 * Roles that are defined at TENANT level (platform schema). An instance-scoped
 * grant must never be used to hand one out: holding `manage_access` on a
 * resource is not authority over the tenant.
 */
const TENANT_LEVEL_ROLES: ReadonlySet<string> = new Set([
  'admin',
  'org-admin',
  'owner',
  'editor',
  'viewer',
  'developer',
])

const FORBIDDEN: GateResult = {
  allowed: false,
  status: 403,
  code: 'FORBIDDEN',
  error: 'caller is not authorized to administer this tenant or resource',
}

const PROVIDER_DOWN: GateResult = {
  allowed: false,
  status: 502,
  code: 'PROVIDER_UNAVAILABLE',
  error: 'authorization provider unavailable',
}

type Decision = 'allow' | 'deny' | 'error'

/** Single fail-closed decision: only a literal `true` allows; a throw is `error`. */
async function decide(provider: AuthorizationProvider, query: AuthzQuery): Promise<Decision> {
  try {
    return (await provider.check(query)) === true ? 'allow' : 'deny'
  } catch {
    return 'error'
  }
}

function toResult(d: Decision): GateResult {
  if (d === 'allow') return { allowed: true }
  return d === 'error' ? PROVIDER_DOWN : FORBIDDEN
}

function hasAdminScope(c: GateCaller): boolean {
  return (c.scopes ?? []).includes(AUTHZ_ADMIN_SCOPE)
}

/**
 * May the caller administer `tenant` (the tenant-admin predicate)?
 * Machine callers holding `authz:admin` pass; a machine caller without the
 * scope is denied for mutations (`mutating: true`) and falls through to the
 * provider check (as its own `svc:` subject) for reads.
 */
export async function authorizeTenantAdmin(
  provider: AuthorizationProvider,
  caller: GateCaller,
  tenant: string,
  opts: { mutating: boolean }
): Promise<GateResult> {
  if (caller.kind === 'machine') {
    if (hasAdminScope(caller)) return { allowed: true }
    if (opts.mutating) return FORBIDDEN
  }
  return toResult(
    await decide(provider, {
      subject: caller.id,
      tenant,
      resource: { type: TENANT_ADMIN_RESOURCE },
      action: TENANT_ADMIN_ACTION,
    })
  )
}

/** Generic tenant-scoped check for a read (e.g. view members). Machine callers use their own subject. */
export async function authorizeTenantAction(
  provider: AuthorizationProvider,
  caller: GateCaller,
  tenant: string,
  resourceType: string,
  action: string
): Promise<GateResult> {
  if (caller.kind === 'machine' && hasAdminScope(caller)) return { allowed: true }
  return toResult(
    await decide(provider, {
      subject: caller.id,
      tenant,
      resource: { type: resourceType },
      action,
    })
  )
}

/**
 * Authorize a grant OR revoke of `role` in `tenant`, optionally scoped to a
 * resource instance. `resource` MUST be the already-normalized value that will
 * actually be passed to the provider (a resource without a key is a
 * tenant-wide assignment, so the caller must pass `undefined` for it).
 *
 * Machine callers: the `AUTHZ_ADMIN_SCOPE` check has already run in the route
 * (unchanged contract); this returns allowed.
 */
export async function authorizeGrantMutation(
  provider: AuthorizationProvider,
  caller: GateCaller,
  target: { tenant: string; role: string; resource?: ResourceRef & { key: string } }
): Promise<GateResult> {
  if (caller.kind === 'machine') return { allowed: true }

  // 1. Tenant administrator of the TARGET tenant: may grant/revoke anything in it.
  const admin = await decide(provider, {
    subject: caller.id,
    tenant: target.tenant,
    resource: { type: TENANT_ADMIN_RESOURCE },
    action: TENANT_ADMIN_ACTION,
  })
  if (admin === 'allow') return { allowed: true }
  if (admin === 'error') return PROVIDER_DOWN

  // 2. Not a tenant admin. Only an instance-scoped grant of a non-tenant-level
  //    role by a holder of manage_access on that exact instance is possible.
  const { resource, role } = target
  if (!resource || resource.type === TENANT_ADMIN_RESOURCE || TENANT_LEVEL_ROLES.has(role)) {
    return FORBIDDEN
  }
  return toResult(
    await decide(provider, {
      subject: caller.id,
      tenant: target.tenant,
      resource: { type: resource.type, key: resource.key },
      action: RESOURCE_ADMIN_ACTION,
    })
  )
}

/**
 * Authorize reading ANOTHER subject's grants/permissions in `tenant`.
 * A caller may always read their own; anything else needs tenant admin.
 */
export async function authorizeSubjectRead(
  provider: AuthorizationProvider,
  caller: GateCaller,
  subject: string,
  tenant: string
): Promise<GateResult> {
  if (subject === caller.id) return { allowed: true }
  return authorizeTenantAdmin(provider, caller, tenant, { mutating: true })
}

/**
 * May the caller act on the PLATFORM — create a tenant, or enumerate every tenant?
 *
 * Exactly `authorizeTenantAdmin` against the platform root tenant: a machine
 * caller needs `authz:admin`; a human needs `Organization:manage` on
 * `ROOT_ORG_ID`. An admin of an ordinary customer tenant has NO standing here
 * (they administer their tenant, not the platform), and neither does any
 * authenticated user. Fail-closed: a provider error is a 502, never an allow.
 */
export async function authorizePlatformAdmin(
  provider: AuthorizationProvider,
  caller: GateCaller
): Promise<GateResult> {
  return authorizeTenantAdmin(provider, caller, ROOT_ORG_ID, { mutating: true })
}
