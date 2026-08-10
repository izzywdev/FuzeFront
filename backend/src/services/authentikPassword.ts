/**
 * Server-side Authentik password authentication — no browser redirect.
 * Monolith-backend port of backend/security/src/services/authentikPassword.ts
 * (the split security service is authoritative in prod; the monolith serves
 * the docker-compose / e2e stacks). Behavior is identical; the only
 * differences are this oidc service's signatures: generateAuthUrl(state)
 * returns the URL string and stashes the PKCE verifier in the in-process map,
 * and handleCallback(code, state) reads it back from there.
 *
 * See the security-service copy for the full flow documentation.
 */
import { generators } from 'openid-client'
import { oidcService } from './oidc'
import { User } from '../types/shared'

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
class CookieJar {
  private cookies = new Map<string, string>()

  absorb(res: { headers: Headers }): void {
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

function authentikBaseUrl(): string {
  if (process.env.AUTHENTIK_BASE_URL) {
    return process.env.AUTHENTIK_BASE_URL.replace(/\/$/, '')
  }
  const issuer =
    process.env.AUTHENTIK_ISSUER_URL ||
    'http://localhost:9000/application/o/fuzefront/'
  return new URL(issuer).origin
}

function authFlowSlug(): string {
  return process.env.AUTHENTIK_AUTH_FLOW_SLUG || 'default-authentication-flow'
}

function redirectUri(): string {
  return (
    process.env.AUTHENTIK_REDIRECT_URI ||
    'http://fuzefront.dev.local/api/auth/oidc/callback'
  )
}

interface FlowChallenge {
  component?: string
  type?: string
  to?: string
  password_fields?: boolean
  response_errors?: Record<string, Array<{ string?: string; code?: string }>>
  /** ak-stage-consent's confirmation token — POST it back to advance. */
  token?: string
  [key: string]: unknown
}

async function flowRequest(
  base: string,
  slug: string,
  jar: CookieJar,
  body?: Record<string, unknown>,
  // The original request's query string (e.g. the OAuth authorize params),
  // forwarded as Authentik's `query` param so the flow executor knows which
  // in-flight request it's continuing — required when entering a flow via
  // an existing `/if/flow/<slug>/?...` redirect rather than starting fresh.
  flowQuery?: string
): Promise<FlowChallenge> {
  // Authentik commonly answers the first executor request with a 302 that
  // establishes the session cookie (Location points back into the flow), so
  // follow same-origin redirects manually, carrying the jar. Per Django 302
  // semantics a redirected POST is retried as GET.
  let url = `${base}/api/v3/flows/executor/${slug}/?query=${encodeURIComponent(flowQuery ?? '')}`
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
      if (slug.includes('authorization-implicit-consent')) {
        // TEMPORARY diagnostic (FuzeFront#557 follow-up round 5): the cookie
        // jar has the CSRF value right before this call, yet Authentik still
        // reports "CSRF token missing" — log exactly what this fetch sends.
        console.warn(
          'authentikPassword: DIAGNOSTIC — outgoing headers for the consent-flow POST',
          { hop, slug, url, headers: { ...headers, Cookie: headers.Cookie ? '<redacted>' : undefined }, payload }
        )
      }
    }

    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers,
        body: payload,
        redirect: 'manual',
      })
    } catch (err) {
      throw new AuthentikUnavailableError(
        `Authentik unreachable at ${base}: ${(err as Error).message}`
      )
    }
    jar.absorb(res)

    const loc = res.headers.get('location')
    if ([301, 302, 303, 307, 308].includes(res.status) && loc) {
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
  if (!oidcService.isConfigured() || !oidcService.isInitialized()) {
    throw new AuthentikUnavailableError('OIDC is not configured/initialized')
  }

  const base = authentikBaseUrl()
  const slug = authFlowSlug()
  const jar = new CookieJar()

  // ── Drive the authentication flow ─────────────────────────────────────────
  let challenge = await flowRequest(base, slug, jar)
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
      if (challenge.password_fields) body.password = password
      challenge = await flowRequest(base, slug, jar, body)
    } else if (component === 'ak-stage-password') {
      challenge = await flowRequest(base, slug, jar, { component, password })
    } else if (component === 'ak-stage-access-denied') {
      throw new InvalidCredentialsError()
    } else {
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

  // ── Complete OIDC code+PKCE with the authenticated session ────────────────
  // The monolith's generateAuthUrl(state) stores the PKCE verifier in its
  // in-process map keyed by state; handleCallback(code, state) reads it back.
  const state = generators.state()
  const authorizeUrl = oidcService.generateAuthUrl(state)
  const target = redirectUri()

  let location = authorizeUrl
  let code: string | null = null
  let returnedState: string | null = null

  for (let hop = 0; hop < 10; hop++) {
    let res: Response
    try {
      res = await fetch(location, {
        method: 'GET',
        headers: { Cookie: jar.header(), Accept: 'application/json' },
        redirect: 'manual',
      })
    } catch (err) {
      throw new AuthentikUnavailableError(
        `Authorize request failed: ${(err as Error).message}`
      )
    }
    jar.absorb(res)

    let next = res.headers.get('location')
    // Confirmed against real Authentik 2026.5.5 in CI (FuzeFront#557): when
    // implicit consent resolves, the 302 from /application/o/authorize/ lands
    // on the flow's browser SHELL page — /if/flow/<slug>/?<original-query> —
    // not a JSON payload. That page always serves HTML regardless of Accept,
    // because it's the SPA entry point; the machine-readable challenge only
    // comes from the flow-executor JSON API at
    // /api/v3/flows/executor/<slug>/?query=<original-query>, the same
    // endpoint flowRequest() already drives for the identification/password
    // stages. So: detect that shell URL and call the JSON API directly
    // instead of trying to parse the shell page itself.
    const flowShellMatch = !next ? location.match(/\/if\/flow\/([^/?]+)\/(?:\?(.*))?$/) : null
    let flowStageSeen: string | undefined
    if (flowShellMatch) {
      const [, slug, flowQuery] = flowShellMatch
      let challenge = await flowRequest(base, slug, jar, undefined, flowQuery)
      if (challenge.component === 'ak-stage-consent' && typeof challenge.token === 'string') {
        // Confirmed against real Authentik 2026.5.5 in CI: even with the
        // provider set to implicit consent, the flow executor still renders
        // ConsentStage exactly once via the API (the browser client would
        // auto-submit it without ever showing UI) — POST its token back to
        // confirm, which then resolves to the actual redirect challenge.
        //
        // TEMPORARY diagnostic (FuzeFront#557 follow-up round 4): the POST
        // fails server-side with "CSRF Failed: CSRF token missing" — the
        // cookie IS present (else Django's message would be "CSRF cookie not
        // set") but our X-CSRFToken header apparently wasn't. Log the jar's
        // exact cookie state right before the POST to see why.
        console.warn(
          'authentikPassword: DIAGNOSTIC — cookie jar state before consent-confirm POST',
          { hop, slug, cookieHeader: jar.header(), csrfCookie: jar.get('authentik_csrf') }
        )
        challenge = await flowRequest(
          base,
          slug,
          jar,
          { component: 'ak-stage-consent', token: challenge.token },
          flowQuery
        )
      }
      const isRedirectChallenge =
        challenge.component === 'xak-flow-redirect' || challenge.type === 'redirect'
      if (isRedirectChallenge && typeof challenge.to === 'string') {
        next = challenge.to
      } else {
        flowStageSeen = challenge.component || challenge.type
        // TEMPORARY diagnostic (FuzeFront#557 follow-up round 3): the
        // consent-token POST is confirmed reached (this now reports
        // ak-stage-flow-error instead of the old generic message), so
        // Authentik is rejecting the POST itself. Log the full challenge —
        // Authentik's flow-error stage usually carries the actual reason.
        console.warn(
          'authentikPassword: DIAGNOSTIC — flow-executor challenge after consent POST was not a recognized redirect',
          { hop, slug, flowQuery, challenge }
        )
      }
    }
    if (!next) {
      throw new UnsupportedFlowStageError(
        flowStageSeen ??
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

  return oidcService.handleCallback(code, returnedState || state)
}
