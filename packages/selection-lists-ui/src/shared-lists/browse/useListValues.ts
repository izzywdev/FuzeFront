/**
 * useListValues — every value of one list, archived included (`status=all`),
 * following the cursor envelope (`page.nextCursor` until `hasMore` is false) —
 * the read-only value table (frames 02, 03).
 *
 * ONE endpoint, the owning service's: `GET /v1/selection-lists/{id}/items`.
 * Archived values are listed (and badged by the table) so stored values can
 * still be recognised. A failed LOAD MORE keeps every row already shown
 * (`loadMoreFailed`); `loadMore` retries the same cursor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listItems, unwrapCursor, unwrapItems } from '../../api'
import type { SelectionListItem } from '../../types'
import { classifyApiError, isAbortError, type ApiFailure } from '../core'
import { useResource } from '../core/useResource'

export interface ListValues {
  phase: 'loading' | 'ready' | 'error'
  rows: SelectionListItem[]
  isEmpty: boolean
  hasMore: boolean
  loadingMore: boolean
  loadMoreFailed: boolean
  error: ApiFailure | null
  loadMore: () => void
  reload: () => void
}

interface MoreState {
  token: string
  rows: SelectionListItem[]
  nextCursor: string | null
  hasMore: boolean
  loading: boolean
  failed: boolean
}

function byOrder(a: SelectionListItem, b: SelectionListItem): number {
  return a.sort_order - b.sort_order
}

export function useListValues(listId: string | null): ListValues {
  const { settled, reload, token } = useResource(
    listId ? `values|${listId}` : null,
    async signal => {
      const response = await listItems(listId as string, {
        status: 'all',
        signal,
      })
      return {
        rows: unwrapItems(response),
        nextCursor: unwrapCursor(response),
        hasMore:
          response.page?.hasMore ?? unwrapCursor(response) !== null,
      }
    }
  )

  const [more, setMore] = useState<MoreState | null>(null)
  const tokenRef = useRef(token)
  useEffect(() => {
    tokenRef.current = token
  })
  const inFlight = useRef<string | null>(null)
  useEffect(() => {
    inFlight.current = null
  }, [token])

  const first = settled.status === 'done' ? settled.value : null
  const mine = more !== null && more.token === token ? more : null
  const rows = useMemo(() => {
    if (!first) return []
    const seen = new Set(first.rows.map(row => row.id))
    const extra = (mine?.rows ?? []).filter(row => !seen.has(row.id))
    return [...first.rows, ...extra].sort(byOrder)
  }, [first, mine])
  const nextCursor = mine ? mine.nextCursor : (first?.nextCursor ?? null)
  const hasMore = mine ? mine.hasMore : (first?.hasMore ?? false)

  const loadMore = useCallback(() => {
    if (
      token === null ||
      listId === null ||
      !first ||
      !hasMore ||
      nextCursor === null ||
      inFlight.current === token
    )
      return
    const startedFor = token
    inFlight.current = startedFor
    const kept = mine?.rows ?? []
    setMore({
      token: startedFor,
      rows: kept,
      nextCursor,
      hasMore,
      loading: true,
      failed: false,
    })
    listItems(listId, { status: 'all', cursor: nextCursor }).then(
      response => {
        if (inFlight.current === startedFor) inFlight.current = null
        if (tokenRef.current !== startedFor) return
        const cursor = unwrapCursor(response)
        setMore({
          token: startedFor,
          rows: [...kept, ...unwrapItems(response)],
          nextCursor: cursor,
          hasMore: response.page?.hasMore ?? cursor !== null,
          loading: false,
          failed: false,
        })
      },
      (err: unknown) => {
        if (inFlight.current === startedFor) inFlight.current = null
        if (isAbortError(err) || tokenRef.current !== startedFor) return
        setMore({
          token: startedFor,
          rows: kept,
          nextCursor,
          hasMore,
          loading: false,
          failed: true,
        })
      }
    )
  }, [token, listId, first, hasMore, nextCursor, mine])

  const error = useMemo<ApiFailure | null>(
    () =>
      settled.status === 'failed'
        ? classifyApiError(settled.error, { sharedLists: true })
        : null,
    [settled]
  )
  const phase: ListValues['phase'] =
    settled.status === 'done'
      ? 'ready'
      : settled.status === 'failed'
        ? 'error'
        : 'loading'

  return {
    phase,
    rows,
    isEmpty: phase === 'ready' && rows.length === 0,
    hasMore: phase === 'ready' && hasMore,
    loadingMore: mine?.loading ?? false,
    loadMoreFailed: mine?.failed ?? false,
    error,
    loadMore,
    reload,
  }
}
