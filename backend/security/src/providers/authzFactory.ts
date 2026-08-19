/**
 * Authorization provider factory — env-driven selection of the concrete
 * `AuthorizationProvider`. Mirrors `factory.ts` for identity.
 *
 * The `/api/v1/security/authz` + `/tenants` routes and `requirePermission`
 * middleware call `getAuthorizationProvider()` and never name a vendor.
 * Swapping engines is a one-line change here (or an env flip once a second
 * provider exists). Today only the Permit-backed implementation exists;
 * `SECURITY_AUTHORIZATION_PROVIDER` selects it (default `permit`).
 */
import type { AuthorizationProvider } from './AuthorizationProvider'
import { PermitAuthorizationProvider } from './permit/PermitAuthorizationProvider'

let singleton: AuthorizationProvider | null = null

export function getAuthorizationProvider(): AuthorizationProvider {
  if (singleton) return singleton
  const selected = (
    process.env.SECURITY_AUTHORIZATION_PROVIDER || 'permit'
  ).toLowerCase()
  switch (selected) {
    case 'permit':
      singleton = new PermitAuthorizationProvider()
      break
    default:
      throw new Error(`Unknown SECURITY_AUTHORIZATION_PROVIDER: ${selected}`)
  }
  return singleton
}

/** Test seam: inject a provider (e.g. a mock) and reset between tests. */
export function setAuthorizationProvider(p: AuthorizationProvider | null): void {
  singleton = p
}
