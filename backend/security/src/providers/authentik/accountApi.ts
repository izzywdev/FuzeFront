/**
 * Authentik admin-API calls for ACCOUNT sign-in methods (social source
 * connections + password).
 *
 * Provider-internal: this is one of the few places the identity vendor is named.
 * Everything above it speaks the neutral `IdentityProvider` contract, so the
 * Authentik `pk`s, source slugs, and endpoint shapes below never cross the
 * boundary. Swap this file to swap providers.
 *
 * Fail-closed: every call throws on any transport/HTTP error. A caller never
 * receives a permissive default (e.g. "no connections", which would let the
 * last-sign-in-method guard wave through an account lockout).
 */

/** A social source connection as Authentik models it. */
export interface OAuthConnection {
  /** Authentik connection pk — provider-internal, used only to unlink. */
  pk: number
  /** Authentik source slug; mapped to our neutral provider slug by the caller. */
  sourceSlug: string
  /** Epoch millis the connection was created, when Authentik reports it. */
  createdAt?: number
}

function baseUrl(): string {
  return (
    process.env.AUTHENTIK_BASE_URL ||
    process.env.AUTHENTIK_ISSUER_URL?.replace(/\/application\/o\/.*$/, '') ||
    'http://localhost:9000'
  ).replace(/\/$/, '')
}

function adminToken(): string {
  const token = process.env.AUTHENTIK_ADMIN_TOKEN
  if (!token) {
    // Fail-closed: without admin credentials we cannot read connection state,
    // and guessing it is exactly how an account gets locked out.
    throw new Error('AUTHENTIK_ADMIN_TOKEN is not configured')
  }
  return token
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${adminToken()}`,
    Accept: 'application/json',
  }
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { ...headers(), ...(init.headers as Record<string, string>) },
    })
  } catch (err) {
    throw new Error(`identity store unreachable: ${(err as Error).message}`)
  }
  return res
}

async function okJson(res: Response, what: string): Promise<any> {
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`identity store ${what} failed: HTTP ${res.status} ${body}`)
  }
  return res.json()
}

/**
 * Resolve the identity store's user pk from the email.
 *
 * Email is the natural key our local projection matches on (the local `id` is a
 * generated uuid, deliberately NOT the OIDC `sub`), so it is the only join we
 * have. `email=` is an exact filter in Authentik's user list API.
 */
export async function findUserPk(email: string): Promise<number> {
  const res = await call(`/api/v3/core/users/?email=${encodeURIComponent(email)}`)
  const data = await okJson(res, 'user lookup')
  const results: any[] = data?.results ?? []
  // Exact, case-insensitive match — never trust the filter to be exact-only.
  const hit = results.find(
    r => typeof r?.email === 'string' && r.email.toLowerCase() === email.toLowerCase()
  )
  if (!hit || typeof hit.pk !== 'number') {
    throw new Error('identity store user not found')
  }
  return hit.pk
}

/** List the user's OAuth source connections. */
export async function listOAuthConnections(userPk: number): Promise<OAuthConnection[]> {
  const res = await call(`/api/v3/sources/user_connections/oauth/?user=${userPk}`)
  const data = await okJson(res, 'connection list')
  const results: any[] = data?.results ?? []
  return results.map(r => ({
    pk: r.pk,
    // `source` may be an expanded object or a bare slug depending on version.
    sourceSlug: typeof r.source === 'string' ? r.source : (r.source?.slug ?? ''),
    createdAt: r.created ? new Date(r.created).getTime() : undefined,
  }))
}

/** Delete one OAuth source connection by its connection pk. */
export async function deleteOAuthConnection(connectionPk: number): Promise<void> {
  const res = await call(`/api/v3/sources/user_connections/oauth/${connectionPk}/`, {
    method: 'DELETE',
  })
  // 404 = already gone; unlink is idempotent, so that is a success.
  if (!res.ok && res.status !== 404) {
    const body = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`identity store unlink failed: HTTP ${res.status} ${body}`)
  }
}

/**
 * Set the user's password IN THE IDENTITY STORE (never a local hash).
 *
 * A policy rejection comes back as a 400 with the reasons; the caller maps that
 * to a 400 rather than a generic failure.
 */
export async function setUserPassword(userPk: number, password: string): Promise<void> {
  const res = await call(`/api/v3/core/users/${userPk}/set_password/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (res.status === 400) {
    const body = (await res.text().catch(() => '')).slice(0, 300)
    throw new PasswordPolicyError(body || 'password rejected by policy')
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`identity store set-password failed: HTTP ${res.status} ${body}`)
  }
}

/** Thrown when the identity store rejects a password on policy grounds (→ 400). */
export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PasswordPolicyError'
  }
}
