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
 *   6. oidcService.handleCallback(code, state, codeVerifier) → synced User
 *
 * Only single-factor identification/password flows are supported. Users with
 * MFA or other stages configured must use the browser (Google/SSO) path — we
 * fail closed with a clear error rather than trying to drive arbitrary stages.
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
  [key: string]: unknown
}

async function flowRequest(
  base: string,
  slug: string,
  jar: CookieJar,
  body?: Record<string, unknown>
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
      // Combined identification+password stage
      if (challenge.password_fields) body.password = password
      challenge = await flowRequest(base, slug, jar, body)
    } else if (component === 'ak-stage-password') {
      challenge = await flowRequest(base, slug, jar, { component, password })
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

  // ── Complete OIDC code+PKCE with the authenticated session ────────────────
  const state = generators.state()
  const { url: authorizeUrl, codeVerifier } = oidcService.generateAuthUrl(state)
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

    const next = res.headers.get('location')
    if (!next) {
      // 200 here means Authentik rendered a flow UI (consent / re-auth) —
      // implicit consent is expected on the FuzeFront provider.
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

  // Token exchange + user sync — identical to the redirect callback path.
  return oidcService.handleCallback(code, returnedState || state, codeVerifier)
}
