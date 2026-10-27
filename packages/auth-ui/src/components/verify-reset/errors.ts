import type { AuthErrorKind } from './types'

interface ErrorLike {
  status?: number
  code?: string
  response?: { status?: number; data?: { code?: string } }
}

/**
 * Duck-typed failure classifier (no HTTP-client import). Understands both a plain
 * `{status, code}` error and an axios-style `{response:{status,data:{code}}}`.
 *  - 429 / RATE_LIMITED            → 'rate-limited'
 *  - EXPIRED / INVALID_CODE / INVALID_TOKEN / TOKEN_EXPIRED / TOKEN_INVALID → 'expired'
 *    (plus NOT_ACTIVE and, when `badRequestIsExpired`, any 400 — the verify-link
 *    operation, where a bad token is the only 400 there is)
 *  - 422 / PASSWORD_POLICY / legacy 400 MALFORMED (when `malformedIsPolicy`) → 'policy'
 *  - 502/503/504 / PROVIDER_UNAVAILABLE → 'unavailable'
 *  - 409 / CONFLICT → 'conflict' (an account with that email already exists — signup)
 *  - CAPTCHA_FAILED → 'captcha' (a rejected/invalid Turnstile token — signup; 400,
 *    distinct from a generic MALFORMED body, so it survives `malformedIsPolicy`)
 */
export function classifyAuthError(
  err: unknown,
  opts: { badRequestIsExpired?: boolean; malformedIsPolicy?: boolean; notActiveIsExpired?: boolean } = {},
): AuthErrorKind {
  const e = (err ?? {}) as ErrorLike
  const status = e.status ?? e.response?.status
  const code = e.response?.data?.code ?? e.code
  if (status === 429 || code === 'RATE_LIMITED') return 'rate-limited'
  if (status === 409 || code === 'CONFLICT') return 'conflict'
  if (code === 'CAPTCHA_FAILED') return 'captcha'
  if (
    code === 'EXPIRED' ||
    code === 'INVALID_CODE' ||
    code === 'INVALID_TOKEN' ||
    code === 'TOKEN_EXPIRED' ||
    code === 'TOKEN_INVALID' ||
    (code === 'NOT_ACTIVE' && opts.notActiveIsExpired)
  ) {
    return 'expired'
  }
  if (status === 422 || code === 'PASSWORD_POLICY') return 'policy'
  if (opts.malformedIsPolicy && status === 400 && code === 'MALFORMED') return 'policy'
  if (status === 503 || status === 502 || status === 504 || code === 'PROVIDER_UNAVAILABLE') {
    return 'unavailable'
  }
  if (status === 400 && opts.badRequestIsExpired) return 'expired'
  return 'unknown'
}
