/**
 * Cloudflare Turnstile — server-side captcha verification for signup.
 *
 * Contract (packages/security/openapi.yaml, 1.0.0):
 *   - `AuthMethods.captcha { provider:'turnstile', siteKey }` is advertised ONLY
 *     when captcha is configured.
 *   - `SignupRequest.turnstileToken` is REQUIRED when captcha is configured and
 *     is verified here against Cloudflare `siteverify` BEFORE enrollment.
 *   - Fail-closed: a missing/invalid token rejects the signup. When captcha is
 *     NOT configured nothing is required and nothing is called (today's
 *     behaviour).
 *
 * Configuration is read from the environment at call time (never cached, never
 * hardcoded) so a rotated SealedSecret takes effect on rollout:
 *   TURNSTILE_SITE_KEY    public widget key (safe to expose to the browser)
 *   TURNSTILE_SECRET_KEY  server-side secret (NEVER logged, NEVER returned)
 * BOTH must be non-blank for captcha to count as configured — a site key with
 * no secret would advertise a widget the server cannot verify.
 *
 * DEV/CI: use Cloudflare's published dummy keys (they are public test fixtures,
 * not secrets) — see https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 *   TURNSTILE_SITE_KEY=1x00000000000000000000AA              (always passes)
 *   TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA (always passes)
 *   TURNSTILE_SECRET_KEY=2x0000000000000000000000000000000AA (always fails)
 * Real production keys come from a SealedSecret via env, never from this file.
 */
import { logger as rootLogger } from '../lib/logger'

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Bound on the siteverify round-trip so a Cloudflare stall cannot hang signup. */
const VERIFY_TIMEOUT_MS = Number(process.env.TURNSTILE_VERIFY_TIMEOUT_MS) > 0
  ? Number(process.env.TURNSTILE_VERIFY_TIMEOUT_MS)
  : 5000

/** Turnstile tokens are <= 2048 chars; reject absurd input before any network hop. */
const MAX_TOKEN_LENGTH = 2048

export interface CaptchaConfig {
  provider: 'turnstile'
  siteKey: string
  /** Server-side secret. Never serialize this object to a response or a log. */
  secretKey: string
}

/** The captcha config, or null when captcha is not (fully) configured. */
export function getCaptchaConfig(): CaptchaConfig | null {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim()
  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim()
  if (!siteKey || !secretKey) return null
  return { provider: 'turnstile', siteKey, secretKey }
}

/** The PUBLIC projection for `AuthMethods.captcha` — never includes the secret. */
export function publicCaptchaMethod(): { provider: 'turnstile'; siteKey: string } | null {
  const cfg = getCaptchaConfig()
  return cfg ? { provider: cfg.provider, siteKey: cfg.siteKey } : null
}

/** The token is missing, malformed, expired, replayed, or Cloudflare said no. Maps to 400. */
export class CaptchaRejectedError extends Error {
  constructor(message = 'Captcha verification failed') {
    super(message)
    this.name = 'CaptchaRejectedError'
  }
}

/** Cloudflare could not be reached / answered garbage. Maps to 503 (fail-closed, retryable). */
export class CaptchaUnavailableError extends Error {
  constructor(message = 'Captcha verification is temporarily unavailable') {
    super(message)
    this.name = 'CaptchaUnavailableError'
  }
}

interface SiteverifyResponse {
  success?: boolean
  'error-codes'?: string[]
}

interface LoggerLike {
  debug(o: object, m?: string): void
  info(o: object, m?: string): void
  warn(o: object, m?: string): void
  error(o: object, m?: string): void
}

/**
 * Verify a Turnstile token. Resolves on success; throws CaptchaRejectedError /
 * CaptchaUnavailableError otherwise. Callers must only invoke this when
 * `getCaptchaConfig()` is non-null.
 */
export async function verifyTurnstileToken(
  token: unknown,
  opts: { remoteIp?: string; log?: LoggerLike } = {}
): Promise<void> {
  const log: LoggerLike = opts.log ?? rootLogger
  const cfg = getCaptchaConfig()
  if (!cfg) {
    // Programmer error: the route must gate on getCaptchaConfig(). Fail closed.
    throw new CaptchaUnavailableError('Captcha is not configured')
  }
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    log.info({ op: 'turnstile.verify', tokenPresent: typeof token === 'string' && token.length > 0 }, 'turnstile: missing or malformed token')
    throw new CaptchaRejectedError()
  }

  const body = new URLSearchParams({ secret: cfg.secretKey, response: token })
  if (opts.remoteIp) body.set('remoteip', opts.remoteIp)

  const start = Date.now()
  // Shape only — the token and the secret are never logged.
  log.debug({ op: 'turnstile.verify', tokenLength: token.length }, 'turnstile.siteverify start')
  let res: Response
  try {
    res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    })
  } catch (err) {
    log.error(
      { op: 'turnstile.verify', elapsedMs: Date.now() - start, errName: (err as Error)?.name, err: (err as Error)?.message },
      'turnstile.siteverify transport failure'
    )
    throw new CaptchaUnavailableError()
  }
  const elapsedMs = Date.now() - start

  if (!res.ok) {
    log.error({ op: 'turnstile.verify', elapsedMs, status: res.status }, 'turnstile.siteverify non-2xx')
    throw new CaptchaUnavailableError()
  }
  let json: SiteverifyResponse
  try {
    json = (await res.json()) as SiteverifyResponse
  } catch (err) {
    log.error({ op: 'turnstile.verify', elapsedMs, err: (err as Error)?.message }, 'turnstile.siteverify unparseable response')
    throw new CaptchaUnavailableError()
  }

  if (json?.success !== true) {
    // error-codes are Cloudflare enum strings (e.g. timeout-or-duplicate) — safe to log.
    log.warn(
      { op: 'turnstile.verify', elapsedMs, status: res.status, errorCodes: json?.['error-codes'] ?? [] },
      'turnstile.siteverify rejected'
    )
    throw new CaptchaRejectedError()
  }
  log.debug({ op: 'turnstile.verify', elapsedMs, status: res.status }, 'turnstile.siteverify end')
}
