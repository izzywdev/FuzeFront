/**
 * authentik-redirect-registrar.test.ts
 *
 * Unit tests for `src/custom-domains/authentikRedirect.ts`, the module FF-EPIC-11
 * S4's `authentik_redirect_register` provisioning step reuses verbatim. No
 * tests previously existed for it; these cover the multi-domain correctness
 * (FF-EPIC-11-S4 AC3) and idempotent-registration behavior the provisioning
 * step depends on. Authentik is mocked at the axios layer, same pattern as
 * `tests/provision-a2a-clients.test.ts`.
 */

jest.mock('axios', () => {
  const actual = jest.requireActual('axios')
  return {
    ...actual,
    post: jest.fn(),
    patch: jest.fn(),
    get: jest.fn(),
    isAxiosError: actual.isAxiosError,
  }
})

import axios from 'axios'
import { createAuthentikRedirectRegistrar, callbackUri } from '../src/custom-domains/authentikRedirect'

const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>
const mockedPatch = axios.patch as jest.MockedFunction<typeof axios.patch>

const PROVIDER_PK = 42

beforeEach(() => {
  jest.clearAllMocks()
  process.env.AUTHENTIK_ADMIN_TOKEN = 'admin-token'
  process.env.AUTHENTIK_BASE_URL = 'http://authentik.test:9000'
})

afterEach(() => {
  delete process.env.AUTHENTIK_ADMIN_TOKEN
  delete process.env.AUTHENTIK_BASE_URL
})

/** Wires GET so `loadProvider()` always sees the CURRENT `redirectUris` set. */
function wireProvider(redirectUris: Array<{ matching_mode: string; url: string }>): void {
  mockedGet.mockImplementation(async (url: string) => {
    if (url.includes('/providers/oauth2/')) {
      return {
        data: {
          results: [{ pk: PROVIDER_PK, name: 'FuzeFront', redirect_uris: redirectUris }],
          pagination: { next: 0 },
        },
      } as any
    }
    return { data: { results: [], pagination: { next: 0 } } } as any
  })
}

describe('createAuthentikRedirectRegistrar', () => {
  it('returns null when AUTHENTIK_ADMIN_TOKEN is not configured', () => {
    delete process.env.AUTHENTIK_ADMIN_TOKEN
    expect(createAuthentikRedirectRegistrar()).toBeNull()
  })

  it('AC3 — registers a distinct, correct redirect URI for each of several domains, none clobbering another', async () => {
    // Simulated provider state, updated after each PATCH so successive
    // register() calls see the accumulated list — same read-modify-write
    // contract the real Authentik Admin API has.
    let state: Array<{ matching_mode: string; url: string }> = []
    wireProvider(state)
    mockedGet.mockImplementation(async () => ({
      data: { results: [{ pk: PROVIDER_PK, name: 'FuzeFront', redirect_uris: state }], pagination: { next: 0 } },
    } as any))
    mockedPatch.mockImplementation(async (_url: string, body: any) => {
      state = body.redirect_uris
      return { data: {} } as any
    })

    const registrar = createAuthentikRedirectRegistrar()!
    await registrar.register('acme.fuzefront.com')
    await registrar.register('custom.acmecorp.example.com')

    expect(mockedPatch).toHaveBeenCalledTimes(2)
    expect(state).toEqual(
      expect.arrayContaining([
        { matching_mode: 'strict', url: callbackUri('acme.fuzefront.com') },
        { matching_mode: 'strict', url: callbackUri('custom.acmecorp.example.com') },
      ])
    )
    expect(state).toHaveLength(2)
    // No cross-domain mismatch: each URI carries exactly its own domain.
    expect(callbackUri('acme.fuzefront.com')).not.toBe(callbackUri('custom.acmecorp.example.com'))
  })

  it('idempotent — re-registering the same URI issues no PATCH (a genuine no-op)', async () => {
    const existing = [{ matching_mode: 'strict', url: callbackUri('acme.fuzefront.com') }]
    wireProvider(existing)

    const registrar = createAuthentikRedirectRegistrar()!
    await registrar.register('acme.fuzefront.com')

    expect(mockedPatch).not.toHaveBeenCalled()
  })

  it('preserves existing entries (e.g. the static apex host) when adding a new one', async () => {
    let state = [{ matching_mode: 'strict', url: 'https://app.fuzefront.com/api/auth/oidc/callback' }]
    mockedGet.mockImplementation(async () => ({
      data: { results: [{ pk: PROVIDER_PK, name: 'FuzeFront', redirect_uris: state }], pagination: { next: 0 } },
    } as any))
    mockedPatch.mockImplementation(async (_url: string, body: any) => {
      state = body.redirect_uris
      return { data: {} } as any
    })

    const registrar = createAuthentikRedirectRegistrar()!
    await registrar.register('acme.fuzefront.com')

    expect(state).toEqual(
      expect.arrayContaining([
        { matching_mode: 'strict', url: 'https://app.fuzefront.com/api/auth/oidc/callback' },
        { matching_mode: 'strict', url: callbackUri('acme.fuzefront.com') },
      ])
    )
    expect(state).toHaveLength(2)
  })
})
