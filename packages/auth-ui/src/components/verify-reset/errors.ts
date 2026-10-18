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
 *  - EXPIRED / INVALID_CODE (or 400 when `badRequestIsExpired`) → 'expired'
 *  - 502/503/504 / PROVIDER_UNAVAILABLE → 'unavailable'
 */
export function classifyAuthError(
  err: unknown,
  opts: { badRequestIsExpired?: boolean } = {},
): AuthErrorKind {
  const e = (err ?? {}) as ErrorLike
  const status = e.status ?? e.response?.status
  const code = e.response?.data?.code ?? e.code
  if (status === 429 || code === 'RATE_LIMITED') return 'rate-limited'
  if (code === 'EXPIRED' || code === 'INVALID_CODE') return 'expired'
  if (status === 503 || status === 502 || status === 504 || code === 'PROVIDER_UNAVAILABLE') {
    return 'unavailable'
  }
  if (status === 400 && opts.badRequestIsExpired) return 'expired'
  return 'unknown'
}
