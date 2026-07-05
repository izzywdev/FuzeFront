// Host-backend app-registry proxy.
//
// The applications-service (`fuzefront-applications:3003`) owns the FROZEN
// `/api/v1/app-registry` contract (services/app-registry-service/openapi.yaml) —
// the manifest-shaped surface the frontend's `@fuzefront/app-registry-client`
// talks to same-origin.
//
// Why this proxy exists: in prod the ingress routes `/api/apps` + `/socket.io`
// straight to the applications-service, but `/api/v1/app-registry/*` matches
// only the `/api` catch-all and falls through to THIS host backend (the frontend
// nginx does the same — its `/api/` block proxies to fuzefront-backend). Without
// this router the registry client 404s same-origin, the activated-apps list comes
// back empty, and NO federated app (including the built-in Clock) can mount —
// the shell sits on the "Loading application…" spinner forever.
//
// Trust model: unlike the billing proxy, the applications-service authenticates
// the SAME platform JWT the browser already holds and does its own per-object
// authorization (Permit + BOLA filtering in app-registry/service.ts). So this
// proxy injects NO internal token — it forwards the caller's Authorization
// header verbatim and relays the upstream status/body unchanged. The heartbeat
// route authenticates a per-app token, also carried in Authorization, so the
// same verbatim forwarding covers it.
import express, { Request, Response } from 'express'
import axios, { AxiosError, AxiosRequestConfig, Method } from 'axios'

const router = express.Router()

// Cluster-internal base URL of the applications-service. Overridable via env so
// the same code works locally (compose / port-forward) and in-cluster.
const APPLICATIONS_SERVICE_URL = (
  process.env.APPLICATIONS_SERVICE_URL || 'http://fuzefront-applications:3003'
).replace(/\/+$/, '')

// The applications-service mounts this contract under /api/v1/app-registry.
const APP_REGISTRY_API_BASE = '/api/v1/app-registry'

// Upstream request timeout (ms). Registry calls are quick; keep a sane ceiling.
const UPSTREAM_TIMEOUT_MS = parseInt(
  process.env.APP_REGISTRY_PROXY_TIMEOUT_MS || '15000',
  10
)

/**
 * Forward the request to the applications-service and relay its response back to
 * the caller unchanged. Within this router `req.url` is the subpath + query
 * string relative to the mount point (e.g. `/apps?status=activated`), so the
 * upstream URL reconstructs the full contract path.
 */
async function forward(req: Request, res: Response): Promise<void> {
  const url = `${APPLICATIONS_SERVICE_URL}${APP_REGISTRY_API_BASE}${req.url}`

  const headers: Record<string, string> = {}
  // Forward the caller's bearer token verbatim — the service authenticates it.
  const auth = req.headers['authorization']
  if (typeof auth === 'string') headers['Authorization'] = auth

  // Re-serialize the parsed JSON body for write methods (express.json() already
  // consumed it upstream of this router). GET/DELETE carry no body.
  let data: unknown
  if (
    req.method !== 'GET' &&
    req.method !== 'DELETE' &&
    req.body !== undefined &&
    !(typeof req.body === 'object' && Object.keys(req.body).length === 0)
  ) {
    data = req.body
    headers['Content-Type'] = 'application/json'
  }

  const config: AxiosRequestConfig = {
    method: req.method as Method,
    url,
    headers,
    timeout: UPSTREAM_TIMEOUT_MS,
    // Never throw on non-2xx — relay the upstream status/body verbatim.
    validateStatus: () => true,
    responseType: 'arraybuffer',
  }
  if (data !== undefined) config.data = data

  try {
    const upstream = await axios.request(config)

    const ct = upstream.headers['content-type']
    if (ct) res.setHeader('Content-Type', ct as string)
    // registerApp returns the per-app heartbeat token out-of-band in a header —
    // relay it so the registration UI can capture it.
    const hb = upstream.headers['x-app-heartbeat-token']
    if (hb) res.setHeader('X-App-Heartbeat-Token', hb as string)

    res.status(upstream.status).send(Buffer.from(upstream.data))
  } catch (err) {
    const ax = err as AxiosError
    // Connection refused / DNS / timeout — the service is unreachable.
    console.error(
      `[app-registry-proxy] upstream error for ${req.method} ${req.url}:`,
      ax.code || ax.message
    )
    res.status(502).json({
      error: 'app_registry_unavailable',
      code: ax.code || 'EUPSTREAM',
    })
  }
}

// Catch-all: every method + subpath under the mount is forwarded.
router.use((req, res) => {
  void forward(req, res)
})

export default router

// Exported for tests / introspection.
export const __appRegistryProxyConfig = {
  APPLICATIONS_SERVICE_URL,
  APP_REGISTRY_API_BASE,
}
