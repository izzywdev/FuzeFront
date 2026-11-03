/**
 * useSharedList — one list with its 4.1.0 fields (`visibility`, `editable`,
 * `forked_from`, `organization_id`) for the read-only detail, the provenance
 * panel and the visibility control (frames 02, 03, 07, 08).
 *
 * `phase`:
 *  - `loading`   — badge, notice and CTA all wait for this; nothing guesses "editable".
 *  - `ready`     — `list` is set.
 *  - `not_found` — 404: another org's `org` list, a caller without shared read,
 *                  or a list that never existed. Deliberately indistinguishable
 *                  (the service answers 404, never 403, so a URL cannot probe).
 *  - `error`     — anything else; `error` says what.
 *
 * `setList` patches the loaded list in place from a command's returned entity
 * (e.g. the visibility PATCH) without a re-read — the optimistic cache update
 * the data-consistency standard asks for.
 */

import { useCallback, useMemo, useState } from 'react'
import { getSharedList } from './api'
import { classifyApiError } from './errors'
import type { ApiFailure, Locale, SelectionListId, SharedList } from './types'
import { useResource } from './useResource'

export type SharedListState =
  | { phase: 'loading'; list: null; error: null }
  | { phase: 'ready'; list: SharedList; error: null }
  | { phase: 'not_found'; list: null; error: null }
  | { phase: 'error'; list: null; error: ApiFailure }

export type UseSharedListResult = SharedListState & {
  reload: () => void
  /** Replace the loaded list with a newer copy returned by a command. */
  setList: (list: SharedList) => void
}

export function useSharedList(
  listId: SelectionListId | null | undefined,
  options: { locale?: Locale } = {}
): UseSharedListResult {
  const { locale } = options
  const { settled, reload, token } = useResource(
    listId ? `${locale ?? ''}|${listId}` : null,
    signal => getSharedList(listId as SelectionListId, { locale, signal })
  )

  // A command's returned entity overrides the loaded copy, until the next (re)load.
  const [patched, setPatched] = useState<{
    token: string | null
    list: SharedList
  } | null>(null)
  const setList = useCallback(
    (list: SharedList) => setPatched({ token, list }),
    [token]
  )

  const state = useMemo<SharedListState>(() => {
    switch (settled.status) {
      case 'idle':
      case 'loading':
        return { phase: 'loading', list: null, error: null }
      case 'done':
        return {
          phase: 'ready',
          list:
            patched !== null && patched.token === token
              ? patched.list
              : settled.value,
          error: null,
        }
      case 'failed': {
        const error = classifyApiError(settled.error, { sharedLists: true })
        return error.kind === 'not_found'
          ? { phase: 'not_found', list: null, error: null }
          : { phase: 'error', list: null, error }
      }
    }
  }, [settled, patched, token])

  return { ...state, reload, setList }
}
