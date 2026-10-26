/**
 * Unit tests for services/turnstile.ts.
 *
 * Cloudflare is NOT contacted: global.fetch is stubbed with a fake `siteverify`
 * that mimics Cloudflare's documented dummy-key behaviour (secret `1x…` always
 * passes, `2x…` always fails — https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
 * No live Cloudflare call was made; the real endpoint wire format is covered
 * only to the extent the stub mirrors the documented request/response shape.
 */
import {
  CaptchaRejectedError,
  CaptchaUnavailableError,
  TURNSTILE_VERIFY_URL,
  getCaptchaConfig,
  publicCaptchaMethod,
  verifyTurnstileToken,
} from '../src/services/turnstile'

// Cloudflare's published dummy keys — public test fixtures, not secrets.
const TEST_SITE_KEY = '1x00000000000000000000AA'
const TEST_SECRET_PASS = '1x0000000000000000000000000000000AA'
const TEST_SECRET_FAIL = '2x0000000000000000000000000000000AA'
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'

function fakeSiteverify(): jest.Mock {
  return jest.fn(async (_url: string, init: { body: string }) => {
    const params = new URLSearchParams(init.body)
    const ok = (params.get('secret') ?? '').startsWith('1x')
    return {
      ok: true,
      status: 200,
      json: async () =>
        ok ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] },
    } as unknown as Response
  })
}

function captureLog() {
  const lines: string[] = []
  const rec = (level: string) => (o: object, m?: string) => lines.push(JSON.stringify({ level, ...o, m }))
  return {
    lines,
    log: { debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error') },
  }
}

describe('turnstile', () => {
  const saved = { ...process.env }
  const realFetch = global.fetch
  let fetchMock: jest.Mock

  beforeEach(() => {
    process.env.TURNSTILE_SITE_KEY = TEST_SITE_KEY
    process.env.TURNSTILE_SECRET_KEY = TEST_SECRET_PASS
    fetchMock = fakeSiteverify()
    ;(global as any).fetch = fetchMock
  })
  afterEach(() => {
    process.env = { ...saved }
    ;(global as any).fetch = realFetch
  })

  describe('configuration', () => {
    it('is configured only when BOTH site key and secret are set', () => {
      expect(getCaptchaConfig()).toMatchObject({ provider: 'turnstile', siteKey: TEST_SITE_KEY })
      delete process.env.TURNSTILE_SECRET_KEY
      expect(getCaptchaConfig()).toBeNull()
      process.env.TURNSTILE_SECRET_KEY = TEST_SECRET_PASS
      delete process.env.TURNSTILE_SITE_KEY
      expect(getCaptchaConfig()).toBeNull()
    })

    it('blank values are not configured', () => {
      process.env.TURNSTILE_SITE_KEY = '   '
      expect(getCaptchaConfig()).toBeNull()
    })

    it('the public projection never carries the secret', () => {
      const pub = publicCaptchaMethod()
      expect(pub).toEqual({ provider: 'turnstile', siteKey: TEST_SITE_KEY })
      expect(JSON.stringify(pub)).not.toContain(TEST_SECRET_PASS)
    })

    it('public projection is null when not configured (captcha absent from /methods)', () => {
      delete process.env.TURNSTILE_SITE_KEY
      delete process.env.TURNSTILE_SECRET_KEY
      expect(publicCaptchaMethod()).toBeNull()
    })
  })

  describe('verifyTurnstileToken', () => {
    it('passes with the Cloudflare test (always-pass) secret', async () => {
      await expect(verifyTurnstileToken(DUMMY_TOKEN, { remoteIp: '203.0.113.9' })).resolves.toBeUndefined()
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(TURNSTILE_VERIFY_URL)
      expect(init.method).toBe('POST')
      const sent = new URLSearchParams(init.body)
      expect(sent.get('secret')).toBe(TEST_SECRET_PASS)
      expect(sent.get('response')).toBe(DUMMY_TOKEN)
      expect(sent.get('remoteip')).toBe('203.0.113.9')
    })

    it('rejects with the Cloudflare test (always-fail) secret', async () => {
      process.env.TURNSTILE_SECRET_KEY = TEST_SECRET_FAIL
      await expect(verifyTurnstileToken(DUMMY_TOKEN)).rejects.toBeInstanceOf(CaptchaRejectedError)
    })

    it.each([[undefined], [null], [''], [42], ['x'.repeat(2049)]])(
      'rejects a missing/malformed token (%j) WITHOUT calling Cloudflare',
      async (token) => {
        await expect(verifyTurnstileToken(token)).rejects.toBeInstanceOf(CaptchaRejectedError)
        expect(fetchMock).not.toHaveBeenCalled()
      }
    )

    it('Cloudflare non-2xx -> CaptchaUnavailableError (fail closed, retryable)', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) } as unknown as Response)
      await expect(verifyTurnstileToken(DUMMY_TOKEN)).rejects.toBeInstanceOf(CaptchaUnavailableError)
    })

    it('transport failure / timeout -> CaptchaUnavailableError', async () => {
      fetchMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
      await expect(verifyTurnstileToken(DUMMY_TOKEN)).rejects.toBeInstanceOf(CaptchaUnavailableError)
    })

    it('unparseable response body -> CaptchaUnavailableError', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('bad json')
        },
      } as unknown as Response)
      await expect(verifyTurnstileToken(DUMMY_TOKEN)).rejects.toBeInstanceOf(CaptchaUnavailableError)
    })

    it('a 2xx body without success:true is a rejection, not a pass', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) } as unknown as Response)
      await expect(verifyTurnstileToken(DUMMY_TOKEN)).rejects.toBeInstanceOf(CaptchaRejectedError)
    })

    it('called while NOT configured fails closed (the route must gate on getCaptchaConfig)', async () => {
      delete process.env.TURNSTILE_SECRET_KEY
      await expect(verifyTurnstileToken(DUMMY_TOKEN)).rejects.toBeInstanceOf(CaptchaUnavailableError)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('NEVER logs the token or the secret (success, reject, and failure paths)', async () => {
      const { lines, log } = captureLog()
      await verifyTurnstileToken(DUMMY_TOKEN, { log })
      process.env.TURNSTILE_SECRET_KEY = TEST_SECRET_FAIL
      await verifyTurnstileToken(DUMMY_TOKEN, { log }).catch(() => undefined)
      fetchMock.mockRejectedValueOnce(new Error('boom'))
      await verifyTurnstileToken(DUMMY_TOKEN, { log }).catch(() => undefined)
      const all = lines.join('\n')
      expect(all.length).toBeGreaterThan(0)
      expect(all).not.toContain(DUMMY_TOKEN)
      expect(all).not.toContain(TEST_SECRET_PASS)
      expect(all).not.toContain(TEST_SECRET_FAIL)
    })

    it('logs boundary start/end with elapsedMs on the Cloudflare call', async () => {
      const { lines, log } = captureLog()
      await verifyTurnstileToken(DUMMY_TOKEN, { log })
      const end = lines.map((l) => JSON.parse(l)).find((l) => l.m === 'turnstile.siteverify end')
      expect(end).toBeDefined()
      expect(typeof end.elapsedMs).toBe('number')
      expect(lines.map((l) => JSON.parse(l).m)).toContain('turnstile.siteverify start')
    })
  })
})
