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

// AuthenticatedRequest-like shape. `authenticateToken` populates req.user; we
// also stash the server-derived, authorized entity for the forwarder to use.
interface BillingRequest extends Request {
  user?: { id: string; email?: string; roles?: string[] }
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
     * Server-derived, authorized entity. When set, its (entityType, entityId)
     * OVERRIDES whatever the client sent in the body, and the same identity is
     * forwarded as trusted X-Billing-* headers so the service can re-verify.
     */
    authorizedEntity?: AuthorizedEntity
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
    // Never trust client-supplied entity selectors.
    delete sanitized.entityType
    delete sanitized.entityId
    delete sanitized.organizationId
    if (options.authorizedEntity) {
      sanitized.entityType = options.authorizedEntity.entityType
      sanitized.entityId = options.authorizedEntity.entityId
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
  }
  if (options.authorizedEntity) {
    headers['X-Billing-Entity-Type'] = options.authorizedEntity.entityType
    headers['X-Billing-Entity-Id'] = options.authorizedEntity.entityId
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
    console.error(
      `[billing-proxy] upstream error for ${req.method} ${options.path}:`,
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
// :stripeSubscriptionId routes the caller must declare the owning entity
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
      actorUserId: req.user!.id,
    })
  }
)

router.get(
  '/subscriptions/:stripeSubscriptionId',
  authenticateToken,
  async (req: BillingRequest, res) => {
    const entity = await authorizeBillingEntity(req, res, 'read')
    if (!entity) return
    return forward(req, res, {
      path: `/subscriptions/${encodeURIComponent(req.params.stripeSubscriptionId)}`,
      internalAuth: true,
      authorizedEntity: entity,
      actorUserId: req.user!.id,
    })
  }
)

router.patch(
  '/subscriptions/:stripeSubscriptionId',
  authenticateToken,
  async (req: BillingRequest, res) => {
    const entity = await authorizeBillingEntity(req, res, 'manage')
    if (!entity) return
    return forward(req, res, {
      path: `/subscriptions/${encodeURIComponent(req.params.stripeSubscriptionId)}`,
      internalAuth: true,
      authorizedEntity: entity,
      actorUserId: req.user!.id,
    })
  }
)

router.delete(
  '/subscriptions/:stripeSubscriptionId',
  authenticateToken,
  async (req: BillingRequest, res) => {
    const entity = await authorizeBillingEntity(req, res, 'manage')
    if (!entity) return
    return forward(req, res, {
      path: `/subscriptions/${encodeURIComponent(req.params.stripeSubscriptionId)}`,
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
