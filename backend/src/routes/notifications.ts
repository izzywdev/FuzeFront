// Host-backend notification-service proxy.
//
// The browser must reach the notification API SAME-ORIGIN — an absolute service
// host would break under local TLS and behind the prod ingress (mixed content),
// and it is this repo's standing API rule. So the shell calls
// `/api/v1/notifications/*` and this router forwards to the in-cluster
// notification-service.
//
// TRUST MODEL: notification-service authenticates the SAME platform JWT the
// browser already holds, and derives the recipient from that token — there is no
// user id anywhere in its user-facing API to tamper with. So this proxy injects
// NO internal token; it forwards the caller's Authorization header verbatim and
// relays the upstream status/body unchanged.
//
// The service's `/internal/*` surface is deliberately NOT reachable through
// here: it is gated on a shared service token that the browser never holds, and
// forwarding it would put a publish-to-any-inbox endpoint one header away from
// the public internet.
//
// SSE: `GET /stream` is a long-lived `text/event-stream`. It is forwarded with
// response streaming and no timeout, because the buffered path used for the
// JSON routes would hold every event until the response ended — i.e. forever.
import express, { Request, Response } from 'express'
import axios, { AxiosError, AxiosRequestConfig, Method } from 'axios'

const router = express.Router()

const NOTIFICATION_SERVICE_URL = (
  process.env.NOTIFICATION_SERVICE_URL || 'http://fuzefront-notification-service:3008'
).replace(/\/+$/, '')

// The service mounts its contract under /notifications.
const NOTIFICATION_API_BASE = '/notifications'

const UPSTREAM_TIMEOUT_MS = parseInt(
  process.env.NOTIFICATION_PROXY_TIMEOUT_MS || '15000',
  10
)

/** Paths the browser must never reach, whatever it asks for. */
function isForbiddenPath(url: string): boolean {
  // Strip the query string, then match the leading segment. Guarding on the
  // PATH (not the raw url) is what stops `/internal/publish?x=1` slipping past.
  const path = url.split('?')[0]
  return path === '/internal' || path.startsWith('/internal/')
}

/** Long-lived SSE, which needs stream-through forwarding, not buffering. */
function isStreamPath(url: string): boolean {
  return url.split('?')[0] === '/stream'
}

async function forwardStream(req: Request, res: Response): Promise<void> {
  const url = `${NOTIFICATION_SERVICE_URL}${NOTIFICATION_API_BASE}${req.url}`
  const headers: Record<string, string> = { Accept: 'text/event-stream' }
  const auth = req.headers['authorization']
  if (typeof auth === 'string') headers['Authorization'] = auth

  try {
    const upstream = await axios.request({
      method: 'GET',
      url,
      headers,
      responseType: 'stream',
      // No timeout: the point of this connection is to stay open.
      timeout: 0,
      validateStatus: () => true,
    })

    res.status(upstream.status)
    for (const header of ['content-type', 'cache-control', 'connection']) {
      const value = upstream.headers[header]
      if (value) res.setHeader(header, value as string)
    }
    // Tell any intermediate nginx not to buffer, or events arrive in bursts —
    // indistinguishable from a dead stream.
    res.setHeader('X-Accel-Buffering', 'no')
    // Flush the headers immediately so EventSource sees an open stream rather
    // than waiting for the first event.
    res.flushHeaders?.()

    upstream.data.pipe(res)

    // Tear the upstream connection down when the browser goes away, or the
    // service keeps heartbeating into a socket nobody is reading.
    req.on('close', () => {
      upstream.data.destroy?.()
    })
  } catch (err) {
    const ax = err as AxiosError
    console.error(
      `[notification-proxy] stream upstream error:`,
      ax.code || ax.message
    )
    if (!res.headersSent) {
      res
        .status(502)
        .json({ error: 'notification_service_unavailable', code: ax.code || 'EUPSTREAM' })
    } else {
      res.end()
    }
  }
}

async function forward(req: Request, res: Response): Promise<void> {
  if (isForbiddenPath(req.url)) {
    // 404, not 403: the browser has no business knowing this surface exists.
    res.status(404).json({ error: 'Not found' })
    return
  }

  if (isStreamPath(req.url) && req.method === 'GET') {
    await forwardStream(req, res)
    return
  }

  const url = `${NOTIFICATION_SERVICE_URL}${NOTIFICATION_API_BASE}${req.url}`

  const headers: Record<string, string> = {}
  const auth = req.headers['authorization']
  if (typeof auth === 'string') headers['Authorization'] = auth

  // express.json() already consumed the body upstream of this router, so
  // re-serialize it for write methods.
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
    res.status(upstream.status).send(Buffer.from(upstream.data))
  } catch (err) {
    const ax = err as AxiosError
    console.error(
      `[notification-proxy] upstream error for ${req.method} ${req.url}:`,
      ax.code || ax.message
    )
    // 502 with a stable code: the shell treats any failure as "no badge, quiet
    // degrade", so this must be a clean error rather than a hang.
    res.status(502).json({
      error: 'notification_service_unavailable',
      code: ax.code || 'EUPSTREAM',
    })
  }
}

router.use((req, res) => {
  void forward(req, res)
})

export default router

// Exported for tests / introspection.
export const __notificationProxyConfig = {
  NOTIFICATION_SERVICE_URL,
  NOTIFICATION_API_BASE,
  isForbiddenPath,
  isStreamPath,
}
