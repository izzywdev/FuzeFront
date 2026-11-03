/**
 * useListValues — every value of one list, archived included, following the
 * cursor envelope (`page.nextCursor` until `hasMore` is false) — the read-only
 * value table (frames 02, 03).
 *
 * ONE endpoint, the owning service's: `GET /v1/selection-lists/{id}/items`. The
 * service accepts `status=active` (default) and `status=archived` — NOT the
 * openapi's `all` (it answers 400) — so the hook reads the two statuses and
 * lists active values first, then archived ones (badged by the table, so stored
 * values can still be recognised). "Load more" continues the active stream
 * before the archived one. A failed LOAD MORE keeps every row already shown
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

type Status = 'active' | 'archived'

interface Stream {
  rows: SelectionListItem[]
  nextCursor: string | null
  hasMore: boolean
}

type Streams = Record<Status, Stream>

interface MoreState {
  token: string
  streams: Streams
  loading: boolean
  failed: boolean
}

async function firstPage(
  listId: string,
  status: Status,
  signal: AbortSignal
): Promise<Stream> {
  const response = await listItems(listId, { status, signal })
  const nextCursor = unwrapCursor(response)
  return {
    rows: unwrapItems(response),
    nextCursor,
    hasMore: response.page?.hasMore ?? nextCursor !== null,
  }
}

function byOrder(a: SelectionListItem, b: SelectionListItem): number {
  return a.sort_order - b.sort_order
}

function merge(stream: Stream): SelectionListItem[] {
  const seen = new Set<string>()
  return stream.rows
    .filter(row => (seen.has(row.id) ? false : (seen.add(row.id), true)))
    .sort(byOrder)
}

export function useListValues(listId: string | null): ListValues {
  const { settled, reload, token } = useResource(
    listId ? `values|${listId}` : null,
    async signal => {
      const [active, archived] = await Promise.all([
        firstPage(listId as string, 'active', signal),
        firstPage(listId as string, 'archived', signal),
      ])
      return { active, archived } satisfies Streams
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
  const streams: Streams | null = mine ? mine.streams : first
  const rows = useMemo(
    () => (streams ? [...merge(streams.active), ...merge(streams.archived)] : []),
    [streams]
  )
  const next: Status | null = !streams
    ? null
    : streams.active.hasMore
      ? 'active'
      : streams.archived.hasMore
        ? 'archived'
        : null

  const loadMore = useCallback(() => {
    if (token === null || listId === null || !streams || next === null) return
    if (inFlight.current === token) return
    const cursor = streams[next].nextCursor
    if (cursor === null) return
    const startedFor = token
    inFlight.current = startedFor
    setMore({ token: startedFor, streams, loading: true, failed: false })
    listItems(listId, { status: next, cursor }).then(
      response => {
        if (inFlight.current === startedFor) inFlight.current = null
        if (tokenRef.current !== startedFor) return
        const nextCursor = unwrapCursor(response)
        const grown: Stream = {
          rows: [...streams[next].rows, ...unwrapItems(response)],
          nextCursor,
          hasMore: response.page?.hasMore ?? nextCursor !== null,
        }
        setMore({
          token: startedFor,
          streams: { ...streams, [next]: grown },
          loading: false,
          failed: false,
        })
      },
      (err: unknown) => {
        if (inFlight.current === startedFor) inFlight.current = null
        if (isAbortError(err) || tokenRef.current !== startedFor) return
        setMore({ token: startedFor, streams, loading: false, failed: true })
      }
    )
  }, [token, listId, streams, next])

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
    hasMore: phase === 'ready' && next !== null,
    loadingMore: mine?.loading ?? false,
    loadMoreFailed: mine?.failed ?? false,
    error,
    loadMore,
    reload,
  }
}
