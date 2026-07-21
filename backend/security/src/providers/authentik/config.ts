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
 * same-host path (optionally under this prefix), so the browser never sees an
 * internal identity host.
 *
 * DEFAULT is now EMPTY (""): PR #256 removed the `/api/auth/idp` ingress path and
 * routes Authentik's NATIVE paths (`/application`, `/if`, `/flows`, `/source`,
 * `/ws`, `/-`, …) directly under app.fuzefront.com with NO prefix. So the
 * authorize URL must be a bare native same-host path
 * (`/application/o/authorize/…`) which #256 routes to the internal
 * authentik-server. Set `SECURITY_IDP_PROXY_PREFIX` only if a deployment
 * re-introduces a reverse-proxy prefix.
 */
export function idpProxyPrefix(): string {
  const raw = process.env.SECURITY_IDP_PROXY_PREFIX ?? ''
  const trimmed = raw.replace(/^\/+|\/+$/g, '')
  // Empty → no prefix at all (native paths), NOT a bare "/" (which would
  // produce a "//application/…" double-slash when concatenated with pathname).
  return trimmed ? '/' + trimmed : ''
}

/** Same-origin social-callback path (where the internal IdP returns the browser). */
export function socialCallbackPath(): string {
  return '/api/v1/security/social/callback'
}

/**
 * Same-origin Google broker-callback path. Google redirects the browser HERE
 * (not to Authentik's `/source/oauth/callback/google/`) after consent, so the
 * security service can exchange the code with Google directly. This exact URL
 * MUST be registered in the Google Cloud console's Authorized redirect URIs.
 */
export function googleCallbackPath(): string {
  return '/api/v1/security/social/google/callback'
}

/**
 * Whether the SERVER-BROKERED Google path is active (default ON). Set
 * `SECURITY_GOOGLE_BROKERED=false` to fall back to the legacy Authentik
 * `/source/oauth/*` source-redirect path while the brokered path is being proven.
 */
export function googleBrokeredEnabled(): boolean {
  return process.env.SECURITY_GOOGLE_BROKERED !== 'false'
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
