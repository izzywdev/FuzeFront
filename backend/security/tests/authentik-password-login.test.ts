/**
 * Unit tests for the server-side Authentik password login
 * (services/authentikPassword.ts).
 *
 * The flow-executor conversation and the authorize redirect are simulated by
 * mocking global.fetch — no network. The OIDC pieces (authorize URL, token
 * exchange/user sync) are mocked at the oidcService boundary, mirroring how
 * the redirect flow's tests isolate openid-client.
 */

jest.mock('../src/services/oidc', () => ({
  oidcService: {
    isConfigured: jest.fn().mockReturnValue(true),
    isInitialized: jest.fn().mockReturnValue(true),
    generateAuthUrl: jest.fn().mockReturnValue({
      url: 'http://auth.example.test/application/o/authorize/?client_id=x&state=st',
      codeVerifier: 'test-code-verifier',
    }),
    handleCallback: jest.fn().mockResolvedValue({
      id: 'user-1',
      email: 'e2e@test.local',
      firstName: 'E2E',
      lastName: 'User',
      roles: ['user'],
    }),
  },
}))

import {
  authentikPasswordLogin,
  InvalidCredentialsError,
  AuthentikUnavailableError,
  UnsupportedFlowStageError,
} from '../src/services/authentikPassword'
import { oidcService } from '../src/services/oidc'

const REDIRECT_URI = 'http://fuzefront.test.local/api/auth/oidc/callback'

/** Build a minimal fetch Response stand-in. */
function mkRes(opts: {
  status?: number
  json?: unknown
  setCookies?: string[]
  location?: string
}) {
  const headerMap = new Map<string, string>()
  if (opts.location) headerMap.set('location', opts.location)
  if (opts.json !== undefined) headerMap.set('content-type', 'application/json')
  return {
    ok: (opts.status ?? 200) >= 200 && (opts.status ?? 200) < 300,
    status: opts.status ?? 200,
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
      getSetCookie: () => opts.setCookies ?? [],
    },
    json: async () => opts.json ?? {},
    text: async () => JSON.stringify(opts.json ?? ''),
  } as unknown as Response
}

describe('authentikPasswordLogin()', () => {
  const savedEnv = { ...process.env }
  let fetchMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.AUTHENTIK_ISSUER_URL =
      'http://auth.example.test/application/o/fuzefront/'
    process.env.AUTHENTIK_REDIRECT_URI = REDIRECT_URI
    delete process.env.AUTHENTIK_BASE_URL
    delete process.env.AUTHENTIK_AUTH_FLOW_SLUG
    ;(oidcService.isConfigured as jest.Mock).mockReturnValue(true)
    ;(oidcService.isInitialized as jest.Mock).mockReturnValue(true)
    fetchMock = jest.fn()
    ;(global as any).fetch = fetchMock
  })

  afterAll(() => {
    process.env = savedEnv
  })

  it('drives identification → password → redirect, then exchanges the authorize code', async () => {
    fetchMock
      // 1. GET flow → identification stage (+ CSRF cookie)
      .mockResolvedValueOnce(
        mkRes({
          json: { component: 'ak-stage-identification', password_fields: false },
          setCookies: ['authentik_csrf=csrf-tok; Path=/'],
        })
      )
      // 2. POST identification → password stage
      .mockResolvedValueOnce(mkRes({ json: { component: 'ak-stage-password' } }))
      // 3. POST password → flow complete (+ session cookie)
      .mockResolvedValueOnce(
        mkRes({
          json: { component: 'xak-flow-redirect', to: '/' },
          setCookies: ['authentik_session=sess-1; Path=/; HttpOnly'],
        })
      )
      // 4. GET authorize → 302 straight to our callback with the code
      .mockResolvedValueOnce(
        mkRes({
          status: 302,
          location: `${REDIRECT_URI}?code=the-code&state=st`,
        })
      )

    const user = await authentikPasswordLogin('e2e@test.local', 'pw123')

    expect(user.email).toBe('e2e@test.local')
    expect(oidcService.handleCallback).toHaveBeenCalledWith(
      'the-code',
      'st',
      'test-code-verifier'
    )

    // Identification POST carried the uid_field + CSRF header + cookie jar.
    const [, identInit] = fetchMock.mock.calls[1]
    expect(JSON.parse(identInit.body)).toMatchObject({
      component: 'ak-stage-identification',
      uid_field: 'e2e@test.local',
    })
    expect(identInit.headers['X-CSRFToken']).toBe('csrf-tok')

    // Authorize GET presented the authenticated session cookie.
    const [authorizeUrl, authorizeInit] = fetchMock.mock.calls[3]
    expect(authorizeUrl).toContain('/application/o/authorize/')
    expect(authorizeInit.headers.Cookie).toContain('authentik_session=sess-1')
  })

  it('follows the session-establishing 302 before the first challenge', async () => {
    fetchMock
      // initial GET -> 302 back into the flow, setting session + csrf cookies
      .mockResolvedValueOnce(
        mkRes({
          status: 302,
          location:
            'http://auth.example.test/api/v3/flows/executor/default-authentication-flow/?query=',
          setCookies: [
            'authentik_session=pre-sess; Path=/',
            'authentik_csrf=csrf-tok; Path=/',
          ],
        })
      )
      // redirected GET -> identification challenge
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'ak-stage-identification' } })
      )
      .mockResolvedValueOnce(mkRes({ json: { component: 'ak-stage-password' } }))
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'xak-flow-redirect', to: '/' } })
      )
      .mockResolvedValueOnce(
        mkRes({ status: 302, location: `${REDIRECT_URI}?code=c3&state=st` })
      )

    const user = await authentikPasswordLogin('e2e@test.local', 'pw123')
    expect(user.email).toBe('e2e@test.local')

    // The identification POST happened AFTER the redirect hop, with cookies.
    const [identUrl, identInit] = fetchMock.mock.calls[2]
    expect(identUrl).toContain('/flows/executor/')
    expect(identInit.headers.Cookie).toContain('authentik_session=pre-sess')
    expect(identInit.headers['X-CSRFToken']).toBe('csrf-tok')
  })

  it('supports a combined identification+password stage (password_fields: true)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mkRes({
          json: { component: 'ak-stage-identification', password_fields: true },
        })
      )
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'xak-flow-redirect', to: '/' } })
      )
      .mockResolvedValueOnce(
        mkRes({ status: 302, location: `${REDIRECT_URI}?code=c2&state=st` })
      )

    await authentikPasswordLogin('e2e@test.local', 'pw123')

    const [, identInit] = fetchMock.mock.calls[1]
    expect(JSON.parse(identInit.body)).toMatchObject({
      uid_field: 'e2e@test.local',
      password: 'pw123',
    })
  })

  it('throws InvalidCredentialsError when the password stage reports response_errors', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'ak-stage-identification' } })
      )
      .mockResolvedValueOnce(mkRes({ json: { component: 'ak-stage-password' } }))
      .mockResolvedValueOnce(
        mkRes({
          json: {
            component: 'ak-stage-password',
            response_errors: {
              password: [{ string: 'Invalid password', code: 'invalid' }],
            },
          },
        })
      )

    await expect(
      authentikPasswordLogin('e2e@test.local', 'wrong')
    ).rejects.toBeInstanceOf(InvalidCredentialsError)
    expect(oidcService.handleCallback).not.toHaveBeenCalled()
  })

  it('maps a 4xx JSON flow response carrying response_errors to InvalidCredentialsError', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'ak-stage-identification' } })
      )
      .mockResolvedValueOnce(mkRes({ json: { component: 'ak-stage-password' } }))
      // Authentik rejects the credentials with an HTTP 400 + JSON errors body
      .mockResolvedValueOnce(
        mkRes({
          status: 400,
          json: {
            component: 'ak-stage-password',
            response_errors: {
              password: [{ string: 'Invalid password', code: 'invalid' }],
            },
          },
        })
      )

    await expect(
      authentikPasswordLogin('e2e@test.local', 'wrong')
    ).rejects.toBeInstanceOf(InvalidCredentialsError)
  })

  it('throws InvalidCredentialsError on an access-denied stage', async () => {
    fetchMock.mockResolvedValueOnce(
      mkRes({ json: { component: 'ak-stage-access-denied' } })
    )

    await expect(
      authentikPasswordLogin('nobody@test.local', 'pw')
    ).rejects.toBeInstanceOf(InvalidCredentialsError)
  })

  it('fails closed on stages it cannot drive (e.g. MFA)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'ak-stage-identification' } })
      )
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'ak-stage-authenticator-validate' } })
      )

    await expect(
      authentikPasswordLogin('mfa@test.local', 'pw')
    ).rejects.toBeInstanceOf(UnsupportedFlowStageError)
  })

  it('throws AuthentikUnavailableError when Authentik is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    await expect(
      authentikPasswordLogin('e2e@test.local', 'pw')
    ).rejects.toBeInstanceOf(AuthentikUnavailableError)
  })

  it('throws AuthentikUnavailableError when OIDC is not initialized', async () => {
    ;(oidcService.isInitialized as jest.Mock).mockReturnValue(false)

    await expect(
      authentikPasswordLogin('e2e@test.local', 'pw')
    ).rejects.toBeInstanceOf(AuthentikUnavailableError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails when authorize renders a flow UI instead of redirecting (consent required)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'ak-stage-identification' } })
      )
      .mockResolvedValueOnce(mkRes({ json: { component: 'ak-stage-password' } }))
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'xak-flow-redirect', to: '/' } })
      )
      // authorize returns 200 HTML (no Location) — consent flow not implicit
      .mockResolvedValueOnce(mkRes({ status: 200 }))

    await expect(
      authentikPasswordLogin('e2e@test.local', 'pw')
    ).rejects.toBeInstanceOf(UnsupportedFlowStageError)
  })
})
