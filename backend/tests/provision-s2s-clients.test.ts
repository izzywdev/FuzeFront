/**
 * provision-s2s-clients.test.ts
 *
 * Unit tests for the generic platform S2S machine-identity provisioner
 * (izzywdev/FuzeFront#648). Verifies that registering an S2S caller creates a
 * client_credentials provider whose scope mapping emits
 * {"aud": "s2s", "service": <service>, "scopes": [<scopes>]} — the reusable
 * template every future S2S consumer (fuzecall-backend, fuzex-api, …)
 * provisions through.
 *
 * Authentik is mocked at the axios layer (same pattern as
 * provision-a2a-clients.test.ts) so this runs with no live dependencies.
 */

jest.mock('axios', () => {
  const actual = jest.requireActual('axios')
  return {
    ...actual,
    post: jest.fn(),
    get: jest.fn(),
    patch: jest.fn(),
    isAxiosError: actual.isAxiosError,
  }
})

import axios from 'axios'
import {
  registerS2SClient,
  S2S_AUDIENCE,
  DEFAULT_TOKEN_VALIDITY,
} from '../src/authentik/provision-s2s-clients'

const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>
const mockedPost = axios.post as jest.MockedFunction<typeof axios.post>
const mockedPatch = axios.patch as jest.MockedFunction<typeof axios.patch>

const EMPTY_PAGE = { data: { results: [], pagination: { next: 0 } } }

function wireHappyPath(): void {
  mockedGet.mockImplementation(async (url: string, config?: any) => {
    if (/\/providers\/oauth2\/\d+\/?$/.test(url)) {
      return { data: { client_id: 's2s-client-id-xyz', client_secret: 's3cr3t-value' } } as any
    }
    if (url.includes('/flows/instances/')) {
      const designation = config?.params?.designation
      if (designation === 'authorization') {
        return { data: { results: [{ slug: 'default-provider-authorization-implicit-consent', pk: 'auth-flow-pk' }] } } as any
      }
      return { data: { results: [{ slug: 'default-provider-invalidation-flow', pk: 'inval-flow-pk' }] } } as any
    }
    return EMPTY_PAGE as any
  })

  let nextMappingPk = 10
  mockedPost.mockImplementation(async (url: string) => {
    if (url.includes('/propertymappings/provider/scope/')) {
      return { data: { pk: nextMappingPk++ } } as any
    }
    if (url.includes('/providers/oauth2/')) {
      return { data: { pk: 20 } } as any
    }
    if (url.includes('/core/applications/')) {
      return { data: { slug: 's2s-fuzecall-backend' } } as any
    }
    throw new Error(`unexpected POST ${url}`)
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.AUTHENTIK_ADMIN_TOKEN = 'admin-token'
  process.env.AUTHENTIK_BASE_URL = 'http://authentik.test:9000'
})

afterEach(() => {
  delete process.env.AUTHENTIK_ADMIN_TOKEN
  delete process.env.AUTHENTIK_BASE_URL
})

describe('registerS2SClient()', () => {
  it('registers a provider and returns credentials + service/audience/scopes', async () => {
    wireHappyPath()

    const result = await registerS2SClient('fuzecall-backend', ['fuzecall:control-plane:auth'])

    expect(result.clientId).toBe('s2s-client-id-xyz')
    expect(result.clientSecret).toBe('s3cr3t-value')
    expect(result.service).toBe('fuzecall-backend')
    expect(result.audience).toBe(S2S_AUDIENCE)
    expect(result.scopes).toEqual(['fuzecall:control-plane:auth'])
    expect(result.applicationSlug).toBe('s2s-fuzecall-backend')
  })

  it('attaches a scope mapping whose expression emits aud + service + scopes', async () => {
    wireHappyPath()

    await registerS2SClient('fuzecall-backend', ['fuzecall:control-plane:auth', 'fuzecall:jobs:read'])

    const scopeCreate = mockedPost.mock.calls.find(([url]) =>
      String(url).includes('/propertymappings/provider/scope/')
    )
    expect(scopeCreate).toBeDefined()
    const body = scopeCreate![1] as any
    expect(body.name).toBe('s2s:fuzecall-backend')
    expect(body.scope_name).toBe('s2s')
    expect(body.expression).toBe(
      'return {"aud": "s2s", "service": "fuzecall-backend", "scopes": ["fuzecall:control-plane:auth","fuzecall:jobs:read"]}'
    )
  })

  it('creates a client_credentials provider with the scope mapping attached and the default token validity', async () => {
    wireHappyPath()

    await registerS2SClient('fuzex-api', ['fuzex:frames:write'])

    const providerCreate = mockedPost.mock.calls.find(
      ([url]) => String(url).endsWith('/providers/oauth2/')
    )
    expect(providerCreate).toBeDefined()
    const body = providerCreate![1] as any
    expect(body.allowed_grant_types).toEqual(['client_credentials'])
    expect(body.client_type).toBe('confidential')
    // [claim mapping, per-scope grant mapping] — in that order.
    expect(body.property_mappings).toEqual([10, 11])
    expect(body.redirect_uris).toEqual([])
    expect(body.name).toBe('fuzex-api (s2s)')
    expect(body.token_validity).toBe(DEFAULT_TOKEN_VALIDITY)
  })

  it('honors a caller-supplied token validity override', async () => {
    wireHappyPath()

    await registerS2SClient('fuzex-api', ['fuzex:frames:write'], { tokenValidity: 'minutes=30' })

    const providerCreate = mockedPost.mock.calls.find(
      ([url]) => String(url).endsWith('/providers/oauth2/')
    )
    const body = providerCreate![1] as any
    expect(body.token_validity).toBe('minutes=30')
  })

  it('is idempotent — reuses existing resources without re-creating', async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (/\/providers\/oauth2\/\d+\/?$/.test(url)) {
        return { data: { client_id: 'existing-id', client_secret: 'existing-secret' } } as any
      }
      if (url.includes('/propertymappings/provider/scope/')) {
        return { data: { results: [
          { pk: 10, name: 's2s:fuzecall-backend' },
          { pk: 11, name: 's2s-scope:fuzecall:control-plane:auth' },
        ], pagination: { next: 0 } } } as any
      }
      if (url.includes('/providers/oauth2/')) {
        return { data: { results: [{ pk: 20, name: 'fuzecall-backend (s2s)', property_mappings: [10, 11] }], pagination: { next: 0 } } } as any
      }
      if (url.includes('/core/applications/')) {
        return { data: { results: [{ slug: 's2s-fuzecall-backend', name: 'fuzecall-backend (s2s)' }], pagination: { next: 0 } } } as any
      }
      return EMPTY_PAGE as any
    })

    const result = await registerS2SClient('fuzecall-backend', ['fuzecall:control-plane:auth'])

    expect(result.clientId).toBe('existing-id')
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('rejects an invalid service name before calling Authentik', async () => {
    await expect(registerS2SClient('Not A Valid Name!', ['x'])).rejects.toThrow(/Invalid service name/)
    expect(mockedGet).not.toHaveBeenCalled()
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('rejects an empty scope list before calling Authentik', async () => {
    await expect(registerS2SClient('fuzecall-backend', [])).rejects.toThrow(/At least one scope/)
    expect(mockedGet).not.toHaveBeenCalled()
  })

  it('rejects a malformed scope before calling Authentik', async () => {
    await expect(registerS2SClient('fuzecall-backend', ['has a space'])).rejects.toThrow(/Invalid scope/)
    expect(mockedGet).not.toHaveBeenCalled()
  })

  it('JSON-encodes service and scopes into the expression (no injection)', async () => {
    wireHappyPath()

    await registerS2SClient('fuzex-api', ['fuzex:frames:write'])

    const scopeCreate = mockedPost.mock.calls.find(([url]) =>
      String(url).includes('/propertymappings/provider/scope/')
    )
    const body = scopeCreate![1] as any
    expect(body.expression).toBe(
      'return {"aud": "s2s", "service": "fuzex-api", "scopes": ["fuzex:frames:write"]}'
    )
  })

  it('registers each requested scope as a grantable OAuth2 scope (scope_name = the scope)', async () => {
    wireHappyPath()

    await registerS2SClient('selection-list-service', ['authz:admin'])

    const mappingCreates = mockedPost.mock.calls
      .filter(([url]) => String(url).includes('/propertymappings/provider/scope/'))
      .map(([, body]) => body as any)
    // The introspected `scope` field (what the Security API's authz:admin gate
    // reads) can only contain a scope Authentik is willing to grant, i.e. one
    // that is some attached mapping's scope_name. The custom `scopes` claim
    // from the s2s mapping does not count.
    const grant = mappingCreates.find(b => b.scope_name === 'authz:admin')
    expect(grant).toBeDefined()
    expect(grant.name).toBe('s2s-scope:authz:admin')
    expect(grant.expression).toBe('return {}')
  })

  it('creates one grant mapping per scope and attaches all of them to the provider', async () => {
    wireHappyPath()

    await registerS2SClient('fuzecall-backend', ['fuzecall:jobs:read', 'authz:admin'])

    const names = mockedPost.mock.calls
      .filter(([url]) => String(url).includes('/propertymappings/provider/scope/'))
      .map(([, body]) => (body as any).scope_name)
    expect(names).toEqual(['s2s', 'fuzecall:jobs:read', 'authz:admin'])
    const providerCreate = mockedPost.mock.calls.find(([url]) => String(url).endsWith('/providers/oauth2/'))
    expect((providerCreate![1] as any).property_mappings).toEqual([10, 11, 12])
  })

  describe('reconciling an EXISTING provider', () => {
    // Authentik returns mapping pks as UUID strings; model that, plus the
    // pre-fix shape (only the s2s claim mapping attached).
    function wireExisting(attachedMappings: string[]): void {
      mockedGet.mockImplementation(async (url: string) => {
        if (/\/providers\/oauth2\/\d+\/?$/.test(url)) {
          return { data: { client_id: 'existing-id', client_secret: 'existing-secret' } } as any
        }
        if (url.includes('/propertymappings/provider/scope/')) {
          return {
            data: {
              results: [
                { pk: 'uuid-claim', name: 's2s:billing-service' },
                { pk: 'uuid-authz', name: 's2s-scope:authz:admin' },
              ],
              pagination: { next: 0 },
            },
          } as any
        }
        if (url.includes('/providers/oauth2/')) {
          return {
            data: {
              results: [{ pk: 20, name: 'billing-service (s2s)', property_mappings: attachedMappings }],
              pagination: { next: 0 },
            },
          } as any
        }
        if (url.includes('/core/applications/')) {
          return { data: { results: [{ slug: 's2s-billing-service', name: 'billing-service (s2s)' }], pagination: { next: 0 } } } as any
        }
        return EMPTY_PAGE as any
      })
    }

    it('adds the missing per-scope mapping to a provider registered before it existed, keeping what it had', async () => {
      wireExisting(['uuid-claim'])

      const result = await registerS2SClient('billing-service', ['authz:admin'])

      expect(mockedPatch).toHaveBeenCalledTimes(1)
      const [url, body] = mockedPatch.mock.calls[0] as [string, any, any]
      expect(url).toMatch(/\/api\/v3\/providers\/oauth2\/20\/$/)
      expect(body).toEqual({ property_mappings: ['uuid-claim', 'uuid-authz'] })
      // Credentials are read back, never regenerated.
      expect(result.clientId).toBe('existing-id')
      expect(result.clientSecret).toBe('existing-secret')
      expect(mockedPost).not.toHaveBeenCalled()
    })

    it('does not write when the provider already has every mapping (idempotent, no churn)', async () => {
      wireExisting(['uuid-claim', 'uuid-authz'])

      await registerS2SClient('billing-service', ['authz:admin'])

      expect(mockedPatch).not.toHaveBeenCalled()
      expect(mockedPost).not.toHaveBeenCalled()
    })
  })

  it('throws when AUTHENTIK_ADMIN_TOKEN is missing', async () => {
    delete process.env.AUTHENTIK_ADMIN_TOKEN
    await expect(registerS2SClient('fuzecall-backend', ['x'])).rejects.toThrow(/AUTHENTIK_ADMIN_TOKEN/)
  })
})
