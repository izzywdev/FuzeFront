/**
 * provision-a2a-clients.test.ts
 *
 * Unit tests for A2A machine-identity provisioning (izzywdev/FuzeFront#364).
 * Verifies that registering an A2A caller creates a client_credentials provider
 * whose scope mapping emits {"repo": <RepoName>, "aud": "a2a"} so its tokens
 * pass the A2A server's standard JWT validation (Option 2 — repo-name JWTs).
 *
 * Authentik is mocked at the axios layer (same pattern as machine-auth.test.ts)
 * so this runs with no live dependencies.
 */

jest.mock('axios', () => {
  const actual = jest.requireActual('axios')
  return {
    ...actual,
    post: jest.fn(),
    get: jest.fn(),
    isAxiosError: actual.isAxiosError,
  }
})

import axios from 'axios'
import {
  registerA2AMachineClient,
  A2A_AUDIENCE,
} from '../src/authentik/provision-a2a-clients'

const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>
const mockedPost = axios.post as jest.MockedFunction<typeof axios.post>

const EMPTY_PAGE = { data: { results: [], pagination: { next: 0 } } }

/**
 * Wires the axios mock for the "all resources are new" happy path, dispatching
 * on URL so tests don't depend on exact call ordering. Returns nothing; assert
 * on the mock calls afterwards.
 */
function wireHappyPath(): void {
  mockedGet.mockImplementation(async (url: string, config?: any) => {
    // Provider detail (readCredentials) — /providers/oauth2/<pk>/
    if (/\/providers\/oauth2\/\d+\/?$/.test(url)) {
      return { data: { client_id: 'a2a-client-id-xyz', client_secret: 's3cr3t-value' } } as any
    }
    // Flow resolution
    if (url.includes('/flows/instances/')) {
      const designation = config?.params?.designation
      if (designation === 'authorization') {
        return { data: { results: [{ slug: 'default-provider-authorization-implicit-consent', pk: 'auth-flow-pk' }] } } as any
      }
      return { data: { results: [{ slug: 'default-provider-invalidation-flow', pk: 'inval-flow-pk' }] } } as any
    }
    // All list endpoints (scope mappings, providers, applications) — empty
    return EMPTY_PAGE as any
  })

  mockedPost.mockImplementation(async (url: string) => {
    if (url.includes('/propertymappings/provider/scope/')) {
      return { data: { pk: 10 } } as any
    }
    if (url.includes('/providers/oauth2/')) {
      return { data: { pk: 20 } } as any
    }
    if (url.includes('/core/applications/')) {
      return { data: { slug: 'a2a-fuzeagent' } } as any
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

describe('registerA2AMachineClient()', () => {
  it('registers a provider and returns credentials + repo/aud', async () => {
    wireHappyPath()

    const result = await registerA2AMachineClient('FuzeAgent')

    expect(result.clientId).toBe('a2a-client-id-xyz')
    expect(result.clientSecret).toBe('s3cr3t-value')
    expect(result.repo).toBe('FuzeAgent')
    expect(result.audience).toBe(A2A_AUDIENCE)
    expect(result.applicationSlug).toBe('a2a-fuzeagent')
  })

  it('attaches a scope mapping whose expression emits repo + a2a audience', async () => {
    wireHappyPath()

    await registerA2AMachineClient('FuzeAgent')

    const scopeCreate = mockedPost.mock.calls.find(([url]) =>
      String(url).includes('/propertymappings/provider/scope/')
    )
    expect(scopeCreate).toBeDefined()
    const body = scopeCreate![1] as any
    expect(body.name).toBe('a2a:fuzeagent')
    expect(body.scope_name).toBe('a2a')
    // Expression is Python/JSON — must carry both claims, correctly quoted.
    expect(body.expression).toBe('return {"repo": "FuzeAgent", "aud": "a2a"}')
  })

  it('creates a client_credentials provider with the scope mapping attached', async () => {
    wireHappyPath()

    await registerA2AMachineClient('FuzeAgent')

    const providerCreate = mockedPost.mock.calls.find(
      ([url]) => String(url).endsWith('/providers/oauth2/')
    )
    expect(providerCreate).toBeDefined()
    const body = providerCreate![1] as any
    expect(body.allowed_grant_types).toEqual(['client_credentials'])
    expect(body.client_type).toBe('confidential')
    expect(body.property_mappings).toEqual([10])
    expect(body.name).toBe('FuzeAgent (a2a)')
  })

  it('JSON-encodes the repo name into the expression (no injection)', async () => {
    wireHappyPath()

    // A hyphenated exec-tier name must still produce a valid, quoted literal.
    await registerA2AMachineClient('Exec-cto')

    const scopeCreate = mockedPost.mock.calls.find(([url]) =>
      String(url).includes('/propertymappings/provider/scope/')
    )
    const body = scopeCreate![1] as any
    expect(body.name).toBe('a2a:exec-cto')
    expect(body.expression).toBe('return {"repo": "Exec-cto", "aud": "a2a"}')
  })

  it('is idempotent — reuses an existing provider without re-creating', async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (/\/providers\/oauth2\/\d+\/?$/.test(url)) {
        return { data: { client_id: 'existing-id', client_secret: 'existing-secret' } } as any
      }
      if (url.includes('/propertymappings/provider/scope/')) {
        return { data: { results: [{ pk: 10, name: 'a2a:fuzeagent' }], pagination: { next: 0 } } } as any
      }
      if (url.includes('/providers/oauth2/')) {
        return { data: { results: [{ pk: 20, name: 'FuzeAgent (a2a)' }], pagination: { next: 0 } } } as any
      }
      if (url.includes('/core/applications/')) {
        return { data: { results: [{ slug: 'a2a-fuzeagent', name: 'FuzeAgent (a2a)' }], pagination: { next: 0 } } } as any
      }
      return EMPTY_PAGE as any
    })

    const result = await registerA2AMachineClient('FuzeAgent')

    expect(result.clientId).toBe('existing-id')
    // Nothing should have been created.
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('rejects an invalid repo name before calling Authentik', async () => {
    await expect(registerA2AMachineClient('bad name!')).rejects.toThrow(/Invalid repo name/)
    expect(mockedGet).not.toHaveBeenCalled()
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('throws when AUTHENTIK_ADMIN_TOKEN is missing', async () => {
    delete process.env.AUTHENTIK_ADMIN_TOKEN
    await expect(registerA2AMachineClient('FuzeAgent')).rejects.toThrow(/AUTHENTIK_ADMIN_TOKEN/)
  })
})
