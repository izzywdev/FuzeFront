/**
 * Unit tests for server-side Authentik ENROLLMENT signup
 * (services/authentikPassword.ts → authentikSignup).
 *
 * The enrollment flow-executor conversation and the authorize redirect are
 * simulated by mocking global.fetch — no network. OIDC pieces (authorize URL,
 * token exchange / user sync) are mocked at the oidcService boundary, exactly
 * like the password-login test. The point: signup drives AUTHENTIK enrollment
 * (no local bcrypt user) then completes the SAME OIDC sync as login.
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
      id: 'new-user-1',
      email: 'signup@test.local',
      firstName: 'New',
      lastName: 'User',
      roles: ['user'],
    }),
  },
})
  mod.getOidcService = () => mod.oidcService
  return mod
})

import {
  authentikSignup,
  EnrollmentConflictError,
  UnsupportedFlowStageError,
  InvalidCredentialsError,
} from '../src/services/authentikPassword'
import { getOidcService } from '../src/services/oidc'

/** The mocked client the code under test resolves via getOidcService(). */
const oidcService: any = getOidcService()

const REDIRECT_URI = 'http://fuzefront.test.local/api/auth/oidc/callback'

function mkRes(opts: { status?: number; json?: unknown; setCookies?: string[]; location?: string }) {
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

describe('authentikSignup()', () => {
  const savedEnv = { ...process.env }
  let fetchMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.AUTHENTIK_ISSUER_URL = 'http://auth.example.test/application/o/fuzefront/'
    process.env.AUTHENTIK_REDIRECT_URI = REDIRECT_URI
    delete process.env.AUTHENTIK_BASE_URL
    delete process.env.AUTHENTIK_ENROLLMENT_FLOW_SLUG
    ;(oidcService.isConfigured as jest.Mock).mockReturnValue(true)
    ;(oidcService.isInitialized as jest.Mock).mockReturnValue(true)
    fetchMock = jest.fn()
    ;(global as any).fetch = fetchMock
  })

  afterAll(() => {
    process.env = savedEnv
  })

  it('drives the prompt stage then completes OIDC sync (no local bcrypt user)', async () => {
    fetchMock
      // 1. GET enrollment flow → prompt stage (+ CSRF cookie)
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'ak-stage-prompt' }, setCookies: ['authentik_csrf=csrf-tok; Path=/'] })
      )
      // 2. POST prompt → flow complete (auto user-write + user-login)
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'xak-flow-redirect', to: '/' }, setCookies: ['authentik_session=sess-1; Path=/'] })
      )
      // 3. GET authorize → 302 to our callback with the code
      .mockResolvedValueOnce(mkRes({ status: 302, location: `${REDIRECT_URI}?code=the-code&state=st` }))

    const user = await authentikSignup({ email: 'signup@test.local', password: 'Sup3rSecret!!', name: 'New User' })

    expect(user.email).toBe('signup@test.local')
    expect(oidcService.handleCallback).toHaveBeenCalledWith('the-code', 'st', 'test-code-verifier')

    // The prompt POST carried the enrollment fields + CSRF + hit the enrollment slug.
    const [promptUrl, promptInit] = fetchMock.mock.calls[1]
    expect(promptUrl).toContain('/api/v3/flows/executor/fuzefront-enrollment/')
    const body = JSON.parse(promptInit.body)
    expect(body).toMatchObject({
      component: 'ak-stage-prompt',
      email: 'signup@test.local',
      password: 'Sup3rSecret!!',
      password_repeat: 'Sup3rSecret!!',
    })
    expect(body.username).toBeTruthy()
    // The single `name` is forwarded verbatim to Authentik's single `name` field.
    expect(body.name).toBe('New User')
    expect(promptInit.headers['X-Authentik-CSRF']).toBe('csrf-tok')
  })

  /** Drive a successful signup and return the parsed enrollment-prompt POST body. */
  async function signupPromptBody(input: Parameters<typeof authentikSignup>[0]) {
    fetchMock
      .mockResolvedValueOnce(mkRes({ json: { component: 'ak-stage-prompt' }, setCookies: ['authentik_csrf=csrf-tok; Path=/'] }))
      .mockResolvedValueOnce(mkRes({ json: { component: 'xak-flow-redirect', to: '/' }, setCookies: ['authentik_session=s; Path=/'] }))
      .mockResolvedValueOnce(mkRes({ status: 302, location: `${REDIRECT_URI}?code=the-code&state=st` }))
    await authentikSignup(input)
    return JSON.parse(fetchMock.mock.calls[1][1].body)
  }

  it.each([
    ['a family-name-first name is not reordered', '王 小明'],
    ['a mononym is passed through whole', 'Sukarno'],
    ['an RTL name is passed through whole', 'محمد علي'],
  ])('name mapping: %s', async (_label, name) => {
    const body = await signupPromptBody({ email: 'n@test.local', password: 'Sup3rSecret!!', name })
    expect(body.name).toBe(name)
  })

  it('name mapping: surrounding whitespace is trimmed', async () => {
    const body = await signupPromptBody({ email: 'n@test.local', password: 'Sup3rSecret!!', name: '  Ada Lovelace  ' })
    expect(body.name).toBe('Ada Lovelace')
  })

  it.each([[undefined], [''], ['   ']])('name mapping: an absent/blank name (%j) sends no `name` field', async (name) => {
    const body = await signupPromptBody({ email: 'n@test.local', password: 'Sup3rSecret!!', name: name as string | undefined })
    expect(body).not.toHaveProperty('name')
  })

  it('username: an ASCII-safe local-part is kept verbatim (unchanged from before)', async () => {
    const body = await signupPromptBody({ email: 'jane.doe_1@test.local', password: 'Sup3rSecret!!' })
    expect(body.username).toBe('jane.doe_1')
  })

  it.each([
    ['CJK', '用户@例子.cn'],
    ['Cyrillic', 'мария@пример.рф'],
    ['accented Latin', 'josé@test.local'],
  ])('username: a non-ASCII (%s) local-part is not gutted — the full address is used', async (_l, email) => {
    const body = await signupPromptBody({ email, password: 'Sup3rSecret!!' })
    expect(body.username).toBe(email.normalize('NFC').toLowerCase())
    expect(body.username).not.toBe('')
  })

  it('username: an explicit username still wins', async () => {
    const body = await signupPromptBody({ email: 'x@test.local', password: 'Sup3rSecret!!', username: 'chosen' })
    expect(body.username).toBe('chosen')
  })

  it('maps an "already exists" response_error to EnrollmentConflictError', async () => {
    fetchMock
      .mockResolvedValueOnce(mkRes({ json: { component: 'ak-stage-prompt' } }))
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'ak-stage-prompt', response_errors: { username: [{ string: 'User with this username already exists.', code: 'unique' }] } } })
      )

    await expect(
      authentikSignup({ email: 'dup@test.local', password: 'Sup3rSecret!!' })
    ).rejects.toBeInstanceOf(EnrollmentConflictError)
    expect(oidcService.handleCallback).not.toHaveBeenCalled()
  })

  it('maps a password-policy rejection to InvalidCredentialsError (not a conflict)', async () => {
    fetchMock
      .mockResolvedValueOnce(mkRes({ json: { component: 'ak-stage-prompt' } }))
      .mockResolvedValueOnce(
        mkRes({ json: { component: 'ak-stage-prompt', response_errors: { password: [{ string: 'Password too short', code: 'invalid' }] } } })
      )

    await expect(
      authentikSignup({ email: 'weak@test.local', password: 'x' })
    ).rejects.toBeInstanceOf(InvalidCredentialsError)
  })

  it('fails closed on an unsupported stage (e.g. captcha / email-verify)', async () => {
    fetchMock.mockResolvedValueOnce(mkRes({ json: { component: 'ak-stage-captcha' } }))

    await expect(
      authentikSignup({ email: 'bot@test.local', password: 'Sup3rSecret!!' })
    ).rejects.toBeInstanceOf(UnsupportedFlowStageError)
  })
})
