/**
 * portal-authentik-brand.test.ts
 *
 * Unit tests for `src/authentik/portalBrand.ts` (FF-EPIC-11-S4 AC2).
 * Authentik is mocked at the axios layer, same pattern as
 * `tests/provision-a2a-clients.test.ts` — no live Authentik dependency.
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
import { createAuthentikBrandRegistrar } from '../src/authentik/portalBrand'

const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>
const mockedPost = axios.post as jest.MockedFunction<typeof axios.post>
const mockedPatch = axios.patch as jest.MockedFunction<typeof axios.patch>

const EMPTY_PAGE = { data: { results: [], pagination: { next: 0 } } }

beforeEach(() => {
  jest.clearAllMocks()
  process.env.AUTHENTIK_ADMIN_TOKEN = 'admin-token'
  process.env.AUTHENTIK_BASE_URL = 'http://authentik.test:9000'
})

afterEach(() => {
  delete process.env.AUTHENTIK_ADMIN_TOKEN
  delete process.env.AUTHENTIK_BASE_URL
})

describe('createAuthentikBrandRegistrar', () => {
  it('returns null when AUTHENTIK_ADMIN_TOKEN is not configured', () => {
    delete process.env.AUTHENTIK_ADMIN_TOKEN
    expect(createAuthentikBrandRegistrar()).toBeNull()
  })

  it('creates a brand for a new domain with default:false and no self-selection as the platform default', async () => {
    mockedGet.mockResolvedValueOnce(EMPTY_PAGE as any)
    mockedPost.mockResolvedValueOnce({ data: { brand_uuid: 'brand-1' } } as any)

    const registrar = createAuthentikBrandRegistrar()!
    await registrar.ensure({
      domain: 'acme.fuzefront.com',
      name: 'Acme Corp',
      accent: '#ff0000',
    })

    expect(mockedPost).toHaveBeenCalledTimes(1)
    const [url, body] = mockedPost.mock.calls[0]
    expect(url).toBe('http://authentik.test:9000/api/v3/core/brands/')
    expect(body).toMatchObject({
      domain: 'acme.fuzefront.com',
      branding_title: 'Acme Corp',
      default: false,
    })
    expect((body as any).branding_custom_css).toContain('#ff0000')
  })

  it('is idempotent — updates the existing brand by domain instead of creating a duplicate', async () => {
    mockedGet.mockResolvedValueOnce({
      data: { results: [{ brand_uuid: 'brand-existing', domain: 'acme.fuzefront.com' }], pagination: { next: 0 } },
    } as any)
    mockedPatch.mockResolvedValueOnce({ data: {} } as any)

    const registrar = createAuthentikBrandRegistrar()!
    await registrar.ensure({ domain: 'acme.fuzefront.com', name: 'Acme Corp Renamed' })

    expect(mockedPost).not.toHaveBeenCalled()
    expect(mockedPatch).toHaveBeenCalledTimes(1)
    const [url, body] = mockedPatch.mock.calls[0]
    expect(url).toBe('http://authentik.test:9000/api/v3/core/brands/brand-existing/')
    expect(body).toMatchObject({ branding_title: 'Acme Corp Renamed', default: false })
  })

  it('omits branding_custom_css when no accent is supplied', async () => {
    mockedGet.mockResolvedValueOnce(EMPTY_PAGE as any)
    mockedPost.mockResolvedValueOnce({ data: { brand_uuid: 'brand-2' } } as any)

    const registrar = createAuthentikBrandRegistrar()!
    await registrar.ensure({ domain: 'plain.fuzefront.com', name: 'Plain Co' })

    const [, body] = mockedPost.mock.calls[0]
    expect((body as any).branding_custom_css).toBeUndefined()
  })

  it('ignores a malformed accent value rather than injecting it unsanitized', async () => {
    mockedGet.mockResolvedValueOnce(EMPTY_PAGE as any)
    mockedPost.mockResolvedValueOnce({ data: { brand_uuid: 'brand-3' } } as any)

    const registrar = createAuthentikBrandRegistrar()!
    await registrar.ensure({
      domain: 'evil.fuzefront.com',
      name: 'Evil Co',
      accent: '</style><script>alert(1)</script>',
    })

    const [, body] = mockedPost.mock.calls[0]
    expect((body as any).branding_custom_css).toBeUndefined()
  })
})
