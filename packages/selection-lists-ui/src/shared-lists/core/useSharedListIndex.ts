/**
 * useSharedListIndex — the list index with common lists (frame 01, flow
 * `shared-read`).
 *
 * ONE endpoint, the owning service's: `GET /v1/selection-lists`. The hook never
 * combines two services' answers in the browser. Its inputs are CONTROLLED —
 * the flow owns `status`, the "Include common lists" switch and the visibility
 * filter (and binds them to the URL); the hook turns them into the request and
 * walks the cursor envelope (`page.nextCursor` until `hasMore` is false).
 *
 * Request rules (`toListParams`): flag OFF, or the switch OFF → neither
 * `include_shared` nor `visibility` is sent (exactly the 4.0.0 request). Switch
 * ON → `include_shared=true`, plus `visibility` for any choice but `any`.
 *
 * `phase`: `loading` · `ready` · `error`. Changing any input starts over (rows
 * cleared, `loading`); a failed page-one load keeps nothing to show, so the flow
 * renders the error state with its filters intact and calls `reload`.
 * `groups` is set only when the index shows source groups (flag ON, switch ON,
 * no visibility filter) AND rows have loaded — group headers never appear before
 * their rows. A failed LOAD MORE keeps every row already shown (`loadMoreFailed`)
 * and `loadMore` retries the same cursor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listSharedLists } from './api'
import {
  appendUnique,
  groupBySource,
  groupingApplies,
  toListParams,
} from './derive'
import { classifyApiError, isAbortError } from './errors'
import { useSharedLists } from './SharedListsFeatureProvider'
import type {
  ApiFailure,
  ListGroups,
  SharedList,
  SharedListsQuery,
} from './types'
import { useResource } from './useResource'

export type UseSharedListIndexOptions = Pick<
  SharedListsQuery,
  'status' | 'includeShared' | 'visibility' | 'locale' | 'limit'
>

export interface SharedListIndex {
  phase: 'loading' | 'ready' | 'error'
  rows: SharedList[]
  /** `null` while loading, on error, or when this query shows no grouping. */
  groups: ListGroups | null
  /** Ready with nothing to show: the empty state (the flow words it per switch state). */
  isEmpty: boolean
  hasMore: boolean
  loadingMore: boolean
  loadMoreFailed: boolean
  error: ApiFailure | null
  /** Fetch the next page. No-op while one is in flight or when there is no next page. */
  loadMore: () => void
  /** Re-run page one (Retry). */
  reload: () => void
}

interface MoreState {
  token: string
  rows: SharedList[]
  nextCursor: string | null
  hasMore: boolean
  loading: boolean
  failed: boolean
}

export function useSharedListIndex(
  options: UseSharedListIndexOptions = {}
): SharedListIndex {
  const { enabled: sharedLists } = useSharedLists()
  const { status, includeShared, visibility, locale, limit } = options
  const query = useMemo<SharedListsQuery>(
    () => ({ status, includeShared, visibility, locale, limit }),
    [status, includeShared, visibility, locale, limit]
  )
  const params = useMemo(
    () => toListParams(query, sharedLists),
    [query, sharedLists]
  )
  const paramsRef = useRef(params)
  useEffect(() => {
    paramsRef.current = params
  })

  const { settled, reload, token } = useResource(
    JSON.stringify(params),
    signal => listSharedLists(params, signal)
  )

  // Pages after the first, scoped to the request that produced them.
  const [more, setMore] = useState<MoreState | null>(null)
  const tokenRef = useRef(token)
  useEffect(() => {
    tokenRef.current = token
  })
  const inFlight = useRef(false)

  const firstPage = settled.status === 'done' ? settled.value : null
  const mine = more !== null && more.token === token ? more : null
  const rows = useMemo(
    () => (firstPage ? appendUnique(firstPage.items, mine?.rows ?? []) : []),
    [firstPage, mine]
  )
  const nextCursor = mine
    ? mine.nextCursor
    : (firstPage?.page.nextCursor ?? null)
  const hasMore = mine ? mine.hasMore : (firstPage?.page.hasMore ?? false)

  const loadMore = useCallback(() => {
    if (
      inFlight.current ||
      token === null ||
      !firstPage ||
      !hasMore ||
      nextCursor === null
    )
      return
    inFlight.current = true
    const startedFor = token
    const baseRows = rows
    setMore({
      token,
      rows: mine?.rows ?? [],
      nextCursor,
      hasMore,
      loading: true,
      failed: false,
    })
    listSharedLists({ ...paramsRef.current, cursor: nextCursor }).then(
      page => {
        inFlight.current = false
        if (tokenRef.current !== startedFor) return
        const added = appendUnique(baseRows, page.items).slice(baseRows.length)
        setMore({
          token: startedFor,
          rows: [...(mine?.rows ?? []), ...added],
          nextCursor: page.page.nextCursor,
          hasMore: page.page.hasMore,
          loading: false,
          failed: false,
        })
      },
      (err: unknown) => {
        inFlight.current = false
        if (isAbortError(err) || tokenRef.current !== startedFor) return
        setMore({
          token: startedFor,
          rows: mine?.rows ?? [],
          nextCursor,
          hasMore,
          loading: false,
          failed: true,
        })
      }
    )
  }, [token, firstPage, hasMore, nextCursor, rows, mine])

  const error = useMemo<ApiFailure | null>(
    () =>
      settled.status === 'failed'
        ? classifyApiError(settled.error, { sharedLists })
        : null,
    [settled, sharedLists]
  )

  const phase: SharedListIndex['phase'] =
    settled.status === 'done'
      ? 'ready'
      : settled.status === 'failed'
        ? 'error'
        : 'loading'
  const grouped = phase === 'ready' && groupingApplies(query, sharedLists)
  const groups = useMemo(
    () => (grouped ? groupBySource(rows) : null),
    [grouped, rows]
  )

  return {
    phase,
    rows,
    groups,
    isEmpty: phase === 'ready' && rows.length === 0,
    hasMore: phase === 'ready' && hasMore,
    loadingMore: mine?.loading ?? false,
    loadMoreFailed: mine?.failed ?? false,
    error,
    loadMore,
    reload,
  }
}
