/**
 * Server-only configuration for the Authentik-backed identity provider.
 *
 * Everything here is env-driven and lives ONLY inside the concrete provider
 * implementation — no vendor name leaks past this boundary into the API surface.
 */

/** App base origin the browser talks to (same-origin API base). */
export function appBaseUrl(): string {
  return (process.env.FRONTEND_URL || 'http://fuzefront.dev.local').replace(/\/$/, '')
}

/**
 * The internal IdP reverse-proxy prefix. The browser is ALWAYS sent to a
 * same-host path under this prefix (devops reverse-proxies it to the internal
 * authentik-server ClusterIP), so the browser never sees an internal identity
 * host. Configurable; defaults to the coordinated same-host prefix.
 */
export function idpProxyPrefix(): string {
  const raw = process.env.SECURITY_IDP_PROXY_PREFIX || '/api/auth/idp'
  return '/' + raw.replace(/^\/+|\/+$/g, '')
}

/** Same-origin social-callback path (where the internal IdP returns the browser). */
export function socialCallbackPath(): string {
  return '/api/v1/security/social/callback'
}

/** Session token lifetime (ms). */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000

/** Opaque broker-code lifetime (ms) — single-use, short-lived. */
export const CODE_TTL_MS = 60_000

/** JWT signing secret; fail-closed if unset. */
export function jwtSecret(): string {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not configured')
  return s
}
