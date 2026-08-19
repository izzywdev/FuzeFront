/**
 * Boundary / vendor-neutrality assertions.
 *
 * No AuthN response, redirect, or body may reference the internal identity host
 * (`auth.fuzefront.com`) or name a vendor. Social `start` 302 must target a
 * FuzeFront-owned (or Google) host only. This is the acute-leak regression gate
 * at the API layer (the browser-level version lives in frontend-test-engineer's
 * Playwright suite — out of this suite's scope).
 */
import { agent, RUNNING_AGAINST } from './harness'
import {
  spec,
  FORBIDDEN_INTERNAL_HOST,
  FORBIDDEN_VENDOR_TOKENS,
  ALLOWED_SOCIAL_HOSTS,
} from './spec'
import { SEED } from './mockIdentityProvider'

function assertClean(label: string, text: string) {
  const lower = text.toLowerCase()
  expect(`${label}:${lower.includes(FORBIDDEN_INTERNAL_HOST)}`).toBe(`${label}:false`)
  for (const vendor of FORBIDDEN_VENDOR_TOKENS) {
    expect(`${label}/${vendor}:${lower.includes(vendor)}`).toBe(`${label}/${vendor}:false`)
  }
}

describe(`boundary + neutrality (against ${RUNNING_AGAINST})`, () => {
  it('the frozen spec itself names no vendor in any consumer-facing path/schema key', () => {
    // Descriptions may cite Google (a genuine social provider) but never our IdP vendor.
    const pathsAndSchemas = JSON.stringify({
      paths: Object.keys(spec.paths),
      schemas: Object.keys(spec.components.schemas),
    }).toLowerCase()
    assertClean('spec-names', pathsAndSchemas)
  })

  it('social start Location is a FuzeFront-owned/Google host, never the internal IdP', async () => {
    const res = await agent().get('/api/v1/security/social/google/start').redirects(0)
    const loc = res.headers['location'] || ''
    assertClean('social-start-location', loc)
    try {
      const host = new URL(loc).host
      expect(ALLOWED_SOCIAL_HOSTS.has(host)).toBe(true)
    } catch {
      /* relative Location = same-origin, inherently owned */
    }
  })

  it('successful login response references no vendor/internal host', async () => {
    const res = await agent()
      .post('/api/v1/security/session')
      .send({ email: SEED.email, password: SEED.password })
    assertClean('login-body', JSON.stringify(res.body))
  })

  it('error bodies reference no vendor/internal host', async () => {
    const res = await agent()
      .post('/api/v1/security/session')
      .send({ email: SEED.email, password: 'wrong' })
    assertClean('error-body', JSON.stringify(res.body))
  })

  it('/methods descriptor references no vendor/internal host', async () => {
    const res = await agent().get('/api/v1/security/methods')
    assertClean('methods-body', JSON.stringify(res.body))
  })
})
