/**
 * Server-only configuration for the Authentik-backed identity provider.
 *
 * Everything here lives ONLY inside the concrete provider implementation — no
 * vendor name leaks past this boundary into the API surface.
 *
 * Tenant-dependent values are read from the ambient tenant (see tenants.ts),
 * NOT from process.env, because security-service fronts several tenants and
 * each is backed by its own Authentik instance and account directory. In legacy
 * single-tenant mode the ambient tenant is synthesised from the same env vars
 * these functions used to read, so behaviour is unchanged.
 */
import { currentTenant } from './tenants'

/** App base origin the browser talks to (same-origin API base), per tenant. */
export function appBaseUrl(): string {
  return currentTenant('appBaseUrl').appBaseUrl
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
 * Whether the SERVER-BROKERED Google path is active for the current tenant
 * (default ON). The fallback is Authentik's `/source/oauth/*` source-redirect,
 * which sends the BROWSER to Authentik — acceptable for FuzeFront, whose
 * Authentik paths are routed under its own app host, but NOT for a tenant whose
 * whole premise is that Authentik is invisible to it. Such a tenant must set
 * `googleBrokered: true` and keep it there.
 */
export function googleBrokeredEnabled(): boolean {
  return currentTenant('googleBrokered').googleBrokered
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
