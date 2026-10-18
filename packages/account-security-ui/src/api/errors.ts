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

/** 409 — the fail-closed conflict guard (remove-last-factor, password exists, …). */
export function isConflict(err: unknown): boolean {
  return statusOf(err) === 409
}
