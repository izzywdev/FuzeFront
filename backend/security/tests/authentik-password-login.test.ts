/**
 * Unit tests for the server-side Authentik password login
 * (services/authentikPassword.ts).
 *
 * The flow-executor conversation and the authorize redirect are simulated by
 * mocking global.fetch — no network. The OIDC pieces (authorize URL, token
 * exchange/user sync) are mocked at the oidcService boundary, mirroring how
 * the redirect flow's tests isolate openid-client.
 */

jest.mock('../src/services/oidc', () => {
  // getOidcService() replaced the former `oidcService` singleton (the client is
  // now resolved per tenant). Expose both, backed by the SAME object, so the
  // assertions below still address what the code under test receives.
  const mod: any = ({
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
})
  mod.getOidcService = () => mod.oidcService
  return mod
})

import {
  authentikPasswordLogin,
  InvalidCredentialsError,
  AuthentikUnavailableError,
  UnsupportedFlowStageError,
} from '../src/services/authentikPassword'
import { getOidcService } from '../src/services/oidc'

/** The mocked client the code under test resolves via getOidcService(). */
const oidcService: any = getOidcService()

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

  it('refuses to follow an off-origin redirect with session cookies', async () => {
    fetchMock.mockResolvedValueOnce(
      mkRes({
        status: 302,
        location: 'http://evil.example.net/steal',
        setCookies: ['authentik_session=sess; Path=/'],
      })
    )

    await expect(
      authentikPasswordLogin('e2e@test.local', 'pw')
    ).rejects.toBeInstanceOf(AuthentikUnavailableError)
    // No request was made to the off-origin host.
    expect(fetchMock).toHaveBeenCalledTimes(1)
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

  it('follows an HTTP 200 "redirect" challenge from the authorize hop (Authentik >=2026.x)', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'ak-stage-identification' } })
      )
      .mockResolvedValueOnce(mkRes({ json: { component: 'ak-stage-password' } }))
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'xak-flow-redirect', to: '/' } })
      )
      // authorize returns HTTP 200 + {"type":"redirect","to":"..."} instead of
      // a 302 with a Location header — the shape Authentik >=2026.x's flow
      // executor uses for the same implicit-consent outcome.
      .mockResolvedValueOnce(
        mkRes({
          status: 200,
          json: { type: 'redirect', to: `${REDIRECT_URI}?code=the-code&state=st` },
        })
      )

    const user = await authentikPasswordLogin('e2e@test.local', 'pw123')

    expect(user.email).toBe('e2e@test.local')
    expect(oidcService.handleCallback).toHaveBeenCalledWith(
      'the-code',
      'st',
      'test-code-verifier'
    )
  })

  it('follows a relative "to" in an HTTP 200 redirect challenge, then a further hop', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'ak-stage-identification' } })
      )
      .mockResolvedValueOnce(mkRes({ json: { component: 'ak-stage-password' } }))
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'xak-flow-redirect', to: '/' } })
      )
      // First authorize hop: 200 redirect challenge with a path-only `to`,
      // resolved against the current (Authentik-origin) hop URL.
      .mockResolvedValueOnce(
        mkRes({
          status: 200,
          json: { type: 'redirect', to: '/if/flow/default-provider-authorization-implicit-consent/' },
        })
      )
      // Second hop lands on the app's own callback with the code.
      .mockResolvedValueOnce(
        mkRes({ status: 302, location: `${REDIRECT_URI}?code=c-relative&state=st` })
      )

    const user = await authentikPasswordLogin('e2e@test.local', 'pw123')

    expect(user.email).toBe('e2e@test.local')
    expect(oidcService.handleCallback).toHaveBeenCalledWith(
      'c-relative',
      'st',
      'test-code-verifier'
    )
    // The relative `to` resolved against the Authentik origin, not off-site.
    const [secondHopUrl] = fetchMock.mock.calls[4]
    expect(secondHopUrl).toBe(
      'http://auth.example.test/if/flow/default-provider-authorization-implicit-consent/'
    )
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

  // ── Whole-request budget ──────────────────────────────────────────────────
  //
  // The per-hop timeout bounds each individual fetch, but a login is a CHAIN.
  // Every hop used to get a FRESH full-length budget, so the server's worst
  // case ran far past the browser's own LOGIN_TIMEOUT_MS — the client aborted
  // first and the user got a bare "timeout of 15000ms exceeded" with no status
  // and no message, while the labelled server-side diagnostics never got to
  // exist. These pin the chain-level bound that makes the server answer first.

  it('abandons the chain with a labelled error once the whole-request budget is spent', async () => {
    process.env.AUTHENTIK_LOGIN_DEADLINE_MS = '150'
    jest.resetModules()
    const { authentikPasswordLogin: login, AuthentikUnavailableError: Unavailable } =
      require('../src/services/authentikPassword')

    // Each hop is individually well under the per-hop cap; it is their SUM
    // that blows the budget. Authentik keeps redirecting inside the flow.
    fetchMock.mockImplementation(
      async () =>
        new Promise(resolve =>
          setTimeout(
            () =>
              resolve(
                mkRes({
                  status: 302,
                  location:
                    'http://auth.example.test/api/v3/flows/executor/default-authentication-flow/?query=',
                })
              ),
            60
          )
        )
    )

    const err = await login('e2e@test.local', 'pw').catch((e: Error) => e)

    expect(err).toBeInstanceOf(Unavailable)
    // The message names the budget and the stage, so prod logs point at the
    // stall instead of the client reporting an anonymous abort.
    expect((err as Error).message).toMatch(/150ms budget before flow\.step/)
    delete process.env.AUTHENTIK_LOGIN_DEADLINE_MS
  })

  it('clamps a hop to the time remaining rather than giving it a fresh full timeout', async () => {
    process.env.AUTHENTIK_LOGIN_DEADLINE_MS = '400'
    process.env.AUTHENTIK_FLOW_TIMEOUT_MS = '10000'
    jest.resetModules()
    const { authentikPasswordLogin: login } = require('../src/services/authentikPassword')

    // First hop burns most of the budget, then a hop hangs forever. Without
    // clamping, the hang would get the full 10s per-hop cap and outlive the
    // browser; with it, the abort fires within what is LEFT of the 400ms.
    fetchMock
      .mockImplementationOnce(
        async () =>
          new Promise(resolve =>
            setTimeout(
              () => resolve(mkRes({ json: { component: 'ak-stage-identification' } })),
              250
            )
          )
      )
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              const e = new Error('aborted')
              e.name = 'AbortError'
              reject(e)
            })
          })
      )

    const started = Date.now()
    await expect(login('e2e@test.local', 'pw')).rejects.toThrow(/timed out/)
    // Comfortably below the 10s per-hop cap — proof the clamp, not the cap, won.
    expect(Date.now() - started).toBeLessThan(3000)

    delete process.env.AUTHENTIK_LOGIN_DEADLINE_MS
    delete process.env.AUTHENTIK_FLOW_TIMEOUT_MS
  })

  it('bounds the token exchange by the remaining budget, not openid-client’s own timeout', async () => {
    // handleCallback is openid-client's stage: OIDC_HTTP_TIMEOUT_MS (15s) per
    // call, twice (token + userinfo). Left alone it outlasts the whole login
    // budget on its own and the browser aborts first again.
    process.env.AUTHENTIK_LOGIN_DEADLINE_MS = '300'
    jest.resetModules()
    const { authentikPasswordLogin: login } = require('../src/services/authentikPassword')
    const { oidcService: oidc } = require('../src/services/oidc')

    oidc.handleCallback.mockReturnValueOnce(new Promise(() => {})) // never settles

    fetchMock
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'ak-stage-identification' } })
      )
      .mockResolvedValueOnce(mkRes({ json: { component: 'ak-stage-password' } }))
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'xak-flow-redirect', to: '/' } })
      )
      .mockResolvedValueOnce(
        mkRes({ status: 302, location: `${REDIRECT_URI}?code=c8&state=st` })
      )

    const started = Date.now()
    await expect(login('e2e@test.local', 'pw')).rejects.toThrow(
      /oidc\.tokenExchange exceeded the remaining/
    )
    // Well inside the browser's 15s bound instead of openid-client's 2x15s.
    expect(Date.now() - started).toBeLessThan(3000)

    delete process.env.AUTHENTIK_LOGIN_DEADLINE_MS
  })

  it('reports a slow hop at WARN, naming the stage, on a login that still succeeds', async () => {
    // The per-hop timings existed only at logger.debug, and LOG_LEVEL defaults
    // to info in prod — so the one piece of evidence needed to find the slow
    // hop was switched off exactly when it mattered. A slow SUCCESS must be
    // visible without a LOG_LEVEL change or a redeploy.
    process.env.AUTHENTIK_SLOW_HOP_WARN_MS = '50'
    jest.resetModules()
    const { authentikPasswordLogin: login } = require('../src/services/authentikPassword')
    const { logger } = require('../src/lib/logger')
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined)

    const slow = (res: Response) =>
      new Promise(resolve => setTimeout(() => resolve(res), 80))

    fetchMock
      .mockImplementationOnce(() =>
        slow(mkRes({ json: { component: 'ak-stage-identification' } }))
      )
      .mockResolvedValueOnce(mkRes({ json: { component: 'ak-stage-password' } }))
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'xak-flow-redirect', to: '/' } })
      )
      .mockResolvedValueOnce(
        mkRes({ status: 302, location: `${REDIRECT_URI}?code=c7&state=st` })
      )

    // The login SUCCEEDS — the warning is the whole point, not an error path.
    await expect(login('e2e@test.local', 'pw')).resolves.toBeDefined()

    const slowHops = warn.mock.calls.filter(
      ([, msg]) => msg === 'authentikPassword: SLOW hop'
    )
    expect(slowHops).toHaveLength(1)
    // Names the exact stage, so prod logs point at the culprit directly.
    expect((slowHops[0][0] as any).label).toMatch(/flow\.step .*hop=0 GET/)
    expect((slowHops[0][0] as any).elapsedMs).toBeGreaterThanOrEqual(50)

    warn.mockRestore()
    delete process.env.AUTHENTIK_SLOW_HOP_WARN_MS
  })

  it('releases the response body of every hop it only reads headers from', async () => {
    // undici keeps the socket checked out until the body is consumed or
    // cancelled. Redirect hops read only `location`, and authorize hops never
    // read a body at all — so an un-cancelled body pins that connection for the
    // rest of the request and later hops queue behind their own predecessors.
    const cancels: string[] = []
    const withBody = (label: string, res: Response) =>
      Object.defineProperty(res, 'body', {
        value: {
          cancel: async () => {
            cancels.push(label)
          },
        },
        configurable: true,
      })

    fetchMock
      // flow hop that only yields a Location
      .mockResolvedValueOnce(
        withBody(
          'flow-redirect',
          mkRes({
            status: 302,
            location:
              'http://auth.example.test/api/v3/flows/executor/default-authentication-flow/?query=',
          })
        )
      )
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'ak-stage-identification' } })
      )
      .mockResolvedValueOnce(mkRes({ json: { component: 'ak-stage-password' } }))
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'xak-flow-redirect', to: '/' } })
      )
      // authorize hop — body never read on any path
      .mockResolvedValueOnce(
        withBody(
          'authorize',
          mkRes({ status: 302, location: `${REDIRECT_URI}?code=c9&state=st` })
        )
      )

    await authentikPasswordLogin('e2e@test.local', 'pw123')

    expect(cancels).toEqual(['flow-redirect', 'authorize'])
  })
})
