/**
 * Tests for the multi-tenant identity registry.
 *
 * The claims under test are security claims, not conveniences:
 *   1. Legacy mode reproduces the pre-tenancy configuration EXACTLY, so
 *      existing FuzeFront deployments are untouched.
 *   2. In multi-tenant mode an unclaimed host is REJECTED — never served by a
 *      default tenant, which would authenticate a user against the wrong
 *      account directory.
 *   3. A session minted for one tenant is not accepted by another.
 */
import {
  NoTenantContextError,
  allTenants,
  currentTenant,
  currentTenantOrUndefined,
  isMultiTenant,
  normaliseHost,
  resetTenantRegistryForTests,
  resolveTenantByHost,
  runWithTenant,
} from '../src/providers/authentik/tenants'
import { assertTenantMatches } from '../src/middleware/tenant-context'

const ENV_KEYS = [
  'SECURITY_TENANTS',
  'SECURITY_TENANT_ID',
  'FRONTEND_URL',
  'AUTHENTIK_ISSUER_URL',
  'AUTHENTIK_BASE_URL',
  'AUTHENTIK_CLIENT_ID',
  'AUTHENTIK_CLIENT_SECRET',
  'AUTHENTIK_REDIRECT_URI',
  'AUTHENTIK_ADMIN_TOKEN',
  'AUTHENTIK_ENROLLMENT_FLOW_SLUG',
  'SECURITY_GOOGLE_BROKERED',
]

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  resetTenantRegistryForTests()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  resetTenantRegistryForTests()
})

const TWO_TENANTS = JSON.stringify([
  {
    id: 'fuzefront',
    hosts: ['app.fuzefront.com'],
    issuerUrl: 'https://app.fuzefront.com/application/o/fuzefront/',
    baseUrl: 'http://authentik-server:9000',
    clientId: 'fuzefront-oidc-client',
    clientSecret: 'ff-secret',
    redirectUri: 'https://app.fuzefront.com/api/auth/oidc/callback',
    adminToken: 'ff-admin',
    enrollmentFlowSlug: 'fuzefront-enrollment',
    appBaseUrl: 'https://app.fuzefront.com',
  },
  {
    id: 'mendys',
    hosts: ['live.mendysrobotics.com', 'marketplace.mendysrobotics.com'],
    issuerUrl: 'https://live.mendysrobotics.com/application/o/mendys-platform/',
    baseUrl: 'http://authentik-mendys-server:9000',
    clientId: 'mendys-platform-oidc-client',
    clientSecret: 'mendys-secret',
    redirectUri: 'https://live.mendysrobotics.com/api/auth/oidc/callback',
    adminToken: 'mendys-admin',
    enrollmentFlowSlug: 'mendys-enrollment',
    appBaseUrl: 'https://live.mendysrobotics.com',
    googleBrokered: true,
  },
])

describe('legacy (single-tenant) mode', () => {
  it('is the default when SECURITY_TENANTS is unset', () => {
    expect(isMultiTenant()).toBe(false)
    expect(allTenants()).toHaveLength(1)
  })

  it('reproduces the pre-tenancy env configuration exactly', () => {
    process.env.FRONTEND_URL = 'https://app.fuzefront.com'
    process.env.AUTHENTIK_ISSUER_URL = 'https://app.fuzefront.com/application/o/fuzefront/'
    process.env.AUTHENTIK_BASE_URL = 'http://authentik-server:9000'
    process.env.AUTHENTIK_CLIENT_ID = 'fuzefront-oidc-client'
    process.env.AUTHENTIK_CLIENT_SECRET = 'shh'
    process.env.AUTHENTIK_ADMIN_TOKEN = 'admin-token'
    resetTenantRegistryForTests()

    const t = allTenants()[0]
    expect(t.id).toBe('fuzefront')
    expect(t.issuerUrl).toBe('https://app.fuzefront.com/application/o/fuzefront/')
    expect(t.baseUrl).toBe('http://authentik-server:9000')
    expect(t.clientId).toBe('fuzefront-oidc-client')
    expect(t.clientSecret).toBe('shh')
    expect(t.adminToken).toBe('admin-token')
    // Unset -> the same defaults the old process.env reads used.
    expect(t.enrollmentFlowSlug).toBe('fuzefront-enrollment')
    expect(t.googleBrokered).toBe(true)
  })

  it('honours SECURITY_GOOGLE_BROKERED=false exactly as before', () => {
    process.env.SECURITY_GOOGLE_BROKERED = 'false'
    resetTenantRegistryForTests()
    expect(allTenants()[0].googleBrokered).toBe(false)
  })

  it('serves EVERY host, including ones it does not name', () => {
    process.env.FRONTEND_URL = 'https://app.fuzefront.com'
    resetTenantRegistryForTests()
    // Requests legitimately arrive on many hosts in a single-tenant deployment
    // (dev hostnames, localhost, in-cluster service DNS). Failing closed here
    // would break FuzeFront, so legacy mode must not.
    for (const h of ['app.fuzefront.com', 'fuzefront.dev.local', 'localhost', 'security-service']) {
      expect(resolveTenantByHost(h)?.id).toBe('fuzefront')
    }
  })

  it('provides an ambient tenant without middleware', () => {
    expect(currentTenantOrUndefined()).toBeDefined()
    expect(() => currentTenant()).not.toThrow()
  })

  // The functions this registry replaces each read process.env per call, so a
  // late environment change took effect immediately. Memoising legacy mode
  // would silently break that for every existing deployment (and for tests
  // that set env in beforeEach), so it must NOT be cached.
  it('re-reads the environment on every call, with no memoisation', () => {
    process.env.FRONTEND_URL = 'https://first.example.com'
    expect(allTenants()[0].appBaseUrl).toBe('https://first.example.com')

    // Changed AFTER the first read, and deliberately without resetting.
    process.env.FRONTEND_URL = 'https://second.example.com'
    expect(allTenants()[0].appBaseUrl).toBe('https://second.example.com')

    process.env.SECURITY_GOOGLE_BROKERED = 'false'
    expect(allTenants()[0].googleBrokered).toBe(false)
  })
})

describe('multi-tenant mode', () => {
  beforeEach(() => {
    process.env.SECURITY_TENANTS = TWO_TENANTS
    resetTenantRegistryForTests()
  })

  it('routes each declared host to its own tenant', () => {
    expect(resolveTenantByHost('app.fuzefront.com')?.id).toBe('fuzefront')
    expect(resolveTenantByHost('live.mendysrobotics.com')?.id).toBe('mendys')
    expect(resolveTenantByHost('marketplace.mendysrobotics.com')?.id).toBe('mendys')
  })

  it('matches hosts case-insensitively and ignores the port', () => {
    expect(resolveTenantByHost('LIVE.MendysRobotics.com:443')?.id).toBe('mendys')
  })

  // THE central guarantee.
  it('REJECTS an unclaimed host instead of falling back to a default tenant', () => {
    expect(resolveTenantByHost('evil.example.com')).toBeUndefined()
    expect(resolveTenantByHost('')).toBeUndefined()
    expect(resolveTenantByHost(undefined)).toBeUndefined()
    // Specifically: not the first tenant.
    expect(resolveTenantByHost('unknown.host')?.id).not.toBe('fuzefront')
  })

  it('gives each tenant a DIFFERENT Authentik instance', () => {
    const ff = resolveTenantByHost('app.fuzefront.com')!
    const me = resolveTenantByHost('live.mendysrobotics.com')!
    expect(me.baseUrl).not.toBe(ff.baseUrl)
    expect(me.issuerUrl).not.toBe(ff.issuerUrl)
    expect(me.clientId).not.toBe(ff.clientId)
    expect(me.enrollmentFlowSlug).not.toBe(ff.enrollmentFlowSlug)
  })

  it('throws rather than guessing when read outside a tenant context', () => {
    expect(currentTenantOrUndefined()).toBeUndefined()
    expect(() => currentTenant()).toThrow(NoTenantContextError)
  })

  it('binds the ambient tenant inside runWithTenant', () => {
    const me = resolveTenantByHost('live.mendysrobotics.com')!
    runWithTenant(me, () => {
      expect(currentTenant().id).toBe('mendys')
    })
    expect(currentTenantOrUndefined()).toBeUndefined()
  })
})

describe('registry validation at boot', () => {
  const load = (v: unknown) => {
    process.env.SECURITY_TENANTS = typeof v === 'string' ? v : JSON.stringify(v)
    resetTenantRegistryForTests()
    return () => allTenants()
  }

  it('rejects two tenants claiming the same host', () => {
    const dup = JSON.parse(TWO_TENANTS)
    dup[1].hosts = ['app.fuzefront.com']
    expect(load(dup)).toThrow(/claimed by both/)
  })

  it('rejects duplicate tenant ids', () => {
    const dup = JSON.parse(TWO_TENANTS)
    dup[1].id = 'fuzefront'
    expect(load(dup)).toThrow(/duplicate tenant id/)
  })

  it('rejects a tenant with no hosts', () => {
    const bad = JSON.parse(TWO_TENANTS)
    bad[1].hosts = []
    expect(load(bad)).toThrow(/must list at least one host/)
  })

  it('rejects a tenant missing a required field', () => {
    const bad = JSON.parse(TWO_TENANTS)
    delete bad[1].issuerUrl
    expect(load(bad)).toThrow(/"issuerUrl" is required/)
  })

  it('rejects malformed JSON and empty arrays', () => {
    expect(load('{not json')).toThrow(/not valid JSON/)
    expect(load([])).toThrow(/non-empty JSON array/)
  })
})

describe('normaliseHost', () => {
  it.each([
    ['App.FuzeFront.com', 'app.fuzefront.com'],
    ['app.fuzefront.com:8443', 'app.fuzefront.com'],
    ['app.fuzefront.com.', 'app.fuzefront.com'],
    ['[::1]:9000', '::1'],
    ['  APP.fuzefront.com  ', 'app.fuzefront.com'],
    [undefined, ''],
  ])('%s -> %s', (input, expected) => {
    expect(normaliseHost(input as string | undefined)).toBe(expected)
  })
})

describe('cross-tenant session rejection', () => {
  beforeEach(() => {
    process.env.SECURITY_TENANTS = TWO_TENANTS
    resetTenantRegistryForTests()
  })

  const reqFor = (host: string) => ({ identityTenant: resolveTenantByHost(host) }) as never

  it('accepts a session presented to its own tenant', () => {
    expect(assertTenantMatches(reqFor('live.mendysrobotics.com'), 'mendys')).toEqual({ ok: true })
  })

  // THE central guarantee: an account in one silo cannot act in another.
  it('REJECTS a session minted for another tenant', () => {
    const r = assertTenantMatches(reqFor('app.fuzefront.com'), 'mendys')
    expect(r.ok).toBe(false)
    const r2 = assertTenantMatches(reqFor('live.mendysrobotics.com'), 'fuzefront')
    expect(r2.ok).toBe(false)
  })

  it('rejects a claimless token in multi-tenant mode', () => {
    const r = assertTenantMatches(reqFor('live.mendysrobotics.com'), undefined)
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toMatch(/no tenant claim/)
  })

  it('accepts a claimless token in legacy mode (pre-tenancy sessions)', () => {
    delete process.env.SECURITY_TENANTS
    resetTenantRegistryForTests()
    expect(assertTenantMatches(reqFor('anything'), undefined)).toEqual({ ok: true })
  })

  it('rejects when the request has no tenant context at all', () => {
    const r = assertTenantMatches({} as never, 'mendys')
    expect(r.ok).toBe(false)
  })
})
