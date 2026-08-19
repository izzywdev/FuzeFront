/**
 * Provider factory — env-driven selection of the concrete `IdentityProvider`.
 *
 * The `/api/v1/security` routes call `getIdentityProvider()` and never name a
 * vendor. Swapping providers is a one-line change here (or an env flip once a
 * second provider exists). Today only the Authentik-backed implementation
 * exists; `SECURITY_IDENTITY_PROVIDER` selects it (default `authentik`).
 */
import type { IdentityProvider } from './IdentityProvider'
import { AuthentikIdentityProvider } from './authentik/AuthentikIdentityProvider'

let singleton: IdentityProvider | null = null

export function getIdentityProvider(): IdentityProvider {
  if (singleton) return singleton
  const selected = (process.env.SECURITY_IDENTITY_PROVIDER || 'authentik').toLowerCase()
  switch (selected) {
    case 'authentik':
      singleton = new AuthentikIdentityProvider()
      break
    default:
      throw new Error(`Unknown SECURITY_IDENTITY_PROVIDER: ${selected}`)
  }
  return singleton
}

/** Test seam: inject a provider (e.g. a fake) and reset between tests. */
export function setIdentityProvider(p: IdentityProvider | null): void {
  singleton = p
}
