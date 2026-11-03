/**
 * useEffectiveList — "which list does this key mean for this organization?"
 * (frames 09 and 10, flow `effective-picker`; also the detail's "is this list the
 * effective one for its key?" check in frames 02 and 03).
 *
 * ONE lookup through ONE endpoint, and the service decides: the caller org's own
 * readable active list with that key (normally its fork), else the active common
 * list. The hook never fetches both lists and never merges them, and a failed
 * lookup never falls back to a second, different list.
 *
 * It is NOT always a single request. The service paginates before it drops rows
 * the caller cannot read, so a page can come back empty yet non-terminal (a newer
 * unreadable private list ahead of an older readable common one). With the flag
 * ON the lookup therefore follows the cursor of the SAME query until it finds the
 * list or reaches a page with no next cursor (bounded by
 * `MAX_EFFECTIVE_LOOKUP_PAGES`).
 *
 * States (`status`):
 *  - `idle`    — no key (or `skip`): nothing is looked up.
 *  - `loading` — in flight; also reported for a new key until ITS answer lands.
 *  - `ready`   — `list` is the effective list; `source` says where it came from
 *                (`null` while the flag is OFF — no caption, ever).
 *  - `none`    — the walk ended on a TERMINAL page with no list ("List
 *                unavailable"). Not an error.
 *  - `error`   — the lookup failed, including a 403 (a developer-role caller
 *                holds no `SelectionListCatalog:list`): a load failure, never
 *                "List unavailable". Keep any selected value; offer `retry`.
 *                `error.kind === 'incomplete'` means the bounded walk ended
 *                without an answer: unknown, so never "List unavailable".
 *
 * Flag OFF → the 4.0.0 lookup (`GET ?key=`, no `include_shared`, exactly one
 * request, no pagination); common lists are invisible to it.
 *
 * Stored values across a fork are resolved by `useStoredValues`, not here: one
 * hook per request, so a slow resolve never holds the options hostage.
 */

import { useMemo } from 'react'
import { getEffectiveList, getListByKey } from './api'
import { effectiveSourceOf } from './derive'
import { classifyApiError } from './errors'
import { useSharedLists } from './SharedListsFeatureProvider'
import type { EffectiveLookup, Locale } from './types'
import { useResource } from './useResource'

export interface UseEffectiveListOptions {
  locale?: Locale
  /** Hold off the lookup (e.g. the detail only asks for a read-only common list). */
  skip?: boolean
}

export type UseEffectiveListResult = EffectiveLookup & { retry: () => void }

export function useEffectiveList(
  key: string | null | undefined,
  options: UseEffectiveListOptions = {}
): UseEffectiveListResult {
  const { enabled: sharedLists, ready } = useSharedLists()
  const { locale, skip = false } = options
  // Not ready ⇒ the flag has not settled: which lookup (4.0.0 / effective) is not known yet.
  const active = ready && typeof key === 'string' && key !== '' && !skip

  const { settled, reload } = useResource(
    active ? `${sharedLists ? 'shared' : 'own'}|${locale ?? ''}|${key}` : null,
    signal =>
      (sharedLists ? getEffectiveList : getListByKey)(key as string, {
        locale,
        signal,
      })
  )

  const lookup = useMemo<EffectiveLookup>(() => {
    switch (settled.status) {
      case 'idle':
        return { status: 'idle' }
      case 'loading':
        return { status: 'loading' }
      case 'done':
        return settled.value
          ? {
              status: 'ready',
              list: settled.value,
              source: sharedLists ? effectiveSourceOf(settled.value) : null,
            }
          : { status: 'none' }
      case 'failed': {
        const error = classifyApiError(settled.error, { sharedLists })
        // A key the contract rejects (400) cannot name a list: same as the 4.0.0 picker.
        return error.kind === 'validation'
          ? { status: 'none' }
          : { status: 'error', error }
      }
    }
  }, [settled, sharedLists])

  return { ...lookup, retry: reload }
}
