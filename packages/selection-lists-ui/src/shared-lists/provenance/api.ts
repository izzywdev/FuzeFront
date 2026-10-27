/**
 * Provenance API wrappers (contract 4.1.0): the two calls the flow adds on top
 * of `core` - the source's items (for "Copied from") and archiving a fork
 * (revert-to-common).
 *
 * Both ride the package's one authenticated, same-origin `request()`. Wire
 * shapes come from `@fuzeone/selection-list-client` (type-only) and
 * `../core`; none is redeclared.
 */

import type { SelectionListItem as WireItem } from '@fuzeone/selection-list-client'
import {
  SELECTION_LISTS_API_BASE,
  request,
  unwrapCursor,
  unwrapItems,
} from '../../api'
import type { PagedResponse } from '../../types'
import {
  classifyApiError,
  isAbortError,
  type ApiFailure,
  type SelectionListId,
  type SharedList,
} from '../core'

/** Upper bound on pages walked for the source's items (a runaway cursor must end). */
export const MAX_SOURCE_ITEM_PAGES = 20

function listPath(listId: SelectionListId): string {
  return `${SELECTION_LISTS_API_BASE}/${encodeURIComponent(listId)}`
}

/**
 * `GET /v1/selection-lists/{listId}/items?status=all` - every item of the
 * source, ARCHIVED ones included (an archived source item still names where a
 * fork item came from). Follows `page.nextCursor` until `hasMore` is false.
 * A failed page rejects; an aborted signal stops the walk.
 */
export async function getSourceItems(
  listId: SelectionListId,
  signal?: AbortSignal
): Promise<WireItem[]> {
  const items: WireItem[] = []
  let cursor: string | null = null
  for (let walked = 0; walked < MAX_SOURCE_ITEM_PAGES; walked++) {
    const query = new URLSearchParams({ status: 'all' })
    if (cursor) query.set('cursor', cursor)
    const { data } = await request<PagedResponse<WireItem>>(
      `${listPath(listId)}/items?${query}`,
      { signal }
    )
    items.push(...unwrapItems(data))
    cursor = unwrapCursor(data)
    if (cursor === null || data.page?.hasMore === false) return items
  }
  return items
}

// ── Archive (revert to common / archive fork) ─────────────────────────────────

/** `POST .../archive` answers, one per row the frames spell out. */
export type ArchiveOutcome =
  /** 200 - `list` is the archived entity when the service returned it. */
  | { kind: 'archived'; list: SharedList | null }
  /** 403 `FORBIDDEN` - "Only the list's owner can archive it" (frame 07). */
  | { kind: 'forbidden' }
  | { kind: 'unauthenticated' }
  /** 404 - the fork itself is gone or unreadable. */
  | { kind: 'not_found' }
  /** 409 - the list is in a state that refuses it; the reason, when named. */
  | { kind: 'conflict'; reason: string | undefined }
  /** Network failure / 5xx: the list may or may not be archived; re-reading answers. */
  | { kind: 'unknown_outcome'; status: number | undefined }

/** Map a failed archive onto its outcome (exported for the unit tests). */
export function archiveOutcomeFromFailure(failure: ApiFailure): ArchiveOutcome {
  switch (failure.kind) {
    case 'forbidden':
      return { kind: 'forbidden' }
    case 'unauthenticated':
      return { kind: 'unauthenticated' }
    case 'not_found':
      return { kind: 'not_found' }
    case 'conflict':
      return { kind: 'conflict', reason: failure.reason }
    case 'fork_required':
      return { kind: 'conflict', reason: 'fork_required' }
    case 'unknown':
      return { kind: 'unknown_outcome', status: failure.status }
    case 'quota':
    case 'validation':
    case 'incomplete':
      // Not answers the archive contract defines: the outcome is unknown.
      return { kind: 'unknown_outcome', status: undefined }
  }
}

/**
 * `POST /v1/selection-lists/{listId}/archive` - revert-to-common and
 * "Archive fork..." are the SAME call; only the label and the promised
 * consequence differ. Idempotent. Resolves to a typed outcome for every
 * answer; rejects only for a cancelled request.
 */
export async function archiveFork(
  listId: SelectionListId,
  signal?: AbortSignal
): Promise<ArchiveOutcome> {
  try {
    const { data } = await request<SharedList | undefined>(
      `${listPath(listId)}/archive`,
      { method: 'POST', signal }
    )
    const list =
      typeof data === 'object' && data !== null && 'id' in data ? data : null
    return { kind: 'archived', list }
  } catch (err) {
    if (isAbortError(err)) throw err
    return archiveOutcomeFromFailure(
      classifyApiError(err, { sharedLists: true })
    )
  }
}
