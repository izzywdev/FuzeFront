/**
 * Shared-lists API wrappers (contract 4.1.0).
 *
 * Same semantics as `@fuzeone/selection-list-client` 2.1.x (`getLists`,
 * `getEffectiveList`, `forkList`, `updateList`, `resolveIds`) — same query,
 * 201 → created, 200 → existing, the same error body — but sent through the
 * package's own `request()` so they ride the existing org-scoped auth wiring.
 * Wire shapes come from the client's types; none is redeclared here.
 *
 * Same-origin base only (`/api/v1/...`): never an absolute host.
 *
 * Operations whose answers the frames spell out (fork, restore, visibility)
 * RESOLVE to a typed outcome for every service answer, including refusals and
 * an unknown outcome (network / 5xx). They reject only for a cancelled request
 * (`AbortError`), which is never an outcome.
 */

import {
  RESOLVE_MAX_IDS,
  SELECTION_LISTS_API_BASE,
  request,
  unwrapCursor,
  unwrapItems,
} from '../../api'
import type { PagedResponse } from '../../types'
import {
  EffectiveLookupIncompleteError,
  classifyApiError,
  forkOutcomeFromFailure,
  isAbortError,
  restoreOutcomeFromFailure,
  visibilityOutcomeFromFailure,
} from './errors'
import type {
  ForkOutcome,
  ForkVisibility,
  ListQueryParams,
  Locale,
  Paged,
  ResolvedSelectionListItem,
  RestoreOutcome,
  SelectionListForkRequest,
  SelectionListId,
  SelectionListItemId,
  SelectionListVisibility,
  SharedList,
  StoredValueOutcome,
  VisibilityOutcome,
} from './types'

/** `POST /v1/resolve` — the same-origin path (the collection base is `/api/v1/selection-lists`). */
const RESOLVE_URL = '/api/v1/resolve'

/** Contract `ResolveResponse`, as sent: results keyed by the requested id. */
interface ResolveWire {
  results?: Record<SelectionListItemId, ResolvedSelectionListItem>
  missing?: SelectionListItemId[]
}

function listUrl(params: ListQueryParams): string {
  // Order mirrors the client's `getLists` so both produce byte-identical URLs.
  const query = new URLSearchParams()
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  if (params.status) query.set('status', params.status)
  if (params.key) query.set('key', params.key)
  if (params.locale) query.set('locale', params.locale)
  if (params.include_shared !== undefined)
    query.set('include_shared', String(params.include_shared))
  if (params.visibility) query.set('visibility', params.visibility)
  const qs = query.toString()
  return qs ? `${SELECTION_LISTS_API_BASE}?${qs}` : SELECTION_LISTS_API_BASE
}

function listPath(listId: SelectionListId): string {
  return `${SELECTION_LISTS_API_BASE}/${encodeURIComponent(listId)}`
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/**
 * `GET /v1/selection-lists` — one page. Build `params` with `toListParams` so
 * `include_shared` / `visibility` follow the flag and the switch. Rejects with
 * the decorated request error on any non-2xx.
 */
export async function listSharedLists(
  params: ListQueryParams = {},
  signal?: AbortSignal
): Promise<Paged<SharedList>> {
  const { data } = await request<PagedResponse<SharedList>>(listUrl(params), {
    signal,
  })
  const nextCursor = unwrapCursor(data)
  return {
    items: unwrapItems(data),
    page: { nextCursor, hasMore: data.page?.hasMore ?? nextCursor !== null },
  }
}

/** `GET /v1/selection-lists/{listId}` — one list with its 4.1.0 fields. */
export async function getSharedList(
  listId: SelectionListId,
  options: { locale?: Locale; signal?: AbortSignal } = {}
): Promise<SharedList> {
  const url = options.locale
    ? `${listPath(listId)}?${new URLSearchParams({ locale: options.locale })}`
    : listPath(listId)
  const { data } = await request<SharedList>(url, { signal: options.signal })
  return data
}

/** The row of `page` whose key is `key`, or `null` (never a differently-keyed row). */
function rowForKey(page: Paged<SharedList>, key: string): SharedList | null {
  return page.items.find(list => list.key === key) ?? null
}

/**
 * Upper bound on pages the effective-list lookup will walk. The service paginates
 * BEFORE it drops rows the caller cannot read, so a lookup can meet a few empty
 * pages; this stops a pathological or misbehaving service from walking forever.
 */
export const MAX_EFFECTIVE_LOOKUP_PAGES = 10

/**
 * The EFFECTIVE list for `key`: the caller org's own readable active list with
 * that key (normally its fork) if there is one, else the active common list;
 * `null` when neither exists. The service makes the choice through ONE endpoint,
 * `GET /v1/selection-lists?key=…&include_shared=true&limit=1`; callers must not
 * fetch both lists and merge.
 *
 * Usually that is one call, but not always. The service applies pagination
 * BEFORE it filters out rows the caller cannot read (a newer unreadable private
 * list with the same key can sit ahead of an older readable common one), so a
 * page may be EMPTY and still carry a next cursor. An empty page is therefore
 * only "no list" when it is TERMINAL; otherwise this follows the cursor through
 * the same endpoint, with the same query, until a row for `key` is found or a
 * page has no next cursor. The walk is bounded by `MAX_EFFECTIVE_LOOKUP_PAGES`;
 * exhausting it rejects with `EffectiveLookupIncompleteError` and never resolves
 * `null`. A failed page rejects (no fallback to a different list), and an
 * aborted signal stops the walk.
 */
export async function getEffectiveList(
  key: string,
  options: { locale?: Locale; signal?: AbortSignal } = {}
): Promise<SharedList | null> {
  let cursor: string | null = null
  for (let walked = 0; walked < MAX_EFFECTIVE_LOOKUP_PAGES; walked++) {
    if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const page: Paged<SharedList> = await listSharedLists(
      {
        key,
        include_shared: true,
        locale: options.locale,
        limit: 1,
        ...(cursor ? { cursor } : {}),
      },
      options.signal
    )
    const hit = rowForKey(page, key)
    if (hit) return hit
    if (!page.page.hasMore || !page.page.nextCursor) return null
    cursor = page.page.nextCursor
  }
  throw new EffectiveLookupIncompleteError(MAX_EFFECTIVE_LOOKUP_PAGES)
}

/**
 * The 4.0.0 key lookup (`GET /v1/selection-lists?key=…`, no `include_shared`):
 * what the picker sends while the shared-lists flag is OFF. Common lists are
 * invisible to it.
 */
export async function getListByKey(
  key: string,
  options: { locale?: Locale; signal?: AbortSignal } = {}
): Promise<SharedList | null> {
  const page = await listSharedLists(
    { key, locale: options.locale },
    options.signal
  )
  return rowForKey(page, key)
}

// ── Fork ──────────────────────────────────────────────────────────────────────

/**
 * `POST /v1/selection-lists/{listId}/fork` — copy a common list into the
 * caller's org. The body carries a `visibility` choice and nothing else: no id,
 * no key, no name (the service mints ids and the fork keeps the key).
 *
 * `listId` is the common list's id — from the page, or from the 409's
 * `source_list_id` when the dialog was opened by a `fork_required` refusal.
 * Idempotent per (organization, source): a repeat answers 200 → `existing`.
 */
export async function forkList(
  listId: SelectionListId,
  visibility?: ForkVisibility,
  signal?: AbortSignal
): Promise<ForkOutcome> {
  const body: SelectionListForkRequest = visibility ? { visibility } : {}
  try {
    const { data, status } = await request<SharedList>(
      `${listPath(listId)}/fork`,
      {
        method: 'POST',
        body: JSON.stringify(body),
        signal,
      }
    )
    return status === 201
      ? { kind: 'created', list: data }
      : { kind: 'existing', list: data }
  } catch (err) {
    if (isAbortError(err)) throw err
    return forkOutcomeFromFailure(classifyApiError(err, { sharedLists: false }))
  }
}

/**
 * Restore an archived fork (`PATCH {status:'active'}`). Un-archiving rechecks
 * the org's and the creator's list quotas, so `quota` is a real answer.
 */
export async function restoreList(
  listId: SelectionListId,
  signal?: AbortSignal
): Promise<RestoreOutcome> {
  try {
    const { data } = await request<SharedList>(listPath(listId), {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
      signal,
    })
    return { kind: 'restored', list: data }
  } catch (err) {
    if (isAbortError(err)) throw err
    return restoreOutcomeFromFailure(
      classifyApiError(err, { sharedLists: true })
    )
  }
}

// ── Visibility ────────────────────────────────────────────────────────────────

/**
 * Change a list's visibility (`PATCH {visibility}`). The service decides who
 * may: `manage_access` for private/org, plus `publish_platform` in the platform
 * org for `platform`; a demotion of a common list is `locked`.
 */
export async function changeVisibility(
  listId: SelectionListId,
  visibility: SelectionListVisibility,
  signal?: AbortSignal
): Promise<VisibilityOutcome> {
  try {
    const { data } = await request<SharedList>(listPath(listId), {
      method: 'PATCH',
      body: JSON.stringify({ visibility }),
      signal,
    })
    return { kind: 'changed', list: data }
  } catch (err) {
    if (isAbortError(err)) throw err
    return visibilityOutcomeFromFailure(
      classifyApiError(err, { sharedLists: true }),
      visibility
    )
  }
}

// ── Stored values (resolve) ───────────────────────────────────────────────────

/**
 * Resolve stored item ids (`POST /v1/resolve`), keeping the 4.1.0
 * `effective_item_id`. One call per 500 ids, ids de-duplicated; an empty batch
 * makes no call. With `sharedLists` OFF the redirect field is ignored (the
 * service never sends it, and the 4.0.0 behaviour must not depend on it).
 * Every requested id is accounted for: resolved, or missing.
 * Rejects on a failed call — the caller shows the resolve-error state and keeps
 * the stored id untouched.
 */
export async function resolveStoredValues(
  ids: readonly SelectionListItemId[],
  options: { sharedLists: boolean; locale?: Locale; signal?: AbortSignal }
): Promise<Record<SelectionListItemId, StoredValueOutcome>> {
  const unique = Array.from(new Set(ids))
  const outcomes: Record<SelectionListItemId, StoredValueOutcome> = {}
  for (let i = 0; i < unique.length; i += RESOLVE_MAX_IDS) {
    const chunk = unique.slice(i, i + RESOLVE_MAX_IDS)
    const { data } = await request<ResolveWire>(RESOLVE_URL, {
      method: 'POST',
      body: JSON.stringify(
        options.locale ? { ids: chunk, locale: options.locale } : { ids: chunk }
      ),
      signal: options.signal,
    })
    const results = data.results ?? {}
    for (const id of chunk) {
      const hit = results[id]
      outcomes[id] = hit
        ? {
            kind: 'resolved',
            id,
            label: hit.label,
            locale: hit.locale,
            isMachine: hit.is_machine,
            status: hit.status,
            effectiveItemId: options.sharedLists
              ? (hit.effective_item_id ?? null)
              : null,
          }
        : { kind: 'missing', id }
    }
  }
  return outcomes
}
