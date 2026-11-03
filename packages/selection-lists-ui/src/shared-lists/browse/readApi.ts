/**
 * Reads the read-only views need that the 4.0.0 client does not expose, each
 * against an endpoint the service actually implements (services/
 * selection-list-service/src/routes):
 *
 *  - `GET /v1/selection-lists/{id}/translations` answers a top-level ARRAY of
 *    `{ locale, completeness_pct, machine_translated, source_changed }`
 *    (`TranslationLocaleStatus`), one per translated locale — the SOURCE locale
 *    is never in it.
 *  - `GET /v1/selection-lists/{id}/items?locale=` resolves every label in the
 *    requested locale (falling back along the service's chain, reported per row
 *    as `resolved_locale`). That is how a locale's text is read: the service has
 *    no `GET …/translations/{locale}`.
 *  - `GET …/items` accepts `status` = `active` | `archived` only.
 */

import {
  SELECTION_LISTS_API_BASE,
  listItems,
  request,
  unwrapCursor,
  unwrapItems,
} from '../../api'
import type { SelectionListItem } from '../../types'

export interface LocaleStatus {
  locale: string
  completeness_pct: number
  machine_translated: boolean
  source_changed: boolean
}

export async function fetchLocaleStatuses(
  listId: string,
  signal?: AbortSignal
): Promise<LocaleStatus[]> {
  const { data } = await request<LocaleStatus[]>(
    `${SELECTION_LISTS_API_BASE}/${encodeURIComponent(listId)}/translations`,
    { signal }
  )
  if (!Array.isArray(data))
    throw new TypeError('GET …/translations did not answer an array')
  return data
}

/** Pages of 200 (the service maximum) walked until `page.hasMore` is false; far above the 1000-item quota. */
const MAX_PAGES = 50
const PAGE_SIZE = 200

/** Every item of one status, resolved in `locale`, following the cursor envelope to its end. */
export async function fetchAllItems(
  listId: string,
  options: {
    status: 'active' | 'archived'
    locale?: string
    signal?: AbortSignal
  }
): Promise<SelectionListItem[]> {
  const rows: SelectionListItem[] = []
  let cursor: string | null = null
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const response: Awaited<ReturnType<typeof listItems>> = await listItems(
      listId,
      { ...options, cursor, limit: PAGE_SIZE }
    )
    rows.push(...unwrapItems(response))
    cursor = unwrapCursor(response)
    const hasMore = response.page?.hasMore ?? cursor !== null
    if (!hasMore || cursor === null) return rows
  }
  throw new Error('items: page bound reached before the end of the list')
}
