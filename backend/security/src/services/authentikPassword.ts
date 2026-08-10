/**
 * Server-side Authentik password authentication — no browser redirect.
 *
 * The login page shows native email/password fields; this service drives
 * Authentik's flow-executor JSON API with those credentials, then completes a
 * standard OIDC authorization-code + PKCE exchange using the authenticated
 * Authentik session. Authentik therefore remains the SOLE identity authority
 * (same as the redirect flow), and everything downstream — user sync into the
 * platform DB, session/JWT minting — reuses the existing OIDC machinery.
 *
 * Flow:
 *   1. GET  /api/v3/flows/executor/<slug>/?query=      → identification stage
 *   2. POST { component, uid_field: email [, password] }
 *   3. POST { component, password }                     (separate password stage)
 *   4. challenge "xak-flow-redirect"                    → Authentik session established
 *   5. GET the OIDC authorize URL with the session cookies (implicit consent)
 *      → 302 …/api/auth/oidc/callback?code=…&state=…
 *   6. getOidcService().handleCallback(code, state, codeVerifier) → synced User
 *
 * Only single-factor identification/password flows are supported. Users with
 * MFA or other stages configured must use the browser (Google/SSO) path — we
 * fail closed with a clear error rather than trying to drive arbitrary stages.
 */
import { generators } from 'openid-client'
import { Agent } from 'undici'
import { getOidcService } from './oidc'
import { currentTenant } from '../providers/authentik/tenants'
import { User } from '../types/shared'
import { logger } from '../lib/logger'

/**
 * Hard per-fetch timeout (ms) for EVERY server-side Authentik HTTP hop driven in
 * this module — the flow-executor requests, the OIDC authorize→code redirect
 * chain, and the Admin-API set_password calls. Without it a single stuck hop
 * (e.g. the authorize hairpin out to app.fuzefront.com via Cloudflare) hangs the
 * whole login request forever, so the client only fails after its own ~60s
 * timeout with no server log pointing at the culprit. A bounded AbortController
 * turns that into a fast, labelled AuthentikUnavailableError instead.
 * Overridable via AUTHENTIK_FLOW_TIMEOUT_MS without a rebuild.
 */
const AUTHENTIK_FLOW_TIMEOUT_MS =
  Number(process.env.AUTHENTIK_FLOW_TIMEOUT_MS) || 10000

/**
 * WHOLE-REQUEST budget (ms) for one server-brokered sign-in/sign-up.
 *
 * The per-hop cap above bounds each INDIVIDUAL fetch, but a login is a CHAIN:
 * 2-3 flow-executor stages (each following up to 10 redirects) followed by the
 * authorize→code chain (up to 10 more hops). Every hop used to get a fresh 10s
 * budget, so the server's worst case ran to minutes while the browser gives the
 * whole call only LOGIN_TIMEOUT_MS (15s — frontend/src/services/api.ts). The
 * client therefore always aborted first, and the user got a bare
 * "timeout of 15000ms exceeded" with no status and no message, while the
 * labelled server-side diagnostics ("hop timed out", naming the exact stage)
 * were still waiting to be produced and never reached anyone.
 *
 * Bounding the CHAIN — not just each link — is what makes the server answer
 * first. This MUST stay below the client's bound so a stalled sign-in surfaces
 * as a real, logged, labelled HTTP response instead of a blind client-side
 * abort: 40s here against the client's 45s. The margin is for the response
 * trip, so retune the pair together and never let this cross above it.
 *
 * Sized to the documented slow path (16-30s), not to what sign-in SHOULD cost
 * — a budget below the real worst case rejects logins that would have
 * succeeded. Tighten both once the underlying slow hop is fixed.
 * Overridable via AUTHENTIK_LOGIN_DEADLINE_MS.
 */
const AUTHENTIK_LOGIN_DEADLINE_MS =
  Number(process.env.AUTHENTIK_LOGIN_DEADLINE_MS) || 40000

/**
 * A hop slower than this is reported at WARN, with its label, even when the
 * login ultimately succeeds.
 *
 * Per-hop timings already existed — at `logger.debug`. LOG_LEVEL defaults to
 * `info` and is not set anywhere in the chart, so in production that detail has
 * always been switched OFF, and answering "which hop is slow?" required either
 * a config change or a redeploy. That is why this path has accumulated timeout
 * band-aids (#362, #371) instead of a diagnosis: the evidence was never in the
 * logs when the incident happened.
 *
 * A slow-hop threshold is the standard fix (a slow-query log): silent on the
 * fast path, fully detailed exactly when something is wrong — no LOG_LEVEL
 * change, no redeploy, no spam. Overridable via AUTHENTIK_SLOW_HOP_WARN_MS.
 */
const AUTHENTIK_SLOW_HOP_WARN_MS =
  Number(process.env.AUTHENTIK_SLOW_HOP_WARN_MS) || 1000

/**
 * A whole sign-in slower than this is reported at WARN even though it
 * SUCCEEDED. Set above the ~5.5s fast path, well below the client bound — the
 * gap between them is precisely the band that was silently eating sign-in.
 */
const AUTHENTIK_LOGIN_WARN_MS =
  Number(process.env.AUTHENTIK_LOGIN_WARN_MS) || 8000

/** Monotonic-ish elapsed helper for the per-step timing logs. */
function since(startMs: number): number {
  return Math.round(Date.now() - startMs)
}

/**
 * Record one hop's cost. Always available at debug; promoted to warn when the
 * hop is slow enough to be the thing worth looking at.
 *
 * Leading hypothesis for what this will show, stated so the logs can refute it:
 * these hops all target the same in-cluster origin, and this pod's own
 * `dnsConfig` (deploy/helm/.../security.yaml) documents CoreDNS "intermittently
 * stalls lookups in 5s/10s retry multiples", capped to ~2s by timeout:1 /
 * attempts:2 — with the note that this service "resolves authentik-server on
 * every auth flow". A DNS lookup happens per NEW CONNECTION, and the leaked
 * response bodies (see drainBody) forced a new connection per hop, so the stall
 * was multiplied by hop count: ~6 hops x ~2s is most of the observed 16-30s.
 * If that is right, draining bodies lets undici reuse one keep-alive socket per
 * origin and the stalls collapse to at most one. `elapsedMs` per labelled hop
 * is what confirms or kills that; if connect/DNS time still dominates, the next
 * step is an explicit keep-alive dispatcher pinned to the Authentik origin.
 */
function recordHop(
  label: string,
  elapsedMs: number,
  fields: Record<string, unknown> = {}
): void {
  const entry = { label, elapsedMs, ...fields }
  if (elapsedMs >= AUTHENTIK_SLOW_HOP_WARN_MS) {
    logger.warn(entry, 'authentikPassword: SLOW hop')
    return
  }
  logger.debug(entry, 'authentikPassword: hop')
}

/**
 * A wall-clock budget shared by every hop of ONE login/signup attempt.
 *
 * Each hop asks for `hopBudget()`, which is the smaller of the per-hop cap and
 * whatever is actually left — so the chain can never outlive the whole-request
 * deadline no matter how many redirects Authentik asks us to follow.
 */
class Deadline {
  private readonly expiresAt: number
  private readonly budgetMs: number

  constructor(budgetMs: number = AUTHENTIK_LOGIN_DEADLINE_MS) {
    this.budgetMs = budgetMs
    this.expiresAt = Date.now() + budgetMs
  }

  remainingMs(): number {
    return this.expiresAt - Date.now()
  }

  /** Per-hop allowance: never more than the cap, never more than what's left. */
  hopBudget(cap: number = AUTHENTIK_FLOW_TIMEOUT_MS): number {
    return Math.min(cap, this.remainingMs())
  }

  /**
   * Throw a labelled error if the whole-request budget is already spent, so the
   * chain stops at a named stage instead of starting a hop it cannot finish.
   */
  assertLive(label: string): void {
    if (this.remainingMs() > 0) return
    logger.error(
      { label, budgetMs: this.budgetMs },
      'authentikPassword: login deadline exceeded'
    )
    throw new AuthentikUnavailableError(
      `sign-in exceeded its ${this.budgetMs}ms budget before ${label}`
    )
  }
}

/**
 * Release the connection behind a response whose body we are going to discard.
 *
 * undici (Node's fetch) keeps the underlying socket checked out until the body
 * is consumed or cancelled. Every redirect hop below reads only `location` and
 * moves on, so without this the socket for each hop stayed pinned for the rest
 * of the request — and subsequent hops to the SAME origin queued behind the
 * leaked ones. That is exactly the shape of the intermittent multi-second
 * stalls this module keeps getting timeout band-aids for: not one slow hop, but
 * hops waiting on connections their own predecessors never gave back.
 */
function drainBody(res: Response): void {
  // `.cancel()` rejects if the body is already disturbed/locked; either way the
  // connection is no longer ours to hold, so the outcome is not interesting.
  void res.body?.cancel().catch(() => undefined)
}

/**
 * Every hop in this module lands on the SAME in-cluster Authentik origin
 * (authentikBaseUrl()) — a handful of times per login, in quick succession.
 * Node's default fetch dispatcher already pools keep-alive connections, but
 * with a short keepAliveTimeout tuned for general-purpose traffic; back-to-back
 * hops separated by CoreDNS's documented multi-second stalls (see recordHop
 * above) can outlive that default and force a fresh connection — and a fresh
 * DNS lookup — per hop. A dedicated Agent with a longer keep-alive holds the
 * socket open across a whole login/signup chain, so at most the FIRST hop pays
 * for DNS + connect.
 */
const authentikAgent = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 32,
})

/**
 * `fetch` with a hard AbortController deadline. On timeout the AbortError is
 * normalised to a labelled AuthentikUnavailableError carrying the elapsed time
 * and the target, so prod logs pinpoint exactly which hop stalled.
 *
 * Pass a `Deadline` for anything on the login/signup chain so the hop's
 * allowance is clamped to the whole-request budget rather than getting a fresh
 * full-length one.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  label: string,
  deadline?: Deadline,
  cap: number = AUTHENTIK_FLOW_TIMEOUT_MS
): Promise<Response> {
  if (deadline) deadline.assertLive(label)
  const timeoutMs = deadline ? deadline.hopBudget(cap) : cap
  const controller = new AbortController()
  const started = Date.now()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      dispatcher: authentikAgent,
    })
  } catch (err) {
    const e = err as Error
    if (e.name === 'AbortError') {
      logger.error(
        { label, elapsedMs: since(started), timeoutMs, url },
        'authentikPassword: hop timed out'
      )
      throw new AuthentikUnavailableError(
        `${label} timed out after ${timeoutMs}ms`
      )
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export class InvalidCredentialsError extends Error {
  constructor(message = 'Invalid credentials') {
    super(message)
    this.name = 'InvalidCredentialsError'
  }
}

export class AuthentikUnavailableError extends Error {
  constructor(message = 'Authentication service unavailable') {
    super(message)
    this.name = 'AuthentikUnavailableError'
  }
}

export class UnsupportedFlowStageError extends Error {
  constructor(stage: string) {
    super(`Unsupported Authentik flow stage: ${stage} (only identification+password is supported server-side)`)
    this.name = 'UnsupportedFlowStageError'
  }
}

/** Minimal cookie jar for the short-lived per-login Authentik session. */
export class CookieJar {
  private cookies = new Map<string, string>()

  absorb(res: { headers: Headers }): void {
    // Node >=18.14 exposes getSetCookie(); fall back to the single-value get()
    // (sufficient in practice — Authentik sets one cookie per response hop).
    const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] }
    const setCookies: string[] =
      typeof anyHeaders.getSetCookie === 'function'
        ? anyHeaders.getSetCookie()
        : ([res.headers.get('set-cookie')].filter(Boolean) as string[])
    for (const sc of setCookies) {
      const pair = sc.split(';')[0]
      const eq = pair.indexOf('=')
      if (eq <= 0) continue
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (value === '' || /max-age=0|expires=thu, 01 jan 1970/i.test(sc)) {
        this.cookies.delete(name)
      } else {
        this.cookies.set(name, value)
      }
    }
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  get(name: string): string | undefined {
    return this.cookies.get(name)
  }
}

/**
 * In-cluster base for THIS tenant's Authentik. Resolved from the tenant rather
 * than the environment so the server-side flow-executor calls land on the
 * tenant's own instance (authentik-server vs authentik-mendys-server) instead
 * of whichever one the process happened to be configured with.
 */
export function authentikBaseUrl(): string {
  const tenant = currentTenant('authentikBaseUrl')
  if (tenant.baseUrl) return tenant.baseUrl.replace(/\/$/, '')
  return new URL(tenant.issuerUrl).origin
}

function authFlowSlug(): string {
  return process.env.AUTHENTIK_AUTH_FLOW_SLUG || 'default-authentication-flow'
}

export function redirectUri(): string {
  return currentTenant('redirectUri').redirectUri
}

/**
 * Enrollment flow slug inside THIS tenant's Authentik. Each tenant ships its own
 * enrollment flow (fuzefront-enrollment vs mendys-enrollment), so this must not
 * fall back to a global default.
 */
function enrollmentFlowSlug(): string {
  return currentTenant('enrollmentFlowSlug').enrollmentFlowSlug
}

export interface FlowChallenge {
  component?: string
  type?: string
  to?: string
  password_fields?: boolean
  response_errors?: Record<string, Array<{ string?: string; code?: string }>>
  [key: string]: unknown
}

export async function flowRequest(
  base: string,
  slug: string,
  jar: CookieJar,
  body?: Record<string, unknown>,
  deadline?: Deadline
): Promise<FlowChallenge> {
  // Authentik commonly answers the first executor request with a 302 that
  // establishes the session cookie (Location points back into the flow), so
  // follow same-origin redirects manually, carrying the jar. Per Django 302
  // semantics a redirected POST is retried as GET.
  let url = `${base}/api/v3/flows/executor/${slug}/?query=`
  let method: 'GET' | 'POST' = body ? 'POST' : 'GET'
  let payload: string | undefined = body ? JSON.stringify(body) : undefined

  for (let hop = 0; hop < 10; hop++) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      // Django CSRF validates Referer on secure requests.
      Referer: `${base}/`,
    }
    const cookie = jar.header()
    if (cookie) headers['Cookie'] = cookie
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json'
      const csrf = jar.get('authentik_csrf')
      if (csrf) headers['X-CSRFToken'] = csrf
    }

    let res: Response
    const stepStart = Date.now()
    try {
      res = await fetchWithTimeout(
        url,
        { method, headers, body: payload, redirect: 'manual' },
        `flow.step slug=${slug} hop=${hop} ${method}`,
        deadline
      )
    } catch (err) {
      if (err instanceof AuthentikUnavailableError) throw err
      throw new AuthentikUnavailableError(
        `Authentik unreachable at ${base}: ${(err as Error).message}`
      )
    }
    recordHop(`flow.step slug=${slug} hop=${hop} ${method}`, since(stepStart), {
      slug,
      hop,
      method,
      status: res.status,
    })
    jar.absorb(res)

    const loc = res.headers.get('location')
    if ([301, 302, 303, 307, 308].includes(res.status) && loc) {
      // Only `location` is wanted from a redirect — hand the socket back before
      // issuing the next hop, or it stays checked out for the whole request and
      // the following hops queue behind it (see drainBody).
      drainBody(res)
      const nextUrl = new URL(loc, url)
      // The jar carries authentik_session/authentik_csrf — never present those
      // cookies to any host other than Authentik itself.
      if (nextUrl.origin !== new URL(base).origin) {
        throw new AuthentikUnavailableError(
          `Flow executor redirected off-origin to ${nextUrl.origin} — refusing to follow with session cookies`
        )
      }
      url = nextUrl.toString()
      // 301/302/303 rewrite the retry as GET (Django semantics); 307/308
      // preserve the original method and body per HTTP spec.
      if (res.status !== 307 && res.status !== 308) {
        method = 'GET'
        payload = undefined
      }
      continue
    }
    const contentTypeEarly = res.headers.get('content-type') || ''
    if (!res.ok) {
      // A 4xx with a JSON body is a FLOW response (e.g. 400 carrying
      // response_errors for rejected credentials) — return it so the caller
      // maps it to 401, instead of mislabeling it a 503 outage.
      if (res.status < 500 && contentTypeEarly.includes('json')) {
        return (await res.json()) as FlowChallenge
      }
      // Surface Authentik's own error payload — a bare status is undebuggable
      // from CI logs (e.g. 403 CSRF vs 404 unknown flow slug).
      const bodySnippet = (await res.text().catch(() => '')).slice(0, 300)
      throw new AuthentikUnavailableError(
        `Authentik flow executor HTTP ${res.status} at ${url}: ${bodySnippet}`
      )
    }
    if (!contentTypeEarly.includes('json')) {
      const bodySnippet = (await res.text().catch(() => '')).slice(0, 300)
      throw new AuthentikUnavailableError(
        `Authentik flow executor returned non-JSON (${contentTypeEarly}) at ${url}: ${bodySnippet}`
      )
    }
    return (await res.json()) as FlowChallenge
  }
  throw new AuthentikUnavailableError('Authentik flow executor redirect loop')
}

function challengeHasCredentialErrors(challenge: FlowChallenge): boolean {
  const errs = challenge.response_errors
  if (!errs) return false
  return Object.keys(errs).length > 0
}

/**
 * Authenticate email+password against Authentik and return the synced platform
 * User. Throws InvalidCredentialsError / AuthentikUnavailableError /
 * UnsupportedFlowStageError.
 */
export async function authentikPasswordLogin(
  email: string,
  password: string
): Promise<User> {
  const loginStart = Date.now()
  logger.info({ email }, 'authentikPassword: login start')
  try {
    const user = await authentikPasswordLoginInner(email, password)
    const elapsedMs = since(loginStart)
    // A login that SUCCEEDS at 25s is the failure mode that broke sign-in: it
    // never errors, so nothing alerts, and it only becomes visible once a
    // client bound trips underneath it. Report a slow success as loudly as a
    // slow hop — the per-hop WARNs above then say which stage owned the time.
    if (elapsedMs >= AUTHENTIK_LOGIN_WARN_MS) {
      logger.warn(
        { email, elapsedMs, thresholdMs: AUTHENTIK_LOGIN_WARN_MS },
        'authentikPassword: SLOW login (succeeded)'
      )
    } else {
      logger.info({ email, elapsedMs }, 'authentikPassword: login succeeded')
    }
    return user
  } catch (err) {
    logger.error(
      {
        email,
        elapsedMs: since(loginStart),
        errName: (err as Error).name,
        err: (err as Error).message,
      },
      'authentikPassword: login failed'
    )
    throw err
  }
}

async function authentikPasswordLoginInner(
  email: string,
  password: string
): Promise<User> {
  if (!getOidcService().isConfigured()) {
    throw new AuthentikUnavailableError('OIDC is not configured/initialized')
  }
  if (!getOidcService().isInitialized()) {
    // Lazy re-init: dedupes concurrent callers onto one in-flight attempt and
    // fails fast during the post-failure cooldown (see oidc.ts). Preserves
    // the original error type/message on failure.
    try {
      await getOidcService().ensureInitialized()
    } catch {
      throw new AuthentikUnavailableError('OIDC is not configured/initialized')
    }
  }

  const base = authentikBaseUrl()
  const slug = authFlowSlug()
  const jar = new CookieJar()
  // One budget for the WHOLE chain — flow stages AND the authorize hops below.
  const deadline = new Deadline()

  // ── Drive the authentication flow ─────────────────────────────────────────
  let challenge = await flowRequest(base, slug, jar, undefined, deadline)
  const MAX_STEPS = 6
  let authenticated = false

  for (let step = 0; step < MAX_STEPS; step++) {
    const component = challenge.component || challenge.type || ''

    if (component === 'xak-flow-redirect') {
      authenticated = true
      break
    }

    if (component === 'ak-stage-identification') {
      const body: Record<string, unknown> = {
        component,
        uid_field: email,
      }
      // Combined identification+password stage
      if (challenge.password_fields) body.password = password
      challenge = await flowRequest(base, slug, jar, body, deadline)
    } else if (component === 'ak-stage-password') {
      challenge = await flowRequest(
        base,
        slug,
        jar,
        { component, password },
        deadline
      )
    } else if (component === 'ak-stage-access-denied') {
      throw new InvalidCredentialsError()
    } else {
      // MFA, consent, prompts, … — not driveable server-side.
      throw new UnsupportedFlowStageError(component || 'unknown')
    }

    if (challengeHasCredentialErrors(challenge)) {
      throw new InvalidCredentialsError()
    }
  }

  if (!authenticated) {
    const last = challenge.component || challenge.type || 'unknown'
    if (last !== 'xak-flow-redirect') {
      throw new UnsupportedFlowStageError(last)
    }
  }

  // Complete OIDC code+PKCE with the now-authenticated Authentik session, on
  // whatever is LEFT of the login budget rather than a fresh one.
  return completeOidcWithSession(base, jar, deadline)
}

/**
 * Drive the OIDC authorize→code exchange using an ALREADY-AUTHENTICATED
 * Authentik session (the cookie jar). Shared by both server-side password login
 * and server-side signup (enrollment auto-logs the new user in, establishing the
 * same session). Token exchange + user sync is identical to the redirect
 * callback path — Authentik stays the SOLE identity authority.
 */
/**
 * Rewrite the (browser-facing, EXTERNAL) authorize URL onto the internal
 * Authentik base — protocol+host only, path/query untouched — so this
 * server-side hop stays in-cluster instead of hairpinning out through
 * Cloudflare/ingress. Safe because:
 *   - `redirect_uri`/`state`/PKCE params are unchanged, so token validation
 *     (handleCallback) still matches.
 *   - Authentik's issuer_mode is `per_provider`, so `iss` is fixed to the
 *     external issuer regardless of request host (see oidc.ts).
 * Measured impact: authorize.hop ~6.5s (external, via Cloudflare) -> ~0.2s
 * (internal service DNS). `base` already resolves to AUTHENTIK_BASE_URL when
 * set (see authentikBaseUrl()); this is a no-op when it is not.
 */
function toInternalAuthorizeUrl(externalUrl: string, base: string): string {
  try {
    const u = new URL(externalUrl)
    const b = new URL(base)
    u.protocol = b.protocol
    u.host = b.host
    return u.toString()
  } catch {
    return externalUrl
  }
}

export async function completeOidcWithSession(
  base: string,
  jar: CookieJar,
  deadline?: Deadline
): Promise<User> {
  const state = generators.state()
  const { url: authorizeUrl, codeVerifier } = getOidcService().generateAuthUrl(state)
  const target = redirectUri()

  let location = toInternalAuthorizeUrl(authorizeUrl, base)
  let code: string | null = null
  let returnedState: string | null = null
  const oidcStart = Date.now()

  for (let hop = 0; hop < 10; hop++) {
    let res: Response
    const hopStart = Date.now()
    try {
      res = await fetchWithTimeout(
        location,
        {
          method: 'GET',
          headers: { Cookie: jar.header(), Accept: 'application/json' },
          redirect: 'manual',
        },
        `authorize.hop hop=${hop}`,
        deadline
      )
    } catch (err) {
      if (err instanceof AuthentikUnavailableError) throw err
      throw new AuthentikUnavailableError(
        `Authorize request failed: ${(err as Error).message}`
      )
    }
    recordHop(`authorize.hop hop=${hop}`, since(hopStart), {
      hop,
      status: res.status,
    })
    jar.absorb(res)

    let next = res.headers.get('location')
    if (!next && res.status === 200) {
      // Authentik >=2026.x's flow executor can answer the final authorize hop
      // with an HTTP 200 "redirect" challenge — {"type":"redirect","to":"..."}
      // — instead of a 302 with a Location header. Same outcome (implicit
      // consent resolved, here is where to go next), different transport.
      // This is the only branch that reads the response body, so it also
      // takes over releasing the socket for this hop (see drainBody).
      try {
        const challenge = (await res.json()) as { type?: string; to?: string }
        if (challenge?.type === 'redirect' && typeof challenge.to === 'string') {
          next = challenge.to
        }
      } catch {
        // Not JSON, or not the redirect-challenge shape — fall through to the
        // consent-flow error below with the body already drained by .json().
      }
    } else {
      // Nothing else in this chain ever reads an authorize response BODY —
      // only its status, cookies and `location`. Release the socket now so
      // the next hop doesn't queue behind it (see drainBody).
      drainBody(res)
    }

    if (!next) {
      // Genuinely no Location header AND (not HTTP 200, or a 200 that wasn't
      // a redirect challenge) means Authentik rendered a flow UI (consent /
      // re-auth) — implicit consent is expected on the FuzeFront provider.
      throw new UnsupportedFlowStageError(
        `authorize returned HTTP ${res.status} without redirect (consent flow?)`
      )
    }
    const resolvedUrl = new URL(next, location)
    const resolved = resolvedUrl.toString()
    if (resolved.startsWith(target)) {
      const u = new URL(resolved)
      code = u.searchParams.get('code')
      returnedState = u.searchParams.get('state')
      const err = u.searchParams.get('error')
      if (err) {
        throw new AuthentikUnavailableError(`Authorize error: ${err}`)
      }
      break
    }
    // Continue only within Authentik's own origin — the jar must not follow
    // an arbitrary redirect elsewhere.
    if (resolvedUrl.origin !== new URL(base).origin) {
      throw new AuthentikUnavailableError(
        `Authorize flow redirected off-origin to ${resolvedUrl.origin} — refusing to follow with session cookies`
      )
    }
    location = resolved
  }

  if (!code) {
    throw new AuthentikUnavailableError(
      'Authorize flow did not produce an authorization code'
    )
  }

  logger.info(
    { elapsedMs: since(oidcStart) },
    'authentikPassword: authorize chain resolved to code; entering token exchange'
  )
  // Token exchange + user sync — identical to the redirect callback path.
  //
  // This stage is openid-client's, not ours, so it obeys OIDC_HTTP_TIMEOUT_MS
  // (15s) PER CALL and makes two (token, then userinfo) — on its own it can
  // outlast the whole login budget several times over and put us right back to
  // the client aborting first. Hold it to what is left of the budget so the
  // server still answers inside the browser's window with a stage-labelled
  // error. The underlying HTTP call may run on in the background; the point is
  // to stop WAITING on it, not to pretend it was cancelled.
  const exchangeStart = Date.now()
  const exchange = getOidcService().handleCallback(
    code,
    returnedState || state,
    codeVerifier
  )
  const bounded = deadline
    ? withDeadline(exchange, deadline, 'oidc.tokenExchange')
    : exchange
  // Timed like any other hop: this stage is two openid-client round-trips
  // (token, then userinfo) and is just as capable of being THE slow one, so it
  // must not be the one stage missing from the timing breakdown.
  return bounded.finally(() =>
    recordHop('oidc.tokenExchange', since(exchangeStart))
  )
}

/**
 * Resolve with `work`, or reject with a labelled AuthentikUnavailableError once
 * the shared budget is spent — whichever happens first.
 */
function withDeadline<T>(
  work: Promise<T>,
  deadline: Deadline,
  label: string
): Promise<T> {
  const remaining = deadline.remainingMs()
  if (remaining <= 0) {
    // Do not leave the already-started work as an unhandled rejection.
    void work.catch(() => undefined)
    deadline.assertLive(label)
  }
  let timer: NodeJS.Timeout
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      logger.error(
        { label, remainingMs: remaining },
        'authentikPassword: stage exceeded the remaining login budget'
      )
      reject(
        new AuthentikUnavailableError(
          `${label} exceeded the remaining ${remaining}ms of the sign-in budget`
        )
      )
    }, remaining)
    if (typeof timer.unref === 'function') timer.unref()
  })
  // When the timer wins the race, `work` is still in flight; a later rejection
  // from it would otherwise surface as an unhandled rejection and (under
  // Node's default) take the process down.
  void work.catch(() => undefined)
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer))
}

/** Thrown when an account already exists for the email (signup conflict). */
export class EnrollmentConflictError extends Error {
  constructor(message = 'An account with that email already exists') {
    super(message)
    this.name = 'EnrollmentConflictError'
  }
}

export interface AuthentikSignupInput {
  email: string
  password: string
  firstName?: string
  lastName?: string
  username?: string
}

/**
 * Create the account in AUTHENTIK by driving the self-service enrollment flow
 * server-side (same CookieJar + flow-executor driver as password login), then
 * complete the OIDC code exchange — the enrollment flow's final user-login
 * stage establishes an authenticated session, so the freshly-created user is
 * synced into the platform DB via the SAME `syncUserToDatabase` path login
 * uses. Authentik is the sole identity store; no local bcrypt user is written.
 *
 * The blueprint flow (deploy/helm/.../authentik/blueprints/flow-enrollment.yaml)
 * has a single prompt stage (email/username/password/password_repeat/tos) then
 * a user-write + user-login stage. Only that shape is driven; any other stage
 * (e.g. an email-verification stage) fails closed as unsupported server-side.
 */
export async function authentikSignup(input: AuthentikSignupInput): Promise<User> {
  const signupStart = Date.now()
  logger.info({ email: input.email }, 'authentikPassword: signup start')
  try {
    const user = await authentikSignupInner(input)
    logger.info(
      { email: input.email, elapsedMs: since(signupStart) },
      'authentikPassword: signup succeeded'
    )
    return user
  } catch (err) {
    logger.error(
      {
        email: input.email,
        elapsedMs: since(signupStart),
        errName: (err as Error).name,
        err: (err as Error).message,
      },
      'authentikPassword: signup failed'
    )
    throw err
  }
}

async function authentikSignupInner(input: AuthentikSignupInput): Promise<User> {
  if (!getOidcService().isConfigured()) {
    throw new AuthentikUnavailableError('OIDC is not configured/initialized')
  }
  if (!getOidcService().isInitialized()) {
    try {
      await getOidcService().ensureInitialized()
    } catch {
      throw new AuthentikUnavailableError('OIDC is not configured/initialized')
    }
  }
  if (!input.email || !input.password) {
    throw new InvalidCredentialsError('email and password are required')
  }

  const base = authentikBaseUrl()
  const slug = enrollmentFlowSlug()
  const jar = new CookieJar()
  // Signup drives the same multi-hop chain as login and is bounded by the same
  // client-side LOGIN_TIMEOUT_MS, so it gets the same whole-request budget.
  const deadline = new Deadline()

  // Derive a username from the local-part when the caller did not supply one.
  const username =
    input.username || input.email.split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '') || input.email

  let challenge = await flowRequest(base, slug, jar, undefined, deadline)
  const MAX_STEPS = 8
  let enrolled = false

  for (let step = 0; step < MAX_STEPS; step++) {
    const component = challenge.component || challenge.type || ''

    if (component === 'xak-flow-redirect') {
      enrolled = true
      break
    }

    if (component === 'ak-stage-prompt') {
      // The enrollment prompt collects all fields at once. Include name fields
      // and the ToS acceptance; Authentik ignores unknown fields.
      const body: Record<string, unknown> = {
        component,
        email: input.email,
        username,
        password: input.password,
        password_repeat: input.password,
        tos_accepted: true,
      }
      if (input.firstName || input.lastName) {
        body.name = [input.firstName, input.lastName].filter(Boolean).join(' ')
      }
      challenge = await flowRequest(base, slug, jar, body, deadline)
    } else if (component === 'ak-stage-user-login' || component === 'ak-stage-user-write') {
      // Non-interactive stages that occasionally surface a challenge — re-POST
      // the bare component to advance.
      challenge = await flowRequest(base, slug, jar, { component }, deadline)
    } else if (component === 'ak-stage-access-denied') {
      throw new EnrollmentConflictError()
    } else {
      // Captcha, email-verification, MFA-enroll, consent … not driveable here.
      throw new UnsupportedFlowStageError(component || 'unknown')
    }

    if (challengeHasCredentialErrors(challenge)) {
      // Distinguish "already exists" from a password-policy rejection.
      const errs = challenge.response_errors || {}
      const flat = JSON.stringify(errs).toLowerCase()
      if (
        errs.email ||
        errs.username ||
        /already|exist|taken|unique/.test(flat)
      ) {
        throw new EnrollmentConflictError()
      }
      throw new InvalidCredentialsError(
        'Enrollment rejected: ' + flat.slice(0, 200)
      )
    }
  }

  if (!enrolled) {
    const last = challenge.component || challenge.type || 'unknown'
    throw new UnsupportedFlowStageError(last)
  }

  // Enrollment auto-logged-in → complete OIDC + sync via the shared path, on
  // whatever is LEFT of the signup budget rather than a fresh one.
  return completeOidcWithSession(base, jar, deadline)
}

/** Thrown when the identity store has no account for the address. */
export class AuthentikUserNotFoundError extends Error {
  constructor(message = 'No identity-store account for that address') {
    super(message)
    this.name = 'AuthentikUserNotFoundError'
  }
}

/** Thrown when the new password is rejected by the identity store's policy. */
export class PasswordPolicyError extends Error {
  constructor(message = 'Password does not meet the password policy') {
    super(message)
    this.name = 'PasswordPolicyError'
  }
}

function authentikAdminToken(): string {
  const token = currentTenant('Authentik admin token').adminToken
  if (!token) {
    throw new AuthentikUnavailableError(
      'An Authentik admin token is required to set an account password, and none is configured for this tenant'
    )
  }
  return token
}

/**
 * Set an account's password IN THE IDENTITY STORE (Authentik) via the Admin API.
 *
 * Authentik is the sole credential store — FuzeFront never writes a local
 * password hash, so a reset MUST land here or it has not happened. Resolves the
 * account by email (`GET /api/v3/core/users/?email=`) then drives
 * `POST /api/v3/core/users/{pk}/set_password/`.
 *
 * Fail-closed: an unresolvable account, a policy rejection, or any transport
 * error throws — a caller never treats a non-2xx as "reset".
 */
export async function authentikSetPassword(
  email: string,
  newPassword: string
): Promise<void> {
  if (!email || !newPassword) {
    throw new InvalidCredentialsError('email and newPassword are required')
  }
  const base = authentikBaseUrl()
  const headers = {
    Authorization: `Bearer ${authentikAdminToken()}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  let lookup: Response
  try {
    lookup = await fetchWithTimeout(
      `${base}/api/v3/core/users/?email=${encodeURIComponent(email)}`,
      { headers },
      'setPassword.lookup'
    )
  } catch (err) {
    if (err instanceof AuthentikUnavailableError) throw err
    throw new AuthentikUnavailableError(
      `identity-store lookup failed: ${(err as Error).message}`
    )
  }
  if (!lookup.ok) {
    throw new AuthentikUnavailableError(
      `identity-store user lookup returned HTTP ${lookup.status}`
    )
  }
  const body = (await lookup.json().catch(() => ({}))) as {
    results?: Array<{ pk: number | string; email?: string }>
  }
  // Match the address exactly (case-insensitively): the query is a filter, not
  // an exact-match guarantee, and resetting the WRONG account is unacceptable.
  const match = (body.results || []).find(
    u => (u.email || '').toLowerCase() === email.toLowerCase()
  )
  if (!match) throw new AuthentikUserNotFoundError()

  let res: Response
  try {
    res = await fetchWithTimeout(
      `${base}/api/v3/core/users/${match.pk}/set_password/`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ password: newPassword }),
      },
      'setPassword.set'
    )
  } catch (err) {
    if (err instanceof AuthentikUnavailableError) throw err
    throw new AuthentikUnavailableError(
      `identity-store set_password failed: ${(err as Error).message}`
    )
  }
  // 400 is the password-policy rejection; surface it distinctly so the API can
  // answer 400 rather than a generic failure.
  if (res.status === 400) {
    const text = await res.text().catch(() => '')
    throw new PasswordPolicyError(
      text ? `Password rejected by policy: ${text}` : undefined
    )
  }
  if (!res.ok) {
    throw new AuthentikUnavailableError(
      `identity-store set_password returned HTTP ${res.status}`
    )
  }
}
