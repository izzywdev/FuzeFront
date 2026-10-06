/**
 * FuzeFront Security API — AuthZ surface under `/api/v1/security`.
 *
 * `/authz/*` (decisions + grants) and `/tenants/*` (tenant/member/role
 * management), implemented PURELY against the neutral `AuthorizationProvider`
 * contract (via the env-driven factory) — no vendor is named here. Request /
 * response shapes match the frozen OpenAPI (`packages/security/openapi.yaml`)
 * and the generated `@fuzefront/security-client` types. Fail-closed throughout:
 * every route requires a valid caller identity, and decision endpoints deny on
 * any provider error (the provider itself returns `false`, never throws-allow).
 *
 * ## Machine (S2S) callers — izzywdev/FuzeFront#836 follow-up
 *
 * `caller()` accepts EITHER a FuzeFront human session token (verified via the
 * `IdentityProvider`) OR a machine `client_credentials` token (verified via
 * Authentik introspection, same mechanism as `backend/src/middleware/machine-auth.ts`'s
 * `authenticateMachineToken` — re-implemented locally per the `machine-identity.ts`
 * "absorbed copy" precedent in this service, since security-service compiles
 * within its own tsconfig `rootDir` and cannot import across the service
 * boundary). This is what makes "may caller X invoke endpoint Y?" answerable
 * by a service OUTSIDE FuzeFront: it authenticates with the S2S token it
 * already holds (see docs/runbooks/s2s-client-credentials.md) and calls this
 * HTTP API directly — the `ServiceEndpoint`/`invoke` ReBAC shape
 * (`backend/src/permit/schema.ts`, `backend/src/utils/permit/machine-roles.ts`)
 * is expressed with the SAME generic `AuthzCheckRequest`/`GrantRequest` shapes
 * already frozen in the contract (`resource: { type: 'ServiceEndpoint', key:
 * <endpointKey> }`, `action: 'invoke'`) — no new schema needed.
 *
 * A machine caller's resolved id is `svc:<client_id>` (matching the `svc:`
 * prefix `toPermitKey()` applies in `machine-roles.ts`), so a machine caller
 * that omits `subject` in its request body is, by default, asking about
 * itself — exactly the "may I invoke this endpoint" self-check.
 *
 * Grant/revoke are gated more tightly than check for machine callers: only a
 * machine identity whose introspected `scope` claim includes
 * `AUTHZ_ADMIN_SCOPE` may mutate the authorization graph over HTTP. Check is a
 * read of an existing decision (bounded blast radius: it can only ever answer
 * "may this subject act", never change what's true) so any authenticated
 * caller may query it; grant/revoke change what's true platform-wide, so they
 * are restricted to a narrow, explicitly-provisioned set of operator service
 * accounts (see docs/runbooks/s2s-client-credentials.md).
 *
 * ## Human callers — tenant-admin authorization (P0 fix)
 *
 * Human (session) callers are NOT trusted merely for being authenticated.
 * Grant/revoke, member/role mutation and cross-subject reads are authorized
 * against the TARGET tenant (and, for instance-scoped grants, the resource)
 * through `AuthorizationProvider.check()`; see `services/authz-gate.ts` for the
 * full rule set. Fail-closed: provider error ⇒ 502, never allow.
 */
import express, { Request, Response } from 'express'
import { getIdentityProvider } from '../providers/factory'
import { getAuthorizationProvider } from '../providers/authzFactory'
import type { AttributeValue, AuthzQuery, SubjectType } from '../providers/AuthorizationProvider'
import { withReqId } from '../lib/logger'
import { introspectMachineToken } from '../services/machine-identity'
import jwt from 'jsonwebtoken'
import { findMembershipByUserAndOrg, findOrgById } from '../repositories/organizationRepository'
import { parseId, fromUuid, type EntityType } from '@izzywdev/fuzefront-identity'
import {
  AUTHZ_ADMIN_SCOPE,
  authorizeGrantMutation,
  authorizeSubjectRead,
  authorizeTenantAction,
  authorizeTenantAdmin,
  type GateResult,
} from '../services/authz-gate'

const router = express.Router()

/** Scope a machine caller must hold to create/revoke grants (see file header). */
export { AUTHZ_ADMIN_SCOPE }
export const SELECTION_LIST_OWNER_GRANT_SCOPE = 'selection-list:owner-grant'

const selectionListRoles = new Set([
  'list-owner', 'list-editor', 'list-contributor', 'list-translator', 'list-viewer',
])

const fuzeKeysOwnerResources: Record<string, RegExp> = {
  fuzekeys_Identity: /^identity:[1-9][0-9]*$/,
  fuzekeys_Account: /^account:[1-9][0-9]*$/,
  fuzekeys_VaultAsset: /^api-credential:[1-9][0-9]*$/,
}

/** Re-read SQL at the grant boundary; an organization owner is not membership proof. */
async function activeMemberProof(subject: unknown, tenant: unknown) {
  const user = parseMembershipRef('user', subject)
  const organization = parseMembershipRef('organization', tenant)
  const [membership, org] = await Promise.all([
    findMembershipByUserAndOrg(user, organization), findOrgById(organization),
  ])
  return membership?.status === 'active' && org?.is_active === true
    ? { subject: user, tenant: organization, active: true as const }
    : null
}

/** Authz provider tuples retain UUID compatibility; repository references are typed. */
function parseMembershipRef<T extends EntityType>(type: T, raw: unknown) {
  return parseId(type, typeof raw === 'string' && !raw.includes('_') ? fromUuid(type, raw) : raw)
}

function validateListMemberRefs(subject: unknown, tenant: unknown, res: Response): boolean {
  try {
    parseMembershipRef('user', subject)
    parseMembershipRef('organization', tenant)
    return true
  } catch {
    res.status(400).json({ error: 'List grant requires valid user and organization references', code: 'MALFORMED' })
    return false
  }
}

/** List grants are constrained to the caller's list and an active org member. */
async function authorizeSelectionListGrant(
  c: ResolvedCaller,
  body: any,
  revoke: boolean,
): Promise<boolean> {
  if (body?.resource?.type !== 'SelectionList') return false
  if (!body.resource.key || !selectionListRoles.has(body.role) || !body.subject || !body.tenant) return false

  const membership = await findMembershipByUserAndOrg(
    parseMembershipRef('user', body.subject),
    parseMembershipRef('organization', body.tenant),
  )
  if (membership?.status !== 'active') return false

  if (c.kind === 'machine') {
    if ((c.scopes ?? []).includes(AUTHZ_ADMIN_SCOPE)) return true
    return !revoke && c.id === 'service:selection-list-service' && body.role === 'list-owner' &&
      (c.scopes ?? []).includes(SELECTION_LIST_OWNER_GRANT_SCOPE)
  }
  const gate = await authorizeGrantMutation(getAuthorizationProvider(), c, {
    tenant: body.tenant, role: body.role,
    resource: { type: 'SelectionList', key: body.resource.key },
  })
  if (gate.status === 502) throw new Error('Authorization provider unavailable')
  return gate.allowed
}



function bearer(req: Request): string | null {
  const h = req.headers['authorization']
  if (!h || Array.isArray(h)) return null
  const [scheme, token] = h.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token ? token : null
}

/** `svc:<client_id>` — mirrors `toPermitKey()` in `backend/src/utils/permit/machine-roles.ts`
 *  so a grant made against a client_id via that module and a check made here
 *  against the same client_id resolve to the identical Permit subject key. */
function toPermitKey(clientId: string): string {
  return clientId.startsWith('svc:') ? clientId : `svc:${clientId}`
}

interface ResolvedCaller {
  id: string
  kind: 'human' | 'machine'
  /** Only populated for machine callers (from the introspected `scope` claim). */
  scopes?: string[]
}

/**
 * Resolve the caller from the bearer token, or null (→ 401).
 *
 * Tries the human session path first (cheap, no network call for a
 * FuzeFront-minted token), then falls back to machine-token introspection.
 * Both paths are fail-closed: an invalid/expired/unrecognized token in EITHER
 * form resolves to null, never a default identity.
 */
async function caller(req: Request): Promise<ResolvedCaller | null> {
  const log = withReqId((req as any).requestId, req)
  const token = bearer(req)
  if (!token) {
    log.debug('authz: caller resolution failed — no bearer token')
    return null
  }
  // Workload tokens come from Security's Kubernetes TokenReview-backed
  // /tokens/workload endpoint. Verify their issuer, audience and signature
  // here; Authentik introspection does not recognize this token kind.
  const signingKey = process.env.DELEGATION_SIGNING_KEY || process.env.JWT_SECRET
  if (signingKey) {
    try {
      const claims = jwt.verify(token, signingKey, {
        algorithms: ['HS256'],
        issuer: 'fuzefront-security',
        audience: 'fuzefront-services',
      }) as jwt.JwtPayload
      if (claims.kind === 'fuze-workload' && typeof claims.sub === 'string' &&
          typeof claims.scope === 'string') {
        return { id: claims.sub, kind: 'machine', scopes: claims.scope.split(' ').filter(Boolean) }
      }
    } catch {
      // Other token kinds follow the existing human / Authentik machine paths.
    }
  }
  try {
    const { user } = await getIdentityProvider().getUserInfo(token)
    if (user?.id) return { id: user.id, kind: 'human' }
    log.debug('authz: human token resolution returned no user id — trying machine token')
  } catch (err) {
    log.debug({ err: (err as Error).message }, 'authz: human token resolution failed — trying machine token')
  }

  // Machine (client_credentials) token path — validated via provider-side
  // introspection (never local JWT verify) so revocation is respected in real
  // time. `introspectMachineToken` is already fail-closed: any transport/HTTP
  // error, timeout, or non-2xx response resolves to `{ active: false }`, never
  // a thrown exception that could bypass the check below.
  const introspection = await introspectMachineToken(token)
  if (!introspection.active || !introspection.client_id) {
    log.warn('authz: caller resolution failed — token is neither a valid session nor a valid machine token')
    return null
  }
  const scopes = introspection.scope ? introspection.scope.split(' ').filter(Boolean) : []
  return { id: toPermitKey(introspection.client_id), kind: 'machine', scopes }
}

function unauthorized(res: Response): void {
  res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' })
}

/**
 * Machine-caller gate for grant/revoke: a machine caller must hold
 * `AUTHZ_ADMIN_SCOPE`. Human callers pass THIS gate only because they are
 * authorized per-target by `authorizeGrantMutation` / `authorizeTenantAdmin`,
 * which every human-reachable route below MUST also call. Returns true iff the
 * request may proceed; sends the 403 itself otherwise.
 */
function requireAuthzAdmin(c: ResolvedCaller, res: Response): boolean {
  if (c.kind === 'machine' && !(c.scopes ?? []).includes(AUTHZ_ADMIN_SCOPE)) {
    res.status(403).json({
      error: `machine caller is missing the required '${AUTHZ_ADMIN_SCOPE}' scope`,
      code: 'FORBIDDEN',
    })
    return false
  }
  return true
}

/** Send a denied/failed gate result. Returns true iff the request may proceed. */
function enforce(
  gate: GateResult,
  res: Response,
  log: ReturnType<typeof withReqId>,
  c: ResolvedCaller,
  what: string,
  detail: Record<string, unknown>
): boolean {
  if (gate.allowed) return true
  log.warn(
    { callerId: c.id, callerKind: c.kind, what, status: gate.status, ...detail },
    'authz: request denied by tenant-admin gate'
  )
  res.status(gate.status).json({ error: gate.error, code: gate.code })
  return false
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/**
 * Normalize a request resource. `null` = malformed (400). A resource WITHOUT a
 * key is a tenant-wide assignment to the provider, so it normalizes to
 * `undefined` — what is authorized is exactly what is executed.
 */
function normalizeResource(raw: unknown): { type: string; key: string } | undefined | null {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as { type?: unknown; key?: unknown }
  if (!isNonEmptyString(r.type)) return null
  if (r.key === undefined || r.key === null || r.key === '') return undefined
  if (typeof r.key !== 'string') return null
  return { type: r.type, key: r.key }
}

/** Coerce a request-body query into the neutral AuthzQuery (subject defaults to caller). */
function toQuery(body: any, callerId: string): AuthzQuery | null {
  if (!body || typeof body !== 'object') return null
  const resource = body.resource
  if (!resource?.type || !body.action || !body.tenant) return null
  return {
    subject: body.subject || callerId,
    tenant: String(body.tenant),
    resource: { type: String(resource.type), key: resource.key ? String(resource.key) : undefined },
    action: String(body.action),
    context: body.context,
  }
}

// ── Decisions ─────────────────────────────────────────────────────────────

/** Operator-only, current SQL proof used before scoped ownership provisioning. */
router.get('/authz/membership-proof', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
  if (!requireAuthzAdmin(c, res)) return
  let subject: string
  let tenant: string
  try {
    subject = parseMembershipRef('user', req.query.subject)
    tenant = parseMembershipRef('organization', req.query.tenant)
  } catch {
    return res.status(400).json({ error: 'Valid subject and tenant are required', code: 'MALFORMED' })
  }
  const gate = await authorizeTenantAdmin(getAuthorizationProvider(), c, tenant, { mutating: true })
  if (!enforce(gate, res, withReqId((req as any).requestId, req), c, 'membership-proof', { tenant })) return
  res.set('Cache-Control', 'no-store')
  try {
    const proof = await activeMemberProof(subject, tenant)
    if (!proof) return res.status(403).json({ error: 'Active membership required', code: 'FORBIDDEN' })
    return res.status(200).json(proof)
  } catch {
    return res.status(503).json({ error: 'Membership proof unavailable', code: 'PROVIDER_UNAVAILABLE' })
  }
})

router.post('/authz/check', async (req: Request, res: Response) => {
  const log = withReqId((req as any).requestId, req)
  const c = await caller(req)
  if (!c) return unauthorized(res)
  const q = toQuery(req.body, c.id)
  if (!q) return res.status(400).json({ error: 'Malformed query', code: 'MALFORMED' })
  const start = Date.now()
  try {
    const allow = await getAuthorizationProvider().check(q)
    log.info(
      { subject: q.subject, tenant: q.tenant, resourceType: q.resource.type, action: q.action, allow, elapsedMs: Date.now() - start },
      'authz: check decided'
    )
    res.status(200).json({ allow })
  } catch (err) {
    // Fail-closed AT THE HTTP BOUNDARY, not just inside one provider
    // implementation: `PermitAuthorizationProvider.check()` already never
    // throws (its `checkPermission` helper catches and returns `false`), but
    // this route must not depend on every current-and-future provider getting
    // that right — a provider bug or a PDP outage that DOES throw must still
    // resolve to an explicit `{ allow: false }`, never a bare 500 that leaves
    // the caller's own fail-open/fail-closed handling to chance.
    log.error(
      { subject: q.subject, tenant: q.tenant, action: q.action, err: (err as Error).message },
      'authz: check errored — denying'
    )
    res.status(200).json({ allow: false })
  }
})

/**
 * Bulk decisions, index-aligned with the request.
 *
 * The wire shape is dictated by the frozen contract (`AuthzBulkCheckRequest` /
 * `AuthzBulkDecision` in packages/security/openapi.yaml): `checks` in,
 * `decisions` out, each decision an OBJECT `{allow}` — not a bare boolean. This
 * route originally shipped `queries`/`results`/`boolean[]`, which no consumer
 * generated from the contract could talk to; `@fuzefront/auth`'s bulkCheck was
 * built against the spec and fail-closed against it. The contract is the source
 * of truth — it is what consumers were told to build against — so the route
 * conforms, not the other way round.
 */
const BULK_MAX_CHECKS = 200 // contract: AuthzBulkCheckRequest.checks.maxItems

router.post('/authz/bulk-check', async (req: Request, res: Response) => {
  const log = withReqId((req as any).requestId, req)
  const c = await caller(req)
  if (!c) return unauthorized(res)
  const raw = Array.isArray(req.body?.checks) ? req.body.checks : null
  if (!raw) return res.status(400).json({ error: 'Malformed checks', code: 'MALFORMED' })

  // Bounds are enforced, not just documented. Unbounded input here fans out to
  // one PDP call per element, so an oversized array is a cheap amplification
  // vector against the policy engine — from an ALREADY-AUTHENTICATED caller,
  // which makes it worse, not better.
  if (raw.length < 1) {
    return res.status(400).json({ error: 'checks must not be empty', code: 'MALFORMED' })
  }
  if (raw.length > BULK_MAX_CHECKS) {
    return res.status(400).json({
      error: `checks exceeds the maximum of ${BULK_MAX_CHECKS}`,
      code: 'MALFORMED',
    })
  }

  const checks: AuthzQuery[] = []
  for (const item of raw) {
    const q = toQuery(item, c.id)
    if (!q) return res.status(400).json({ error: 'Malformed check in batch', code: 'MALFORMED' })
    checks.push(q)
  }
  try {
    const allowed = await getAuthorizationProvider().bulkCheck(checks)
    res.status(200).json({ decisions: allowed.map(allow => ({ allow })) })
  } catch (err) {
    // Same fail-closed-at-the-boundary guarantee as /authz/check (see its
    // comment) — index-aligned all-deny rather than a bare 500.
    log.error({ count: checks.length, err: (err as Error).message }, 'authz: bulk-check errored — denying all')
    res.status(200).json({ decisions: checks.map(() => ({ allow: false })) })
  }
})

router.get('/authz/permissions', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
  const tenant = String(req.query.tenant || '')
  if (!tenant) return res.status(400).json({ error: 'tenant is required', code: 'MALFORMED' })
  const subject = req.query.subject ? String(req.query.subject) : c.id
  const log = withReqId((req as any).requestId, req)
  // A caller may read their own effective permissions; another subject's
  // require administering the tenant.
  const gate = await authorizeSubjectRead(getAuthorizationProvider(), c, subject, tenant)
  if (!enforce(gate, res, log, c, 'permissions:read-other', { tenant })) return
  const permissions = await getAuthorizationProvider().getPermissions(subject, tenant)
  res.status(200).json({ permissions })
})

// ── Grants ────────────────────────────────────────────────────────────────

router.post('/authz/grants', async (req: Request, res: Response) => {
  const log = withReqId((req as any).requestId, req)
  const c = await caller(req)
  if (!c) return unauthorized(res)
  const b = req.body || {}
  if (!b.subject || !b.tenant || !b.role) {
    return res.status(400).json({ error: 'subject, tenant and role are required', code: 'MALFORMED' })
  }
  const resource = normalizeResource(b.resource)
  if (resource === null) {
    return res.status(400).json({ error: 'resource must be { type, key? }', code: 'MALFORMED' })
  }
  const subject = String(b.subject)
  const tenant = String(b.tenant)
  const role = String(b.role)
  const provider = getAuthorizationProvider()
  const isFuzeKeysGrant = typeof b.resource?.type === 'string' && b.resource.type.startsWith('fuzekeys_')
  if (isFuzeKeysGrant && (!resource || !fuzeKeysOwnerResources[resource.type]?.test(resource.key) ||
      role !== 'owner' || b.permission !== undefined)) {
    return res.status(400).json({ error: 'FuzeKeys owner grants require an exact supported resource instance', code: 'MALFORMED' })
  }

  // Authorize the TARGET tenant/resource for human callers (machine callers
  // already passed the AUTHZ_ADMIN_SCOPE gate above). What is authorized here
  // is exactly what is passed to the provider below.
  const isListGrant = resource?.type === 'SelectionList' || selectionListRoles.has(role)
  let gate: GateResult
  if (isListGrant) {
    if (!validateListMemberRefs(subject, tenant, res)) return
    try {
      gate = { allowed: await authorizeSelectionListGrant(c, { subject, tenant, role, resource }, false), status: 403, code: 'FORBIDDEN', error: 'List grant forbidden' }
    } catch {
      gate = { allowed: false, status: 502, code: 'PROVIDER_UNAVAILABLE', error: 'Authorization provider unavailable' }
    }
  } else {
    if (!requireAuthzAdmin(c, res)) return
    gate = await authorizeGrantMutation(provider, c, { tenant, role, resource })
  }
  if (!enforce(gate, res, log, c, 'grant', { tenant, role, resourceType: resource?.type })) return

  if (isFuzeKeysGrant) {
    try {
      parseMembershipRef('user', subject)
      parseMembershipRef('organization', tenant)
    } catch {
      return res.status(400).json({ error: 'Valid subject and tenant are required', code: 'MALFORMED' })
    }
    try {
      if (!(await activeMemberProof(subject, tenant))) {
        return res.status(403).json({ error: 'Active membership required', code: 'FORBIDDEN' })
      }
    } catch {
      return res.status(503).json({ error: 'Membership proof unavailable', code: 'PROVIDER_UNAVAILABLE' })
    }
  }

  try {
    const grant = await provider.grant({ subject, tenant, role, permission: b.permission, resource })
    log.info({ callerId: c.id, callerKind: c.kind, tenant, role, resourceType: resource?.type }, 'authz: grant created')
    res.status(201).json(grant)
  } catch (err) {
    res.status(502).json({ error: 'grant failed', code: 'PROVIDER_ERROR' })
  }
})

router.delete('/authz/grants', async (req: Request, res: Response) => {
  const log = withReqId((req as any).requestId, req)
  const c = await caller(req)
  if (!c) return unauthorized(res)
  if (!requireAuthzAdmin(c, res)) return
  const b = req.body || {}
  if (!b.grantId && !(b.subject && b.tenant && b.role)) {
    return res.status(400).json({ error: 'grantId or subject+tenant+role required', code: 'MALFORMED' })
  }
  const resource = normalizeResource(b.resource)
  if (resource === null) {
    return res.status(400).json({ error: 'resource must be { type, key? }', code: 'MALFORMED' })
  }

  // Resolve the EFFECTIVE (subject, tenant, role) tuple exactly as the
  // provider would (explicit fields win; a `tenant:subject:role` grantId fills
  // the gaps), then authorize AND execute that same tuple — a grantId naming
  // one tenant can never be used to revoke in another.
  let subject: string | undefined = b.subject ? String(b.subject) : undefined
  let tenant: string | undefined = b.tenant ? String(b.tenant) : undefined
  let role: string | undefined = b.role ? String(b.role) : undefined
  if (b.grantId) {
    const [gTenant, gSubject, gRole] = String(b.grantId).split(':')
    subject = subject ?? gSubject
    tenant = tenant ?? gTenant
    role = role ?? gRole
  }
  if (!subject || !tenant || !role) {
    return res.status(400).json({ error: 'grantId or subject+tenant+role required', code: 'MALFORMED' })
  }
  const provider = getAuthorizationProvider()
  let gate: GateResult
  if (resource?.type === 'SelectionList' || selectionListRoles.has(role)) {
    if (!validateListMemberRefs(subject, tenant, res)) return
    try {
      gate = { allowed: await authorizeSelectionListGrant(c, { subject, tenant, role, resource }, true), status: 403, code: 'FORBIDDEN', error: 'List revoke forbidden' }
    } catch {
      gate = { allowed: false, status: 502, code: 'PROVIDER_UNAVAILABLE', error: 'Authorization provider unavailable' }
    }
  } else {
    gate = await authorizeGrantMutation(provider, c, { tenant, role, resource })
  }
  if (!enforce(gate, res, log, c, 'revoke', { tenant, role, resourceType: resource?.type })) return

  try {
    await provider.revoke({ subject, tenant, role, resource })
    log.info({ callerId: c.id, callerKind: c.kind, tenant, role, resourceType: resource?.type }, 'authz: grant revoked')
    res.status(204).end()
  } catch (err) {
    res.status(400).json({ error: (err as Error).message, code: 'MALFORMED' })
  }
})

router.get('/authz/grants', async (req: Request, res: Response) => {
  const log = withReqId((req as any).requestId, req)
  const c = await caller(req)
  if (!c) return unauthorized(res)
  const subject = req.query.subject ? String(req.query.subject) : c.id
  const tenant = String(req.query.tenant || '')
  if (!tenant) return res.status(400).json({ error: 'tenant is required', code: 'MALFORMED' })
  // A caller may list their OWN grants; listing another subject's grants
  // (enumeration) requires administering the tenant.
  const gate = await authorizeSubjectRead(getAuthorizationProvider(), c, subject, tenant)
  if (!enforce(gate, res, log, c, 'grants:list-other', { tenant })) return
  const page = await getAuthorizationProvider().listGrants({
    subject,
    tenant,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    cursor: req.query.cursor ? String(req.query.cursor) : undefined,
  })
  res.status(200).json(page)
})

// ── Subject ABAC attributes ──────────────────────────────────────────────────

const SUBJECT_TYPES: ReadonlySet<string> = new Set<SubjectType>(['user', 'tenant'])

/** Validate a scalar ABAC attribute value (string, number, or boolean only — no nested objects/arrays). */
function isAttributeValue(v: unknown): v is AttributeValue {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
}

/**
 * `PATCH /authz/subjects/{subjectType}/{subjectKey}/attributes` — merge ABAC
 * attributes onto a subject. MACHINE-ONLY: a machine caller must hold
 * `AUTHZ_ADMIN_SCOPE`; human (session) callers are always denied. This writes
 * entitlement-relevant state (plan tier, seat limit) that only the operator
 * service account that owns it (billing sync) may set — no tenant role, not
 * even tenant admin, confers it.
 *
 * WRITE, not a decision: unlike `/authz/check`'s fail-closed-returns-`{allow:
 * false}` contract, a provider outage/timeout/rejection here returns an
 * explicit 502 `PROVIDER_UNAVAILABLE` — never a fail-open/fail-silent 200, so
 * a caller (e.g. billing entitlement sync) can tell the write did not land
 * and retry rather than trust a stale/absent attribute state.
 */
router.patch('/authz/subjects/:subjectType/:subjectKey/attributes', async (req: Request, res: Response) => {
  const log = withReqId((req as any).requestId, req)
  const c = await caller(req)
  if (!c) return unauthorized(res)
  if (c.kind !== 'machine') {
    log.warn({ callerId: c.id, callerKind: c.kind }, 'authz: attribute write denied — machine callers only')
    return res.status(403).json({
      error: 'subject attributes may only be written by an operator machine identity',
      code: 'FORBIDDEN',
    })
  }
  if (!requireAuthzAdmin(c, res)) return

  const subjectType = req.params.subjectType
  if (!SUBJECT_TYPES.has(subjectType)) {
    return res.status(400).json({ error: `subjectType must be one of: user, tenant`, code: 'MALFORMED' })
  }
  const subjectKey = req.params.subjectKey

  const rawAttributes = req.body?.attributes
  if (!rawAttributes || typeof rawAttributes !== 'object' || Array.isArray(rawAttributes)) {
    return res.status(400).json({ error: 'attributes is required', code: 'MALFORMED' })
  }
  const entries = Object.entries(rawAttributes)
  if (entries.length === 0) {
    return res.status(400).json({ error: 'attributes must have at least one key', code: 'MALFORMED' })
  }
  // MERGE, not replace: only the keys named here are written. Values must be
  // scalar (string/number/boolean) — this is the entire reason the endpoint
  // exists instead of a role grant (e.g. `seat_limit` must round-trip as a
  // number, never stringified).
  const attributes: Record<string, AttributeValue> = {}
  for (const [key, value] of entries) {
    if (!isAttributeValue(value)) {
      return res.status(400).json({
        error: `attribute '${key}' must be a string, number, or boolean`,
        code: 'MALFORMED',
      })
    }
    attributes[key] = value
  }

  try {
    const result = await getAuthorizationProvider().setAttributes({
      subject: { type: subjectType as SubjectType, key: subjectKey },
      attributes,
    })
    log.info(
      { subjectType, subjectKey, attributeKeys: Object.keys(attributes) },
      'authz: subject attributes merged'
    )
    res.status(200).json(result)
  } catch (err) {
    // Fail-closed AT THE HTTP BOUNDARY for a WRITE: never 200, never a bare
    // 500 — an explicit 502 PROVIDER_UNAVAILABLE so the caller can retry.
    log.error(
      { subjectType, subjectKey, err: (err as Error).message },
      'authz: setAttributes errored — provider unavailable'
    )
    res.status(502).json({ error: 'authorization provider unavailable', code: 'PROVIDER_UNAVAILABLE' })
  }
})

// ── Tenants / members / roles ───────────────────────────────────────────────

/**
 * Per-tenant authorization for the `/tenants/:id/*` routes. Runs BEFORE the
 * tenant lookup so an unauthorized caller gets 403 whether or not the tenant
 * exists (no existence oracle). `admin` = administer the tenant (mutations);
 * otherwise a read-level `{resource, action}` check on the target tenant.
 */
async function gateTenant(
  req: Request,
  res: Response,
  c: ResolvedCaller,
  tenantId: string,
  need: 'admin' | { resource: string; action: string }
): Promise<boolean> {
  const log = withReqId((req as any).requestId, req)
  const provider = getAuthorizationProvider()
  const gate =
    need === 'admin'
      ? await authorizeTenantAdmin(provider, c, tenantId, { mutating: true })
      : await authorizeTenantAction(provider, c, tenantId, need.resource, need.action)
  return enforce(gate, res, log, c, `tenant:${req.method} ${need === 'admin' ? 'admin' : need.action}`, { tenant: tenantId })
}

router.get('/tenants', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
  const page = await getAuthorizationProvider().listTenants(c.id, {
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    cursor: req.query.cursor ? String(req.query.cursor) : undefined,
  })
  res.status(200).json(page)
})

router.post('/tenants', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
  if (!req.body?.name) return res.status(400).json({ error: 'name is required', code: 'MALFORMED' })
  try {
    const tenant = await getAuthorizationProvider().createTenant({
      name: String(req.body.name),
      slug: req.body.slug ? String(req.body.slug) : undefined,
    })
    res.status(201).json(tenant)
  } catch (err) {
    res.status(502).json({ error: 'createTenant failed', code: 'PROVIDER_ERROR' })
  }
})

router.get('/tenants/:id', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
  if (!(await gateTenant(req, res, c, req.params.id, { resource: 'Organization', action: 'read' }))) return
  const tenant = await getAuthorizationProvider().getTenant(req.params.id)
  if (!tenant) return res.status(404).json({ error: 'Tenant not found', code: 'NOT_FOUND' })
  res.status(200).json(tenant)
})

router.get('/tenants/:id/members', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
  if (!(await gateTenant(req, res, c, req.params.id, { resource: 'UserManagement', action: 'view_members' }))) return
  const tenant = await getAuthorizationProvider().getTenant(req.params.id)
  if (!tenant) return res.status(404).json({ error: 'Tenant not found', code: 'NOT_FOUND' })
  const page = await getAuthorizationProvider().listMembers(req.params.id, {
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    cursor: req.query.cursor ? String(req.query.cursor) : undefined,
  })
  res.status(200).json(page)
})

router.post('/tenants/:id/members', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
  if (!(await gateTenant(req, res, c, req.params.id, 'admin'))) return
  const tenant = await getAuthorizationProvider().getTenant(req.params.id)
  if (!tenant) return res.status(404).json({ error: 'Tenant not found', code: 'NOT_FOUND' })
  if (!req.body?.userId && !req.body?.email) {
    return res.status(400).json({ error: 'userId or email is required', code: 'MALFORMED' })
  }
  try {
    const member = await getAuthorizationProvider().addMember(req.params.id, {
      userId: req.body?.userId,
      email: req.body?.email,
      roles: req.body?.roles,
    })
    res.status(201).json(member)
  } catch (err) {
    res.status(400).json({ error: (err as Error).message, code: 'MALFORMED' })
  }
})

router.delete('/tenants/:id/members/:userId', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
  if (!(await gateTenant(req, res, c, req.params.id, 'admin'))) return
  const tenant = await getAuthorizationProvider().getTenant(req.params.id)
  if (!tenant) return res.status(404).json({ error: 'Tenant not found', code: 'NOT_FOUND' })
  await getAuthorizationProvider().removeMember(req.params.id, req.params.userId)
  res.status(204).end()
})

router.get('/tenants/:id/roles', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
  if (!(await gateTenant(req, res, c, req.params.id, { resource: 'Organization', action: 'read' }))) return
  const tenant = await getAuthorizationProvider().getTenant(req.params.id)
  if (!tenant) return res.status(404).json({ error: 'Tenant not found', code: 'NOT_FOUND' })
  const roles = await getAuthorizationProvider().listRoles(req.params.id)
  res.status(200).json({ roles })
})

router.put('/tenants/:id/members/:userId/roles', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
  if (!(await gateTenant(req, res, c, req.params.id, 'admin'))) return
  const tenant = await getAuthorizationProvider().getTenant(req.params.id)
  if (!tenant) return res.status(404).json({ error: 'Tenant not found', code: 'NOT_FOUND' })
  const roles = Array.isArray(req.body?.roles) ? req.body.roles.map(String) : null
  if (!roles) return res.status(400).json({ error: 'roles[] is required', code: 'MALFORMED' })
  try {
    const member = await getAuthorizationProvider().assignRoles(req.params.id, req.params.userId, roles)
    res.status(200).json(member)
  } catch (err) {
    res.status(400).json({ error: (err as Error).message, code: 'MALFORMED' })
  }
})

export default router
