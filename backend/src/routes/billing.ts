// Host-backend billing proxy.
//
// The billing-service (`fuzefront-billing-service:3006`) is cluster-internal:
// its non-public routes are guarded by an internal bearer token
// (`BILLING_INTERNAL_TOKEN`). Browsers never talk to it directly — per
// docs/deployment/SERVICE_URL_CONVENTION.md the host backend is the trust
// boundary that proxies same-origin `/api/v1/billing/*` to the service while
// injecting that internal token.
//
// Contract: services/billing-service/openapi.yaml (the single source of truth).
//
// Auth model:
//   * User-facing routes (subscriptions, setup-intent) require a valid platform
//     JWT (authenticateToken); the proxy then presents BILLING_INTERNAL_TOKEN
//     upstream.
//   * GET /plans is the public plan catalogue (security: [] in the contract) so
//     the pricing surface can render pre-login — still token-injected upstream.
//   * POST /webhooks/stripe is unauthenticated here (authenticity is the Stripe
//     signature, verified downstream) and MUST forward the *raw* request body
//     so signature verification works. It is mounted with a raw body parser and
//     forwards the Stripe-Signature header verbatim.
import express, { Request, Response, NextFunction } from 'express'
import axios, { AxiosError, AxiosRequestConfig, Method } from 'axios'
import { authenticateToken } from '../middleware/auth'
import { checkOrganizationPermission } from '../utils/permit/permission-check'

const router = express.Router()

// ---------------------------------------------------------------------------
// Object-level authorization (BOLA/IDOR defence).
//
// The billing-service trusts whatever (entityType, entityId) it is handed and
// will act on ANY org's billing. The host backend is the trust boundary, so
// BEFORE forwarding a user-facing subscription/setup-intent request we MUST
// authorize the authenticated caller against the *target* entity, and we MUST
// server-derive the entity the action applies to rather than trusting the
// client-supplied entityType/entityId (which an attacker can set to a victim's
// org/user). See docs/deployment/SERVICE_URL_CONVENTION.md.
// ---------------------------------------------------------------------------

type EntityType = 'user' | 'organization'

interface AuthorizedEntity {
  entityType: EntityType
  entityId: string
}

// AuthenticatedRequest-like shape. `authenticateToken` populates req.user (typed
// globally as Express.Request.user?: User in src/types/express.d.ts — do NOT
// redeclare it here, that conflicts with the augmentation: TS2430). We only add
// the server-derived, authorized entity for the forwarder to use.
interface BillingRequest extends Request {
  billingEntity?: AuthorizedEntity
}

/**
 * Reads the requested target entity from the request. `entityType` /
 * `entityId` (or `organizationId`) may be supplied via the JSON body
 * (create/patch/setup-intent) or the query string (get/delete). We treat
 * these as an UNTRUSTED *request* for a target — they are validated and
 * authorized below, never forwarded verbatim.
 */
function readRequestedEntity(req: BillingRequest): {
  entityType?: string
  entityId?: string
} {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<
    string,
    unknown
  >
  const query = (req.query || {}) as Record<string, unknown>

  const entityType =
    (typeof body.entityType === 'string' && body.entityType) ||
    (typeof query.entityType === 'string' && query.entityType) ||
    undefined

  // Accept either `entityId` or `organizationId` as the org identifier.
  const entityId =
    (typeof body.entityId === 'string' && body.entityId) ||
    (typeof body.organizationId === 'string' && body.organizationId) ||
    (typeof query.entityId === 'string' && query.entityId) ||
    (typeof query.organizationId === 'string' && query.organizationId) ||
    undefined

  return { entityType: entityType || undefined, entityId: entityId || undefined }
}

/**
 * Authorize the caller against the target billing entity and return the
 * SERVER-DERIVED, trustworthy (entityType, entityId).
 *
 *  * user-scope  -> entityId is ALWAYS req.user.id (client value ignored). A
 *                  user may only act on their own billing.
 *  * org-scope   -> caller must hold the required Permit.io permission on the
 *                  target org ('manage' for mutations, 'read' for reads); the
 *                  authorized org id becomes the trusted entityId.
 *
 * On any failure it writes the response and returns null (caller must stop).
 */
async function authorizeBillingEntity(
  req: BillingRequest,
  res: Response,
  action: 'read' | 'manage'
): Promise<AuthorizedEntity | null> {
  const userId = req.user?.id
  if (!userId) {
    res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' })
    return null
  }

  const requested = readRequestedEntity(req)

  if (
    requested.entityType &&
    !['user', 'organization'].includes(requested.entityType)
  ) {
    res.status(400).json({
      error: 'Invalid entityType (must be "user" or "organization")',
      code: 'INVALID_ENTITY_TYPE',
    })
    return null
  }

  // Default to user-scope when no entityType is declared.
  const entityType: EntityType =
    requested.entityType === 'organization' ? 'organization' : 'user'

  if (entityType === 'user') {
    // SERVER-DERIVE: ignore any client-supplied entityId; a user can only ever
    // act on their own user-scoped billing.
    return { entityType: 'user', entityId: userId }
  }

  // org-scope: an org id is required and the caller must be authorized on it.
  const organizationId = requested.entityId
  if (!organizationId) {
    res.status(400).json({
      error: 'Organization id required for organization-scoped billing',
      code: 'ORG_ID_REQUIRED',
    })
    return null
  }

  let allowed: boolean
  try {
    allowed = await checkOrganizationPermission(userId, action, organizationId)
  } catch (err) {
    console.error('[billing-proxy] org permission check failed:', err)
    res
      .status(500)
      .json({ error: 'Authorization check failed', code: 'AUTHZ_CHECK_ERROR' })
    return null
  }

  if (!allowed) {
    res.status(403).json({
      error: 'Insufficient organization permissions for billing',
      code: 'ORG_PERMISSION_DENIED',
      required: { action, organizationId },
    })
    return null
  }

  return { entityType: 'organization', entityId: organizationId }
}

/**
 * Authorize a CHECKOUT request. Checkout is always organization-scoped (it
 * starts a Stripe Checkout Session for an org's subscription), so unlike the
 * generic billing routes it does not fall back to user-scope: a target
 * `organizationId` is REQUIRED and the caller must hold 'manage' on it. Returns
 * the SERVER-DERIVED authorized org entity, or writes the response + returns
 * null on any failure (caller must stop). The client-supplied organizationId is
 * treated as an untrusted *request* and is re-authorized here, never trusted.
 */
async function authorizeCheckout(
  req: BillingRequest,
  res: Response
): Promise<AuthorizedEntity | null> {
  const userId = req.user?.id
  if (!userId) {
    res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' })
    return null
  }

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<
    string,
    unknown
  >
  const organizationId =
    typeof body.organizationId === 'string' && body.organizationId
      ? body.organizationId
      : undefined

  if (!organizationId) {
    res.status(400).json({
      error: 'Organization id required for checkout',
      code: 'ORG_ID_REQUIRED',
    })
    return null
  }

  let allowed: boolean
  try {
    allowed = await checkOrganizationPermission(userId, 'manage', organizationId)
  } catch (err) {
    console.error('[billing-proxy] checkout org permission check failed:', err)
    res
      .status(500)
      .json({ error: 'Authorization check failed', code: 'AUTHZ_CHECK_ERROR' })
    return null
  }

  if (!allowed) {
    res.status(403).json({
      error: 'Insufficient organization permissions for billing',
      code: 'ORG_PERMISSION_DENIED',
      required: { action: 'manage', organizationId },
    })
    return null
  }

  return { entityType: 'organization', entityId: organizationId }
}

// Cluster-internal base URL of the billing-service. Overridable via env so the
// same code works locally (port-forward / compose) and in-cluster.
const BILLING_SERVICE_URL = (
  process.env.BILLING_SERVICE_URL || 'http://fuzefront-billing-service:3006'
).replace(/\/+$/, '')

// The billing-service mounts its API under /api/v1/billing (see openapi.yaml
// servers[].url). /health is the only route at the bare root, and we do not
// proxy it.
const BILLING_API_BASE = '/api/v1/billing'

const BILLING_INTERNAL_TOKEN = process.env.BILLING_INTERNAL_TOKEN || ''

// Upstream request timeout (ms). Stripe-backed calls can be slow; keep generous.
const UPSTREAM_TIMEOUT_MS = parseInt(
  process.env.BILLING_PROXY_TIMEOUT_MS || '15000',
  10
)

/**
 * Forward a request to the billing-service and pipe the upstream response back
 * to the caller. `rawBody` (a Buffer) is used for the webhook so the bytes
 * Stripe signed are preserved exactly; for JSON routes we forward req.body.
 */
// Query params we are willing to forward upstream. req.query was previously
// passed VERBATIM, which let a caller smuggle arbitrary params to the service.
// Keep this an explicit allow-list; entity/identity NEVER travels via query —
// it is server-derived and forwarded in the body / trusted headers instead.
const FORWARDED_QUERY_ALLOWLIST = new Set(['page', 'limit', 'cursor'])

function buildForwardedParams(
  query: Record<string, unknown> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!query) return out
  for (const key of FORWARDED_QUERY_ALLOWLIST) {
    const v = (query as Record<string, unknown>)[key]
    if (typeof v === 'string') out[key] = v
  }
  return out
}

async function forward(
  req: Request,
  res: Response,
  options: {
    /** Path under BILLING_API_BASE, e.g. '/subscriptions'. */
    path: string
    /** When true, inject BILLING_INTERNAL_TOKEN as the upstream bearer. */
    internalAuth: boolean
    /** Raw bytes to forward verbatim (webhook). */
    rawBody?: Buffer
    /** Extra headers to forward verbatim (e.g. Stripe-Signature). */
    passHeaders?: string[]
    /**
     * Server-derived, authorized entity. Always forwarded as trusted
     * X-Billing-* headers so the service can re-verify. When
     * `injectEntityToBody` is true it ALSO overrides the body's
     * entityType/entityId (for routes whose upstream schema carries the entity
     * selector — create / setup-intent). The :subscriptionId routes use
     * an upstream schema with `additionalProperties: false` and NO entity
     * selector, so for those the entity travels via headers only.
     */
    authorizedEntity?: AuthorizedEntity
    /** Inject the authorized entity into the forwarded JSON body. */
    injectEntityToBody?: boolean
    /**
     * Re-add the authorized ORGANIZATION id as `organizationId` in the body.
     * The /checkout upstream schema names the org `organizationId` (not the
     * generic entityType/entityId selector), so this server-derives that field
     * the same way — the client value was already stripped above.
     */
    injectOrgIdToBody?: boolean
    /** Authenticated actor (req.user.id), forwarded as a trusted header. */
    actorUserId?: string
  }
): Promise<void> {
  const url = `${BILLING_SERVICE_URL}${BILLING_API_BASE}${options.path}`

  const headers: Record<string, string> = {}

  if (options.internalAuth) {
    if (!BILLING_INTERNAL_TOKEN) {
      // Misconfiguration — fail closed rather than calling the service
      // unauthenticated (it would 401 anyway, but be explicit).
      res
        .status(500)
        .json({ error: 'Billing proxy misconfigured: missing internal token' })
      return
    }
    headers['Authorization'] = `Bearer ${BILLING_INTERNAL_TOKEN}`
  }

  // Build the forwarded body. For JSON routes we start from req.body, then
  // STRIP any client-supplied entity selectors and OVERRIDE them with the
  // server-authorized entity so the client can never target another entity.
  let data: unknown
  if (options.rawBody !== undefined) {
    data = options.rawBody
  } else if (req.body !== undefined && req.method !== 'GET' && req.method !== 'DELETE') {
    const src = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<
      string,
      unknown
    >
    const sanitized: Record<string, unknown> = { ...src }
    // Never trust client-supplied entity selectors — strip them unconditionally.
    delete sanitized.entityType
    delete sanitized.entityId
    delete sanitized.organizationId
    // Re-add the SERVER-DERIVED entity only for routes whose upstream schema
    // accepts it (create / setup-intent). For :subscriptionId routes the
    // upstream schema forbids extra props, so the entity goes via headers only.
    if (options.authorizedEntity && options.injectEntityToBody) {
      sanitized.entityType = options.authorizedEntity.entityType
      sanitized.entityId = options.authorizedEntity.entityId
    }
    // /checkout names the org `organizationId` in its upstream schema — re-add
    // the SERVER-DERIVED authorized org id under that field.
    if (
      options.authorizedEntity &&
      options.injectOrgIdToBody &&
      options.authorizedEntity.entityType === 'organization'
    ) {
      sanitized.organizationId = options.authorizedEntity.entityId
    }
    data = sanitized
  } else {
    data = undefined
  }

  if (options.rawBody !== undefined) {
    headers['Content-Type'] =
      (req.headers['content-type'] as string) || 'application/json'
  } else if (data !== undefined && req.method !== 'GET' && req.method !== 'DELETE') {
    headers['Content-Type'] = 'application/json'
  }

  // Trusted actor/entity context for the service-side re-verification. These
  // are set ONLY by the proxy (after authorization); the service must treat
  // them as authoritative and re-check the subscription↔entity binding.
  if (options.actorUserId) {
    headers['X-Billing-Actor-User-Id'] = options.actorUserId
    // Service-tier defence-in-depth contract: the billing-service re-verifies
    // ownership against these EXACT header names (X-FF-Actor-Id / X-FF-Org-Id).
    headers['X-FF-Actor-Id'] = options.actorUserId
  }
  if (options.authorizedEntity) {
    headers['X-Billing-Entity-Type'] = options.authorizedEntity.entityType
    headers['X-Billing-Entity-Id'] = options.authorizedEntity.entityId
    // The authorized organization id, for org-scoped billing only; user-scope
    // has no org context so X-FF-Org-Id is omitted there.
    if (options.authorizedEntity.entityType === 'organization') {
      headers['X-FF-Org-Id'] = options.authorizedEntity.entityId
    }
  }

  for (const h of options.passHeaders || []) {
    const v = req.headers[h.toLowerCase()]
    if (typeof v === 'string') headers[h] = v
  }

  const config: AxiosRequestConfig = {
    method: req.method as Method,
    url,
    headers,
    params: buildForwardedParams(req.query as Record<string, unknown>),
    timeout: UPSTREAM_TIMEOUT_MS,
    // Never throw on non-2xx — we relay the upstream status/body verbatim.
    validateStatus: () => true,
    // Webhook body must go up as raw bytes, not re-serialized.
    transformRequest:
      options.rawBody !== undefined ? [(d) => d] : undefined,
    responseType: 'arraybuffer',
  }
  if (data !== undefined) config.data = data

  try {
    const upstream = await axios.request(config)

    // Relay content-type so JSON/text responses come back correctly typed.
    const ct = upstream.headers['content-type']
    if (ct) res.setHeader('Content-Type', ct as string)
    res.status(upstream.status).send(Buffer.from(upstream.data))
  } catch (err) {
    const ax = err as AxiosError
    // Connection refused / DNS / timeout — the service is unreachable.
    // Sanitize the request-derived parts (strip CR/LF + other control chars)
    // before logging so externally-controlled values cannot forge log records
    // — clears CodeQL js/log-injection + js/tainted-format-string.
    const stripControl = (v: string) => String(v).replace(/[\u0000-\u001f\u007f]/g, '')
    console.error(
      '[billing-proxy] upstream error for %s %s:',
      stripControl(req.method),
      stripControl(options.path),
      ax.code || ax.message
    )
    res
      .status(502)
      .json({ error: 'Billing service unavailable', code: ax.code || 'EUPSTREAM' })
  }
}

// ---------------------------------------------------------------------------
// Public-ish catalogue: GET /plans (security: [] in the contract).
// Kept unauthenticated at the proxy so the pricing page can render pre-login.
// ---------------------------------------------------------------------------
router.get('/plans', (req, res) =>
  forward(req, res, { path: '/plans', internalAuth: true })
)

// ---------------------------------------------------------------------------
// User-facing subscription lifecycle — require a platform JWT *and* object-
// level authorization against the target entity before forwarding.
//
// Mutations require 'manage' on the target org; reads require 'read'. For the
// :subscriptionId routes the caller must declare the owning entity
// (entityType + entityId / organizationId) so the proxy can authorize them on
// it; the proxy forwards the trusted (authorized) entity downstream as
// X-Billing-* headers and the billing-service re-verifies the subscription
// actually belongs to that entity (service-tier re-check).
// ---------------------------------------------------------------------------
router.post(
  '/subscriptions',
  authenticateToken,
  async (req: BillingRequest, res) => {
    const entity = await authorizeBillingEntity(req, res, 'manage')
    if (!entity) return
    return forward(req, res, {
      path: '/subscriptions',
      internalAuth: true,
      authorizedEntity: entity,
      injectEntityToBody: true,
      actorUserId: req.user!.id,
    })
  }
)

// GET /subscriptions?organizationId=<uuid> — the current subscription for the
// authorized entity (the shell Billing page reads this). Object-level authz is
// the SAME gate as the other org-scoped reads: authenticate, then require
// 'read' on the target entity (org-scope -> Permit.io check; user-scope ->
// self). The authorized entity is server-derived and forwarded ONLY via the
// trusted X-Billing-*/X-FF-* headers (GET has no body); the billing-service
// resolves entity -> customer -> current subscription and returns
// { subscription: <view> | null }. Absence is 200 {subscription:null}, never a
// 404 — the UI treats null as "no current subscription".
//
// MUST be registered BEFORE GET /subscriptions/:subscriptionId so the
// param route does not shadow this collection route.
router.get(
  '/subscriptions',
  authenticateToken,
  async (req: BillingRequest, res) => {
    const entity = await authorizeBillingEntity(req, res, 'read')
    if (!entity) return
    return forward(req, res, {
      path: '/subscriptions',
      internalAuth: true,
      authorizedEntity: entity,
      actorUserId: req.user!.id,
    })
  }
)

router.get(
  '/subscriptions/:subscriptionId',
  authenticateToken,
  async (req: BillingRequest, res) => {
    const entity = await authorizeBillingEntity(req, res, 'read')
    if (!entity) return
    return forward(req, res, {
      path: `/subscriptions/${encodeURIComponent(req.params.subscriptionId)}`,
      internalAuth: true,
      authorizedEntity: entity,
      actorUserId: req.user!.id,
    })
  }
)

router.patch(
  '/subscriptions/:subscriptionId',
  authenticateToken,
  async (req: BillingRequest, res) => {
    const entity = await authorizeBillingEntity(req, res, 'manage')
    if (!entity) return
    return forward(req, res, {
      path: `/subscriptions/${encodeURIComponent(req.params.subscriptionId)}`,
      internalAuth: true,
      authorizedEntity: entity,
      actorUserId: req.user!.id,
    })
  }
)

router.delete(
  '/subscriptions/:subscriptionId',
  authenticateToken,
  async (req: BillingRequest, res) => {
    const entity = await authorizeBillingEntity(req, res, 'manage')
    if (!entity) return
    return forward(req, res, {
      path: `/subscriptions/${encodeURIComponent(req.params.subscriptionId)}`,
      internalAuth: true,
      authorizedEntity: entity,
      actorUserId: req.user!.id,
    })
  }
)

// SetupIntent — collect a payment method without a charge.
router.post(
  '/setup-intent',
  authenticateToken,
  async (req: BillingRequest, res) => {
    const entity = await authorizeBillingEntity(req, res, 'manage')
    if (!entity) return
    return forward(req, res, {
      path: '/setup-intent',
      internalAuth: true,
      authorizedEntity: entity,
      injectEntityToBody: true,
      actorUserId: req.user!.id,
    })
  }
)

// Checkout — start a Stripe Checkout Session for an organization's plan.
//
// Always organization-scoped: the caller must hold 'manage' on the target org.
// The proxy server-derives the authorized organizationId into the forwarded
// body and ALSO sends it as the trusted X-FF-Org-Id / X-FF-Actor-Id headers so
// the billing-service re-verifies ownership (service-tier defence-in-depth).
// The browser receives the upstream { url, sessionId } verbatim.
router.post(
  '/checkout',
  authenticateToken,
  async (req: BillingRequest, res) => {
    const entity = await authorizeCheckout(req, res)
    if (!entity) return
    return forward(req, res, {
      path: '/checkout',
      internalAuth: true,
      authorizedEntity: entity,
      injectOrgIdToBody: true,
      actorUserId: req.user!.id,
    })
  }
)

// GET /invoices?organizationId=<uuid> — the invoice history for the authorized
// entity (the shell Billing page lists these). Reading billing history is a
// READ operation, so the object-level gate is 'read' (org-scope -> Permit.io
// 'read' check; user-scope -> self) — the same gate as GET /subscriptions.
//
// The authorized entity is SERVER-DERIVED and forwarded ONLY via the trusted
// X-Billing-*/X-FF-* headers (GET has no body and identity NEVER travels via
// query — organizationId stays server-derived, it is not in the query
// allow-list). The `limit`/`cursor` pagination params ARE in
// FORWARDED_QUERY_ALLOWLIST so forward() relays them upstream automatically.
// The billing-service returns { invoices: [...], nextCursor }, relayed verbatim.
router.get(
  '/invoices',
  authenticateToken,
  async (req: BillingRequest, res) => {
    const entity = await authorizeBillingEntity(req, res, 'read')
    if (!entity) return
    return forward(req, res, {
      path: '/invoices',
      internalAuth: true,
      authorizedEntity: entity,
      actorUserId: req.user!.id,
    })
  }
)

// POST /portal — open a Stripe Billing Portal session for the authorized
// entity. Opening the portal lets the user change payment method / cancel /
// view invoices, i.e. it can MUTATE billing state, so the object-level gate is
// 'manage' (org-scope -> Permit.io 'manage' check; user-scope -> self) — the
// same gate as the subscription mutations.
//
// The upstream /portal schema accepts ONLY { returnUrl }; the entity travels
// via the trusted X-Billing-*/X-FF-* headers, NOT in the body. So we do NOT set
// injectEntityToBody/injectOrgIdToBody — forward() still STRIPS any client
// -supplied entityType/entityId/organizationId from the body (so an attacker
// cannot retarget another org), leaving returnUrl intact. The billing-service
// re-verifies ownership against the trusted headers and returns { url }.
router.post(
  '/portal',
  authenticateToken,
  async (req: BillingRequest, res) => {
    const entity = await authorizeBillingEntity(req, res, 'manage')
    if (!entity) return
    return forward(req, res, {
      path: '/portal',
      internalAuth: true,
      authorizedEntity: entity,
      actorUserId: req.user!.id,
    })
  }
)

export default router

// ---------------------------------------------------------------------------
// Stripe webhook passthrough.
//
// This is exported SEPARATELY so it can be mounted in index.ts BEFORE the
// global express.json() body parser — Stripe signature verification (done in
// the billing-service) requires the exact raw bytes, which a prior JSON parse
// would destroy. The handler itself uses express.raw() to capture the body as a
// Buffer and forwards it verbatim with the Stripe-Signature header.
//
// Mount with:  app.use('/api/v1/billing/webhooks/stripe', billingWebhookRouter)
// ---------------------------------------------------------------------------
export const billingWebhookRouter = express.Router()

billingWebhookRouter.post(
  '/',
  express.raw({ type: '*/*', limit: '1mb' }),
  (req: Request, res: Response, _next: NextFunction) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('')
    return forward(req, res, {
      path: '/webhooks/stripe',
      internalAuth: false, // public — authenticity via Stripe signature
      rawBody,
      passHeaders: ['Stripe-Signature'],
    })
  }
)

// Exported for tests / introspection.
export const __billingProxyConfig = {
  BILLING_SERVICE_URL,
  BILLING_API_BASE,
  hasInternalToken: () => Boolean(BILLING_INTERNAL_TOKEN),
}
