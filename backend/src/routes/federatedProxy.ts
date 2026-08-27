// Same-origin reverse proxy for federated remotes: `/apps/<slug>/*`.
//
// WHY THIS EXISTS. `frontend/src/utils/loadFederatedApp.ts:71` resolves every
// remote against the portal's own origin —
//
//     const resolved = new URL(remoteEntry, origin)
//
// — so a registered `integration.remoteEntry` of `/apps/finance/remoteEntry.js`
// is fetched from `https://app.fuzefront.com/apps/finance/remoteEntry.js`.
// Nothing served that path. It fell through the ingress `/` rule to the
// frontend, whose SPA fallback answers ANY unmatched path with 200 + index.html
// — which is exactly why the census scores `fuzequality` as "remoteEntry
// returned 200 but is HTML". A green healthcheck in front of a blank panel.
//
// WHY NOT AN INGRESS PER REMOTE, which is what `.Values.federatedApps` builds.
// A Kubernetes Ingress may only name a Service in its OWN namespace, and every
// family product deploys to its own (`fuzemarket`, `fuzequality`, …). The
// documented escape hatch — an ExternalName Service — is refused by Traefik
// unless `allowExternalNameServices` is set, and it is false by default. So
// that mechanism cannot route a single out-of-namespace remote, which is why it
// has sat as `[]` in every values file since it was written and why only
// `clock` (same namespace, hand-written block) was ever reachable.
//
// A reverse proxy has no such restriction: cross-namespace Service DNS
// (`http://<svc>.<ns>.svc.cluster.local`) is an ordinary HTTP call. It also puts
// every remote on the portal's own origin for free, which is what the
// same-origin/no-mixed-content rule wants anyway.
//
// TRUST MODEL — read before adding a "convenient" lookup here.
// The upstream map is operator configuration ONLY. It is deliberately NOT
// derived from the app registry, even though the registry knows every remote's
// URL: any authenticated product can self-register and edit its own manifest
// (`PUT /apps/{slug}`), so deriving the proxy target from registry data would
// let a registered app point this proxy at an arbitrary in-cluster address and
// read the response — a textbook SSRF, unauthenticated at that, since a
// `<script src>` carries no credentials. An explicit allowlist keeps the set of
// reachable upstreams equal to the set an operator wrote down.
//
// Consequences of that, all intentional:
//   - GET/HEAD only. These are static asset servers; nothing here should accept
//     a write, and refusing them shrinks what the proxy can be aimed at.
//   - Inbound `Authorization` and `Cookie` are NOT forwarded. The portal session
//     must never reach a remote's static file server.
//   - Outbound `Set-Cookie` is dropped. A remote cannot set a cookie on the
//     portal origin through this proxy.
import express, { Request, Response } from 'express'
import axios, { AxiosError, AxiosRequestConfig } from 'axios'

const router = express.Router()

// Upstream request timeout (ms). Asset fetches are fast in-cluster; a remote
// that is down should fail quickly rather than hold a portal connection open.
const UPSTREAM_TIMEOUT_MS = parseInt(
  process.env.FEDERATED_PROXY_TIMEOUT_MS || '10000',
  10
)

// Ceiling on a single proxied asset. Module-Federation chunks are usually well
// under a megabyte; this is a runaway guard, not a tuning knob.
const MAX_ASSET_BYTES = parseInt(
  process.env.FEDERATED_PROXY_MAX_BYTES || String(32 * 1024 * 1024),
  10
)

// Slugs are lowercase alphanumeric + hyphen. This is a shape check on the map's
// KEYS, not a naming rule — CLAUDE.md is explicit that a slug's prefix is free
// and immutable, and nothing here derives, edits or validates a product's slug.
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

export interface UpstreamMap {
  [slug: string]: string
}

/**
 * Parse `FEDERATED_PROXY_UPSTREAMS` — a JSON object of `slug -> base URL`, e.g.
 *
 *     {"finance":"http://fuzefinance.fuzefinance.svc.cluster.local:80"}
 *
 * Malformed entries are dropped rather than thrown, because this router shares a
 * process with authentication, the app registry and billing: one bad URL in a
 * values file must not take the whole portal down. Every rejection is logged at
 * error level and names the visible consequence, so a dropped entry cannot pass
 * for a working one.
 */
export function parseUpstreams(raw: string | undefined): UpstreamMap {
  if (!raw || !raw.trim()) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    console.error(
      '[federated-proxy] FEDERATED_PROXY_UPSTREAMS is not valid JSON — NO remote ' +
        'will be proxied and every /apps/<slug>/* request will 404. ' +
        JSON.stringify({ error: (err as Error).message })
    )
    return {}
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.error(
      '[federated-proxy] FEDERATED_PROXY_UPSTREAMS must be a JSON object of ' +
        'slug -> base URL — NO remote will be proxied.'
    )
    return {}
  }

  const out: UpstreamMap = {}
  for (const [slug, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!SLUG_RE.test(slug)) {
      console.error(
        `[federated-proxy] ignoring upstream key ${JSON.stringify(slug)}: not a ` +
          'valid slug shape — that remote will 404.'
      )
      continue
    }
    if (typeof value !== 'string' || !value.trim()) {
      console.error(
        `[federated-proxy] ignoring upstream for "${slug}": value is not a ` +
          'non-empty string — that remote will 404.'
      )
      continue
    }
    let url: URL
    try {
      url = new URL(value)
    } catch {
      console.error(
        `[federated-proxy] ignoring upstream for "${slug}": ${JSON.stringify(value)} ` +
          'is not an absolute URL — that remote will 404.'
      )
      continue
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      console.error(
        `[federated-proxy] ignoring upstream for "${slug}": protocol ` +
          `${url.protocol} is not http/https — that remote will 404.`
      )
      continue
    }
    // Keep the operator's string verbatim apart from a trailing slash, so what
    // is logged and what is in the values file read the same. Deliberately NOT
    // `url.origin + url.pathname`: that drops a default port, turning a
    // configured `http://svc:80` into `http://svc` in every log line and making
    // config and diagnostics disagree for no benefit.
    void url
    out[slug] = value.trim().replace(/\/+$/, '')
  }
  return out
}

const UPSTREAMS: UpstreamMap = parseUpstreams(
  process.env.FEDERATED_PROXY_UPSTREAMS
)

if (Object.keys(UPSTREAMS).length === 0) {
  console.warn(
    '[federated-proxy] no upstreams configured (FEDERATED_PROXY_UPSTREAMS is ' +
      'empty) — /apps/<slug>/* will 404 for every remote. This is the default; ' +
      'populate federatedProxy.upstreams in the Helm values to enable remotes.'
  )
} else {
  console.log(
    `[federated-proxy] proxying ${Object.keys(UPSTREAMS).length} remote(s): ` +
      Object.keys(UPSTREAMS).sort().join(', ')
  )
}

/**
 * Split the router-relative URL into slug, subpath and query.
 *
 * Mounted at `/apps`, so `req.url` looks like `/finance/remoteEntry.js?v=2`.
 * Returns null when the shape is unusable — including any `..` segment, which is
 * rejected outright rather than normalised, so no request can climb above the
 * upstream's base path.
 */
export function splitRequest(
  rawUrl: string
): { slug: string; subpath: string; query: string } | null {
  const qIndex = rawUrl.indexOf('?')
  const path = qIndex === -1 ? rawUrl : rawUrl.slice(0, qIndex)
  const query = qIndex === -1 ? '' : rawUrl.slice(qIndex)

  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0) return null

  const [slug, ...rest] = segments
  if (!SLUG_RE.test(slug)) return null
  // Reject traversal and encoded traversal before it can reach the upstream.
  if (rest.some(s => s === '..' || s === '.' || /%2e%2e/i.test(s))) return null

  return { slug, subpath: rest.join('/'), query }
}

async function proxy(req: Request, res: Response): Promise<void> {
  // Static assets only. Anything else would widen what an allowlisted upstream
  // can be asked to do; see the trust model at the top of this file.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    res.status(405).json({
      error: 'method_not_allowed',
      detail: 'The federated asset proxy serves GET and HEAD only.',
    })
    return
  }

  const parts = splitRequest(req.url)
  if (!parts) {
    res.status(400).json({ error: 'bad_request', detail: 'Malformed asset path.' })
    return
  }

  const base = UPSTREAMS[parts.slug]
  if (!base) {
    // Deliberately the same answer whether the slug is unknown or merely
    // unconfigured: this endpoint is unauthenticated, and it should not report
    // which products exist.
    res.status(404).json({
      error: 'remote_not_configured',
      detail: `No federated upstream is configured for "${parts.slug}".`,
    })
    return
  }

  const url = `${base}${parts.subpath ? `/${parts.subpath}` : '/'}${parts.query}`

  const config: AxiosRequestConfig = {
    method: req.method as 'GET' | 'HEAD',
    url,
    // NOTE the omissions: no Authorization, no Cookie. The portal session must
    // not reach a remote's file server.
    headers: {
      // Pass conditional-request headers so the browser cache keeps working.
      ...(req.headers['if-none-match']
        ? { 'If-None-Match': req.headers['if-none-match'] as string }
        : {}),
      ...(req.headers['if-modified-since']
        ? { 'If-Modified-Since': req.headers['if-modified-since'] as string }
        : {}),
      ...(req.headers['accept']
        ? { Accept: req.headers['accept'] as string }
        : {}),
    },
    timeout: UPSTREAM_TIMEOUT_MS,
    // Relay the upstream's status verbatim — a remote's own 404 is a real
    // answer and must not be laundered into a 200.
    validateStatus: () => true,
    responseType: 'arraybuffer',
    maxContentLength: MAX_ASSET_BYTES,
    maxRedirects: 0,
  }

  try {
    const upstream = await axios.request(config)

    // Content-Type is the whole ballgame for Module Federation: the browser
    // refuses a module served as text/html, which is the failure the census
    // reports today. Relay it exactly as the upstream sent it.
    const passthrough = [
      'content-type',
      'cache-control',
      'etag',
      'last-modified',
   ]
    for (const h of passthrough) {
      const v = upstream.headers[h]
      if (v) res.setHeader(h, v as string)
    }
    // Content-Encoding and Content-Length are deliberately NOT relayed: axios
    // has already decompressed the body, so echoing `gzip` would hand the
    // browser plaintext labelled as compressed and break every chunk.
    // Set-Cookie is dropped — a remote cannot set cookies on the portal origin.

    res.status(upstream.status).send(Buffer.from(upstream.data))
  } catch (err) {
    const ax = err as AxiosError
    console.error(
      `[federated-proxy] upstream error for ${parts.slug} (${req.method} ${url}):`,
      ax.code || ax.message
    )
    res.status(502).json({
      error: 'remote_unavailable',
      slug: parts.slug,
      code: ax.code || 'EUPSTREAM',
    })
  }
}

router.use((req, res) => {
  void proxy(req, res)
})

export default router

// Exported for tests / introspection.
export const __federatedProxyConfig = {
  UPSTREAMS,
  UPSTREAM_TIMEOUT_MS,
  MAX_ASSET_BYTES,
}
