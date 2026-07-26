/**
 * Unit tests for OIDCService's self-heal resilience.
 *
 * Bug being guarded against: boot-time OIDC init retried a BOUNDED number of
 * times (30 attempts / 5 min); once exhausted with Authentik still down,
 * every subsequent signup/login 401'd with "OIDC is not configured/initialized"
 * for the life of the process — requiring a manual `kubectl rollout restart`.
 * This took prod auth down twice.
 *
 * ensureInitialized() now:
 *  (a) dedupes concurrent callers onto exactly ONE in-flight discovery call
 *      (no stampede against a struggling/recovering Authentik),
 *  (b) lets a LATER request succeed once Authentik recovers, without a
 *      process restart,
 *  (c) respects a cooldown between attempts so a hard-down Authentik isn't
 *      hammered once per request.
 *
 * Each test gets a fresh OIDCService instance (via jest.resetModules() +
 * re-require) so in-flight-promise/cooldown state never leaks between cases.
 */

jest.mock('../src/config/database', () => ({
  db: Object.assign(jest.fn(), { transaction: jest.fn() }),
}))

jest.mock('../src/services/eventPublisher', () => ({
  defaultEventPublisher: {
    publishIdentityUserCreated: jest.fn().mockResolvedValue(undefined),
    publishNotifyEmailRequested: jest.fn().mockResolvedValue(undefined),
  },
}))

/** A minimal fake `Issuer` shape sufficient for `new effectiveIssuer.Client(...)`. */
function fakeIssuer() {
  return {
    metadata: { issuer: 'https://auth.example.com/application/o/fuzefront/' },
    Client: function FakeClient(this: any, cfg: any) {
      Object.assign(this, cfg)
    },
  }
}

/** Mocks `openid-client` with a caller-supplied `Issuer.discover` implementation. */
function mockOpenidClient(discoverImpl: () => Promise<any>) {
  jest.doMock('openid-client', () => ({
    Issuer: { discover: jest.fn(discoverImpl) },
    generators: {
      codeVerifier: jest.fn().mockReturnValue('mock-verifier'),
      codeChallenge: jest.fn().mockReturnValue('mock-challenge'),
      state: jest.fn().mockReturnValue('mock-state'),
    },
    custom: { setHttpOptionsDefaults: jest.fn() },
  }))
}

describe('OIDCService.ensureInitialized — lazy re-init resilience', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = {
      ...ORIGINAL_ENV,
      AUTHENTIK_CLIENT_ID: 'test-client-id',
      AUTHENTIK_CLIENT_SECRET: 'test-client-secret',
    }
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.dontMock('openid-client')
  })

  it('(a) N concurrent requests while uninitialized trigger exactly ONE init attempt', async () => {
    let discoverCalls = 0
    mockOpenidClient(async () => {
      discoverCalls++
      // Simulate a real network round-trip so concurrent callers actually
      // overlap in time (a synchronous resolve wouldn't exercise the race).
      await new Promise(resolve => setTimeout(resolve, 25))
      return fakeIssuer()
    })

    const { oidcService } = require('../src/services/oidc')
    expect(oidcService.isInitialized()).toBe(false)

    const concurrentCallers = Array.from({ length: 8 }, () => oidcService.ensureInitialized())
    await Promise.all(concurrentCallers)

    expect(discoverCalls).toBe(1)
    expect(oidcService.isInitialized()).toBe(true)
  })

  it('(b) fail-then-succeed discovery — a later request succeeds without a restart', async () => {
    let attempt = 0
    mockOpenidClient(async () => {
      attempt++
      if (attempt === 1) {
        throw new Error('discovery unreachable: Authentik down')
      }
      return fakeIssuer()
    })

    process.env.OIDC_INIT_COOLDOWN_MS = '10' // short, so the 2nd attempt below isn't blocked
    const { oidcService } = require('../src/services/oidc')

    // First request lands while Authentik is down — fails, but the process
    // stays up and does NOT permanently latch a "never try again" state.
    await expect(oidcService.ensureInitialized()).rejects.toThrow(
      'discovery unreachable: Authentik down'
    )
    expect(oidcService.isInitialized()).toBe(false)

    // Wait out the (short, test-only) cooldown — this stands in for
    // Authentik recovering some time later with zero code change needed.
    await new Promise(resolve => setTimeout(resolve, 30))

    // A later request (no process restart) now succeeds.
    await expect(oidcService.ensureInitialized()).resolves.toBeUndefined()
    expect(oidcService.isInitialized()).toBe(true)
    expect(attempt).toBe(2)
  })

  it('(c) cooldown prevents per-request hammering of a hard-down Authentik', async () => {
    let discoverCalls = 0
    mockOpenidClient(async () => {
      discoverCalls++
      throw new Error('discovery unreachable')
    })

    process.env.OIDC_INIT_COOLDOWN_MS = '10000' // long cooldown for this case
    const { oidcService } = require('../src/services/oidc')

    await expect(oidcService.ensureInitialized()).rejects.toThrow('discovery unreachable')
    expect(discoverCalls).toBe(1)

    // Three more requests arrive immediately after, still within the cooldown
    // window — none of them should re-invoke discovery.
    await expect(oidcService.ensureInitialized()).rejects.toThrow(
      'OIDC client not initialized'
    )
    await expect(oidcService.ensureInitialized()).rejects.toThrow(
      'OIDC client not initialized'
    )
    await expect(oidcService.ensureInitialized()).rejects.toThrow(
      'OIDC client not initialized'
    )
    expect(discoverCalls).toBe(1)
    expect(oidcService.isInitialized()).toBe(false)
  })

  it('preserves the fail-fast contract: generateAuthUrl still throws while uninitialized', () => {
    mockOpenidClient(async () => fakeIssuer())
    const { oidcService } = require('../src/services/oidc')
    expect(() => oidcService.generateAuthUrl()).toThrow('OIDC client not initialized')
  })
})
