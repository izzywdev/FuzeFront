/**
 * useEffectivePickerData — the data layer of the picker while the shared-lists
 * flag is ON (frames 09, 10, 15, flow `effective-picker`).
 *
 * Three independent requests, composed into the one load state the picker
 * renders. The picker never chooses between lists itself:
 *
 *  1. WHICH list — `useEffectiveList(key)`: the service decides (the org's own
 *     readable active list, else the active common list). It may take several
 *     requests (pagination happens before the readability filter), and a lookup
 *     that ends without an answer is `incomplete` — an error, never "List
 *     unavailable". A failed lookup never falls back to a second list.
 *  2. ITS options — `GET …/items?status=active` for THAT list id only, in
 *     `sort_order`. Never merged with another list's items.
 *  3. The stored values — `useStoredValues(ids)`: one `POST /v1/resolve`; it
 *     does not hold the options hostage (and they do not hold it).
 *
 * Flag OFF → this hook is inert: no request is made and `enabled` is `false`,
 * so the approved 4.0.0 picker data path is the only one that runs.
 *
 * A key that already is a list id (`front_sl_…`) is used as-is: nothing is
 * looked up, so there is no effective-list answer (and no source caption).
 */

import { listItems, unwrapCursor, unwrapItems } from '../../api'
import type { SelectionListItem } from '../../types'
import { useSharedLists } from '../core/SharedListsFeatureProvider'
import type { EffectiveSource, SharedList } from '../core/types'
import { useEffectiveList } from '../core/useEffectiveList'
import { useResource } from '../core/useResource'
import {
  useStoredValues,
  type UseStoredValuesOptions,
  type UseStoredValuesResult,
} from '../core/useStoredValues'

/** Contract list ids carry the `front_sl_` prefix; anything else is a list KEY. */
const LIST_ID_PREFIX = 'front_sl_'
/** Safety cap for cursor walking items (items/list is quota-bounded well below this). */
const MAX_ITEM_PAGES = 20

export type EffectivePickerLoadState =
  | 'loading'
  | 'error'
  | 'not-found'
  | 'loaded'

export interface EffectivePickerData {
  /** The shared-lists flag is ON — otherwise every other field is inert. */
  enabled: boolean
  loadState: EffectivePickerLoadState
  /** The ACTIVE options of the effective list, in `sort_order`. */
  items: SelectionListItem[]
  /** The effective list the service returned; `null` until known (or for a list-id key). */
  list: SharedList | null
  /** Where it came from — drives the opt-in caption. `null` until known. */
  source: EffectiveSource | null
  /** The lookup ended without an answer (its page bound ran out): unknown, never "no list". */
  incomplete: boolean
  /** Re-run whatever failed: the lookup if it failed, otherwise the items read of the SAME list. */
  retryLoad: () => void
  /** The stored values' resolve. */
  stored: UseStoredValuesResult
}

const NO_ITEMS: SelectionListItem[] = []
const noop = () => undefined

async function readActiveItems(
  listId: string,
  signal: AbortSignal
): Promise<SelectionListItem[]> {
  const all: SelectionListItem[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_ITEM_PAGES; page++) {
    const res = await listItems(listId, {
      status: 'active',
      signal,
      ...(cursor ? { cursor } : {}),
    })
    all.push(...unwrapItems(res))
    cursor = unwrapCursor(res)
    if (!cursor) break
  }
  all.sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
  return all
}

export interface UseEffectivePickerDataOptions {
  listKey: string
  /** The ids the host holds (resolved in one request). */
  storedIds: readonly string[]
  onEffectiveValue?: UseStoredValuesOptions['onEffectiveValue']
}

export function useEffectivePickerData({
  listKey,
  storedIds,
  onEffectiveValue,
}: UseEffectivePickerDataOptions): EffectivePickerData {
  const { enabled } = useSharedLists()
  const keyIsListId = listKey.startsWith(LIST_ID_PREFIX)

  const lookup = useEffectiveList(
    enabled && !keyIsListId ? listKey : null
  )
  const stored = useStoredValues(enabled ? storedIds : [], {
    onEffectiveValue,
  })

  const listId =
    enabled && lookup.status === 'ready'
      ? lookup.list.id
      : enabled && keyIsListId
        ? listKey
        : null
  const { settled, reload } = useResource(
    listId ? `items|${listId}` : null,
    signal => readActiveItems(listId as string, signal)
  )

  if (!enabled) {
    return {
      enabled,
      stored,
      loadState: 'loading',
      items: NO_ITEMS,
      list: null,
      source: null,
      incomplete: false,
      retryLoad: noop,
    }
  }

  const list = lookup.status === 'ready' ? lookup.list : null
  const source = lookup.status === 'ready' ? lookup.source : null
  const items = settled.status === 'done' ? settled.value : NO_ITEMS
  let loadState: EffectivePickerLoadState
  if (lookup.status === 'error' || settled.status === 'failed') {
    loadState = 'error'
  } else if (lookup.status === 'none') {
    loadState = 'not-found'
  } else if (settled.status === 'done') {
    loadState = 'loaded'
  } else {
    loadState = 'loading'
  }
  return {
    enabled,
    stored,
    loadState,
    items,
    list,
    source,
    incomplete: lookup.status === 'error' && lookup.error.kind === 'incomplete',
    // The lookup failed → ask again (the options follow); else only the SAME list's items again.
    retryLoad: lookup.status === 'error' ? lookup.retry : reload,
  }
}
