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
 */
import express, { Request, Response } from 'express'
import { getIdentityProvider } from '../providers/factory'
import { getAuthorizationProvider } from '../providers/authzFactory'
import type { AuthzQuery } from '../providers/AuthorizationProvider'

const router = express.Router()

function bearer(req: Request): string | null {
  const h = req.headers['authorization']
  if (!h || Array.isArray(h)) return null
  const [scheme, token] = h.split(' ')
  return scheme?.toLowerCase() === 'bearer' && token ? token : null
}

/** Resolve the caller from the bearer token, or null (→ 401). */
async function caller(req: Request): Promise<{ id: string } | null> {
  const token = bearer(req)
  if (!token) return null
  try {
    const { user } = await getIdentityProvider().getUserInfo(token)
    return user?.id ? { id: user.id } : null
  } catch {
    return null
  }
}

function unauthorized(res: Response): void {
  res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' })
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
  const c = await caller(req)
  if (!c) return unauthorized(res)
  const q = toQuery(req.body, c.id)
  if (!q) return res.status(400).json({ error: 'Malformed query', code: 'MALFORMED' })
  const allow = await getAuthorizationProvider().check(q)
  res.status(200).json({ allow })
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
  const allowed = await getAuthorizationProvider().bulkCheck(checks)
  res.status(200).json({ decisions: allowed.map(allow => ({ allow })) })
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
  const page = await getAuthorizationProvider().listMembers(req.params.id, {
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    cursor: req.query.cursor ? String(req.query.cursor) : undefined,
  })
  res.status(200).json(page)
})

router.post('/tenants/:id/members', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
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
  await getAuthorizationProvider().removeMember(req.params.id, req.params.userId)
  res.status(204).end()
})

router.get('/tenants/:id/roles', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
  const roles = await getAuthorizationProvider().listRoles(req.params.id)
  res.status(200).json({ roles })
})

router.put('/tenants/:id/members/:userId/roles', async (req: Request, res: Response) => {
  const c = await caller(req)
  if (!c) return unauthorized(res)
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
