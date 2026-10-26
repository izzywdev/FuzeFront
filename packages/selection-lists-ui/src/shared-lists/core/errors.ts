/**
 * Reason-aware error handling for the shared-lists API (contract 4.1.0).
 *
 * The package's `api.ts#request()` throws an `Error` decorated with the
 * service's error body (`code`, `reason`, `fork_url`, `source_list_id`, `scope`,
 * `limit`, `current`, `details`) plus the HTTP `status`. A transport failure
 * (no response at all) throws a bare `TypeError` with no `status`.
 *
 * Rules, straight from frames 04 and 06:
 *  - Branch on `status` + `code` + `reason` only — NEVER on `message`, and
 *    never on a guess at the caller's role.
 *  - A 403 is read by `code`: `QUOTA_EXCEEDED` is a quota, `FORBIDDEN` is a
 *    permission. They share the status, not the meaning.
 *  - `fork_required` (409) means "you may fork this": it carries the common
 *    list's id in `source_list_id`. A 403 never offers a fork. A 409 with no
 *    reason is an ordinary conflict.
 *  - With the shared-lists flag OFF a stray `fork_required` is an ordinary
 *    conflict: the UI never renders the fork banner.
 *  - `fork_url` is relative to the same-origin API base. An absolute URL is
 *    ignored — the caller forks through its own `forkList(sourceListId)`.
 */

import { isSameOriginPath } from './derive'
import type {
  ApiFailure,
  ForkOutcome,
  RestoreOutcome,
  SelectionListErrorDetail,
  SelectionListVisibility,
  VisibilityOutcome,
} from './types'

/**
 * Thrown by the effective-list lookup when it followed its page bound of empty,
 * non-terminal pages without finding the list or reaching the end. Never
 * resolved as `null`: an exhausted walk is an unknown answer, not "no list".
 */
export class EffectiveLookupIncompleteError extends Error {
  readonly incomplete = true as const
  constructor(readonly pages: number) {
    super(`Effective list lookup incomplete after ${pages} pages`)
    this.name = 'EffectiveLookupIncompleteError'
  }
}

/** The wire fields `request()` copies from the error body onto the thrown error. */
interface DecoratedError {
  status?: unknown
  code?: unknown
  reason?: unknown
  scope?: unknown
  limit?: unknown
  current?: unknown
  details?: unknown
  fork_url?: unknown
  source_list_id?: unknown
}

const CONTRACT_CODES = new Set([
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'QUOTA_EXCEEDED',
])

/** The code a bare status stands for — only for the statuses the contract defines. */
function codeForStatus(status: number): string | undefined {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR'
    case 401:
      return 'UNAUTHENTICATED'
    case 403:
      return 'FORBIDDEN'
    case 404:
      return 'NOT_FOUND'
    case 409:
      return 'CONFLICT'
    default:
      return undefined
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

/** True for the abort a cancelled request throws — never an outcome, always rethrown. */
export function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'AbortError'
  )
}

/**
 * Decide what a failed request means. `sharedLists` is the flag: with it OFF the
 * 4.1.0 refinements (`fork_required`) are ignored and the failure is a plain
 * conflict, exactly as the 4.0.0 UI treated it.
 */
export function classifyApiError(
  err: unknown,
  options: { sharedLists: boolean }
): ApiFailure {
  if (err instanceof EffectiveLookupIncompleteError)
    return { kind: 'incomplete' }
  const e = (
    typeof err === 'object' && err !== null ? err : {}
  ) as DecoratedError
  if (typeof e.status !== 'number')
    return { kind: 'unknown', status: undefined, network: true }
  const status = e.status
  if (status >= 500) return { kind: 'unknown', status, network: false }

  const code =
    typeof e.code === 'string' && CONTRACT_CODES.has(e.code)
      ? e.code
      : codeForStatus(status)

  switch (code) {
    case 'UNAUTHENTICATED':
      return { kind: 'unauthenticated' }
    case 'QUOTA_EXCEEDED':
      return {
        kind: 'quota',
        scope: typeof e.scope === 'string' ? e.scope : undefined,
        limit: numberOrUndefined(e.limit),
        current: numberOrUndefined(e.current),
      }
    case 'FORBIDDEN':
      return { kind: 'forbidden' }
    case 'NOT_FOUND':
      return { kind: 'not_found' }
    case 'VALIDATION_ERROR':
      return {
        kind: 'validation',
        details: Array.isArray(e.details)
          ? (e.details as SelectionListErrorDetail[])
          : undefined,
      }
    case 'CONFLICT': {
      const reason = typeof e.reason === 'string' ? e.reason : undefined
      const sourceListId =
        typeof e.source_list_id === 'string' ? e.source_list_id : ''
      if (
        options.sharedLists &&
        reason === 'fork_required' &&
        sourceListId !== ''
      ) {
        return {
          kind: 'fork_required',
          sourceListId,
          forkUrl: isSameOriginPath(e.fork_url) ? e.fork_url : undefined,
        }
      }
      return { kind: 'conflict', reason }
    }
    default:
      return { kind: 'unknown', status, network: false }
  }
}

/**
 * Classify a refusal of a per-list mutation (value editor, reorder, list
 * settings, translation workbench, auto-fill). Flows call this from their
 * `catch` blocks to decide between the fork banner (`fork_required`), the
 * no-CTA explanation (`forbidden`), and the 4.0.0 handling for everything else.
 */
export function classifyMutationError(
  err: unknown,
  sharedLists: boolean
): ApiFailure {
  return classifyApiError(err, { sharedLists })
}

// ── Operation outcomes ────────────────────────────────────────────────────────

/** Map a failure of `POST …/fork` onto its frame-06 row. */
export function forkOutcomeFromFailure(failure: ApiFailure): ForkOutcome {
  switch (failure.kind) {
    case 'conflict':
      if (failure.reason === 'fork_exists') return { kind: 'fork_exists' }
      if (failure.reason === 'fork_not_applicable')
        return { kind: 'fork_not_applicable' }
      // No reason, or one this UI does not know: the plain "key is taken" copy.
      return { kind: 'key_taken' }
    case 'quota':
      return {
        kind: 'quota',
        scope: failure.scope,
        limit: failure.limit,
        current: failure.current,
      }
    case 'validation':
      return { kind: 'too_large' }
    case 'forbidden':
      return { kind: 'forbidden' }
    case 'unauthenticated':
      return { kind: 'unauthenticated' }
    case 'not_found':
      return { kind: 'not_found' }
    case 'fork_required':
      // The fork operation cannot itself require a fork; fail to the plain conflict copy.
      return { kind: 'key_taken' }
    case 'incomplete':
      return { kind: 'unknown_outcome', status: undefined }
    case 'unknown':
      return { kind: 'unknown_outcome', status: failure.status }
  }
}

/** Map a failure of the restore PATCH (`{status:'active'}`). */
export function restoreOutcomeFromFailure(failure: ApiFailure): RestoreOutcome {
  switch (failure.kind) {
    case 'quota':
      return {
        kind: 'quota',
        scope: failure.scope,
        limit: failure.limit,
        current: failure.current,
      }
    case 'forbidden':
      return { kind: 'forbidden' }
    case 'unauthenticated':
      return { kind: 'unauthenticated' }
    case 'not_found':
      return { kind: 'not_found' }
    case 'fork_required':
      return {
        kind: 'fork_required',
        sourceListId: failure.sourceListId,
        forkUrl: failure.forkUrl,
      }
    case 'conflict':
      return { kind: 'conflict', reason: failure.reason }
    case 'validation':
      return { kind: 'unknown_outcome', status: 400 }
    case 'incomplete':
      return { kind: 'unknown_outcome', status: undefined }
    case 'unknown':
      return { kind: 'unknown_outcome', status: failure.status }
  }
}

/** Map a failure of the visibility PATCH. `requested` is what the caller asked for. */
export function visibilityOutcomeFromFailure(
  failure: ApiFailure,
  requested: SelectionListVisibility
): VisibilityOutcome {
  switch (failure.kind) {
    case 'conflict':
      return failure.reason === 'visibility_locked'
        ? { kind: 'locked' }
        : { kind: 'conflict', reason: failure.reason }
    case 'forbidden':
      return { kind: 'forbidden', requested }
    case 'unauthenticated':
      return { kind: 'unauthenticated' }
    case 'not_found':
      return { kind: 'not_found' }
    case 'validation':
      return { kind: 'validation', details: failure.details }
    case 'fork_required':
      return {
        kind: 'fork_required',
        sourceListId: failure.sourceListId,
        forkUrl: failure.forkUrl,
      }
    case 'quota':
      return { kind: 'unknown_outcome', status: 403 }
    case 'incomplete':
      return { kind: 'unknown_outcome', status: undefined }
    case 'unknown':
      return { kind: 'unknown_outcome', status: failure.status }
  }
}
