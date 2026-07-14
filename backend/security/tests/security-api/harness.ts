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

export function agent(provider?: IdentityProvider) {
  if (BASE_URL) return supertest(BASE_URL)
  return supertest(createSecurityApp(provider))
}
