import { HttpError } from './http'

/** HTTP status of a rejected client call, or undefined for a network / non-HTTP failure. */
export function statusOf(err: unknown): number | undefined {
  return err instanceof HttpError ? err.status : undefined
}

/**
 * A wrong / expired one-time code. The Security backend answers a bad factor
 * code with 401 (`NOT_ACTIVE`) on activate / verify / phone-confirm; the
 * contract also documents 400. Both are "that code did not work" — the UI
 * stays on the screen and never navigates (fail-closed).
 */
export function isInvalidCode(err: unknown): boolean {
  const s = statusOf(err)
  return s === 400 || s === 401 || s === 403 || s === 422
}

/**
 * Classify a failed one-time-code submission. 'invalid' = the server rejected
 * the code (show the wrong/expired-code error); 'service' = 5xx / 429 / network,
 * where nothing says the code was wrong (show a retryable service error and keep
 * the entered code). Every code-entry catch must use this, never a bare catch.
 */
export function classifyCodeFailure(err: unknown): CodeFailure {
  return isInvalidCode(err) ? 'invalid' : isRateLimited(err) ? 'rate-limited' : 'service'
}

/** 429 / `RATE_LIMITED` — too many failed attempts; the credential was NOT judged wrong. */
export function isRateLimited(err: unknown): boolean {
  return statusOf(err) === 429 || (err instanceof HttpError && err.code === 'RATE_LIMITED')
}

/** Seconds to wait from a 429's `Retry-After`, or undefined when missing / not a positive integer. */
export function retryAfterOf(err: unknown): number | undefined {
  return err instanceof HttpError ? err.retryAfter : undefined
}

export type CodeFailure = 'invalid' | 'service' | 'rate-limited'

/**
 * Classify a failed RECOVERY-code redemption (`POST /mfa/verify` with `recoveryCode`).
 * Unlike a factor code, the contract gives each outcome its own code:
 *  - `RECOVERY_CODE_INVALID` (401) → 'invalid'  (challenge stays live; the user may retry)
 *  - `NOT_ACTIVE` (401)            → 'expired'  (challenge unknown / expired / completed)
 *  - 429 `RATE_LIMITED`            → 'rate-limited'
 * Anything else (400 MALFORMED, 5xx, network) is 'service': nothing says the code was wrong.
 */
export function classifyRecoveryFailure(err: unknown): CodeFailure | 'expired' {
  if (isRateLimited(err)) return 'rate-limited'
  const code = err instanceof HttpError ? err.code : undefined
  if (code === 'NOT_ACTIVE') return 'expired'
  if (code === 'RECOVERY_CODE_INVALID') return 'invalid'
  return 'service'
}

/**
 * A password the server rejected on policy / validation grounds (400, or 422 /
 * code PASSWORD_POLICY). The submit must return to the EDITABLE form with an inline
 * error — never to a screen whose only action replays the same rejected input.
 */
export function isPolicyRejection(err: unknown): boolean {
  const s = statusOf(err)
  const code = err instanceof HttpError ? err.code : undefined
  return s === 400 || s === 422 || code === 'PASSWORD_POLICY'
}

/** 409 — the fail-closed conflict guard (remove-last-factor, password exists, …). */
export function isConflict(err: unknown): boolean {
  return statusOf(err) === 409
}
