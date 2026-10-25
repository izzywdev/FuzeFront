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
export function classifyCodeFailure(err: unknown): 'invalid' | 'service' {
  return isInvalidCode(err) ? 'invalid' : 'service'
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
