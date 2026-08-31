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
 * accounts (see docs/runbooks/s2s-client-credentials.md). Human callers are
 * unaffected by this gate (unchanged pre-existing behavior).
 */
import express, { Request, Response } from 'express'
import { getIdentityProvider } from '../providers/factory'
import { getAuthorizationProvider } from '../providers/authzFactory'
import type { AuthzQuery } from '../providers/AuthorizationProvider'
import { withReqId } from '../lib/logger'
import { introspectMachineToken } from '../services/machine-identity'

const router = express.Router()

/** Scope a machine caller must hold to create/revoke grants (see file header). */
export const AUTHZ_ADMIN_SCOPE = 'authz:admin'

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
  const log = withReqId((req as any).requestId)
  const token = bearer(req)
  if (!token) {
    log.debug('authz: caller resolution failed — no bearer token')
    return null
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
 * Grant/revoke gate: a machine caller must hold `AUTHZ_ADMIN_SCOPE`. Human
 * callers are unaffected (pre-existing behavior, unchanged). Returns true iff
 * the request may proceed; sends the 403 itself otherwise.
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

router.post('/authz/check', async (req: Request, res: Response) => {
  const log = withReqId((req as any).requestId)
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
  const log = withReqId((req as any).requestId)
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
  const permissions = await getAuthorizationProvider().getPermissions(subject, tenant)
  res.status(200).json({ permissions })
})

// ── Grants ────────────────────────────────────────────────────────────────

router.post('/authz/grants', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
  if (!requireAuthzAdmin(c, res)) return
  const b = req.body || {}
  if (!b.subject || !b.tenant || !b.role) {
    return res.status(400).json({ error: 'subject, tenant and role are required', code: 'MALFORMED' })
  }
  try {
    const grant = await getAuthorizationProvider().grant({
      subject: String(b.subject),
      tenant: String(b.tenant),
      role: String(b.role),
      permission: b.permission,
      resource: b.resource,
    })
    res.status(201).json(grant)
  } catch (err) {
    res.status(502).json({ error: 'grant failed', code: 'PROVIDER_ERROR' })
  }
})

router.delete('/authz/grants', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
  if (!requireAuthzAdmin(c, res)) return
  const b = req.body || {}
  if (!b.grantId && !(b.subject && b.tenant && b.role)) {
    return res.status(400).json({ error: 'grantId or subject+tenant+role required', code: 'MALFORMED' })
  }
  try {
    await getAuthorizationProvider().revoke(b)
    res.status(204).end()
  } catch (err) {
    res.status(400).json({ error: (err as Error).message, code: 'MALFORMED' })
  }
})

router.get('/authz/grants', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
  const subject = req.query.subject ? String(req.query.subject) : c.id
  const tenant = String(req.query.tenant || '')
  if (!tenant) return res.status(400).json({ error: 'tenant is required', code: 'MALFORMED' })
  const page = await getAuthorizationProvider().listGrants({
    subject,
    tenant,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    cursor: req.query.cursor ? String(req.query.cursor) : undefined,
  })
  res.status(200).json(page)
})

// ── Tenants / members / roles ───────────────────────────────────────────────

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
  const tenant = await getAuthorizationProvider().getTenant(req.params.id)
  if (!tenant) return res.status(404).json({ error: 'Tenant not found', code: 'NOT_FOUND' })
  res.status(200).json(tenant)
})

router.get('/tenants/:id/members', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
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
  const tenant = await getAuthorizationProvider().getTenant(req.params.id)
  if (!tenant) return res.status(404).json({ error: 'Tenant not found', code: 'NOT_FOUND' })
  await getAuthorizationProvider().removeMember(req.params.id, req.params.userId)
  res.status(204).end()
})

router.get('/tenants/:id/roles', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
  const tenant = await getAuthorizationProvider().getTenant(req.params.id)
  if (!tenant) return res.status(404).json({ error: 'Tenant not found', code: 'NOT_FOUND' })
  const roles = await getAuthorizationProvider().listRoles(req.params.id)
  res.status(200).json({ roles })
})

router.put('/tenants/:id/members/:userId/roles', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
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
