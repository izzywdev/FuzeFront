/**
 * harness.ts — resolves the SUBJECT UNDER TEST for the AuthN contract suite.
 *
 * - If SECURITY_BASE_URL is set → run the identical spec assertions against the
 *   REAL running implementation (e.g. an ephemeral stack in CI). This is how the
 *   suite becomes objective verification of the backend once it lands.
 * - Otherwise → fall back to the in-process contract-mock reference app driven
 *   by MockIdentityProvider. This keeps the suite runnable (and proves the
 *   contract is satisfiable through the neutral interface) before the impl lands.
 *
 * Either way, `agent()` returns a supertest instance the tests use uniformly.
 */
import supertest from 'supertest'
import { createSecurityApp } from './referenceApp'
import { IdentityProvider } from '../../src/providers/IdentityProvider'

export const BASE_URL = process.env.SECURITY_BASE_URL

export const RUNNING_AGAINST: 'live-implementation' | 'contract-mock' = BASE_URL
  ? 'live-implementation'
  : 'contract-mock'

// A single persistent contract-mock app+provider is the in-process stand-in for
// "the running server": session/token state minted by one request must be
// visible to the next, exactly as it would be against a live backend. So the
// no-arg `agent()` reuses ONE app (and one MockIdentityProvider) for the whole
// run. Passing an explicit `provider` opts out (fresh app) — used by suites that
// want an isolated provider instance (mfa lifecycle, provider-swap).
let sharedApp: ReturnType<typeof createSecurityApp> | undefined

export function agent(provider?: IdentityProvider) {
  if (BASE_URL) return supertest(BASE_URL)
  if (provider) return supertest(createSecurityApp(provider))
  if (!sharedApp) sharedApp = createSecurityApp()
  return supertest(sharedApp)
}
