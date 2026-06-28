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

const router = express.Router()

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

  // Forward the original query string (e.g. future pagination) untouched.
  const data = options.rawBody !== undefined ? options.rawBody : req.body

  if (options.rawBody !== undefined) {
    headers['Content-Type'] =
      (req.headers['content-type'] as string) || 'application/json'
  } else if (data !== undefined && req.method !== 'GET' && req.method !== 'DELETE') {
    headers['Content-Type'] = 'application/json'
  }

  for (const h of options.passHeaders || []) {
    const v = req.headers[h.toLowerCase()]
    if (typeof v === 'string') headers[h] = v
  }

  const config: AxiosRequestConfig = {
    method: req.method as Method,
    url,
    headers,
    params: req.query,
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
// User-facing subscription lifecycle — require a platform JWT.
// ---------------------------------------------------------------------------
router.post('/subscriptions', authenticateToken, (req, res) =>
  forward(req, res, { path: '/subscriptions', internalAuth: true })
)

router.get(
  '/subscriptions/:stripeSubscriptionId',
  authenticateToken,
  (req, res) =>
    forward(req, res, {
      path: `/subscriptions/${encodeURIComponent(req.params.stripeSubscriptionId)}`,
      internalAuth: true,
    })
)

router.patch(
  '/subscriptions/:stripeSubscriptionId',
  authenticateToken,
  (req, res) =>
    forward(req, res, {
      path: `/subscriptions/${encodeURIComponent(req.params.stripeSubscriptionId)}`,
      internalAuth: true,
    })
)

router.delete(
  '/subscriptions/:stripeSubscriptionId',
  authenticateToken,
  (req, res) =>
    forward(req, res, {
      path: `/subscriptions/${encodeURIComponent(req.params.stripeSubscriptionId)}`,
      internalAuth: true,
    })
)

// SetupIntent — collect a payment method without a charge.
router.post('/setup-intent', authenticateToken, (req, res) =>
  forward(req, res, { path: '/setup-intent', internalAuth: true })
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
