/**
 * Selection Lists API client — same-origin /api/v1 base.
 * No absolute host — works identically under local TLS and prod ingress.
 */

import type {
  SelectionList,
  SelectionListItem,
  QuotaStatus,
  LocaleIndexResponse,
  LocaleEditorResponse,
  AccessGrant,
  ResolveResponse,
  ResolveWireResponse,
  ResolvedItem,
  PagedResponse,
  ApiError,
  AutofillResult,
} from './types'

const BASE = '/api/v1/selection-lists'

async function request<T>(
  url: string,
  options: RequestInit = {},
): Promise<{ data: T; status: number }> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  })

  if (!res.ok) {
    let err: ApiError = { code: 'UNKNOWN', message: res.statusText }
    try {
      err = await res.json()
    } catch {
      // ignore parse failure
    }
    const e = new Error(err.message ?? res.statusText) as Error & ApiError
    Object.assign(e, err)
    ;(e as unknown as { status: number }).status = res.status
    throw e
  }

  // 204 No Content
  if (res.status === 204) return { data: undefined as unknown as T, status: 204 }

  const data = await res.json()
  return { data, status: res.status }
}

// ── Selection Lists ───────────────────────────────────────────────────────────

export async function listSelectionLists(params: {
  cursor?: string | null
  status?: string
  /**
   * Exact-match filter on the org-unique list `key` (GET /v1/selection-lists
   * `key` query parameter). The service answers a page of at most one row, so a
   * caller can look a list up by its slug without walking pages.
   */
  key?: string
} = {}): Promise<PagedResponse<SelectionList>> {
  const qs = new URLSearchParams()
  if (params.cursor) qs.set('cursor', params.cursor)
  if (params.status) qs.set('status', params.status)
  if (params.key) qs.set('key', params.key)
  const url = `${BASE}${qs.toString() ? '?' + qs.toString() : ''}`
  const { data } = await request<PagedResponse<SelectionList>>(url)
  return data
}

export async function createSelectionList(body: {
  key: string
  name?: string
  source_locale: string
}): Promise<SelectionList> {
  const { data } = await request<SelectionList>(BASE, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return data
}

export async function getSelectionList(listId: string): Promise<SelectionList> {
  const { data } = await request<SelectionList>(`${BASE}/${listId}`)
  return data
}

// ── Items ─────────────────────────────────────────────────────────────────────

export async function listItems(
  listId: string,
  params: { cursor?: string | null } = {},
): Promise<PagedResponse<SelectionListItem>> {
  const qs = new URLSearchParams()
  if (params.cursor) qs.set('cursor', params.cursor)
  const url = `${BASE}/${listId}/items${qs.toString() ? '?' + qs.toString() : ''}`
  const { data } = await request<PagedResponse<SelectionListItem>>(url)
  return data
}

export async function createItem(
  listId: string,
  body: { code: string; label: string },
): Promise<SelectionListItem> {
  const { data } = await request<SelectionListItem>(`${BASE}/${listId}/items`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return data
}

export async function updateItem(
  listId: string,
  itemId: string,
  body: { label: string },
): Promise<SelectionListItem> {
  const { data } = await request<SelectionListItem>(
    `${BASE}/${listId}/items/${itemId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  )
  return data
}

export async function archiveItem(listId: string, itemId: string): Promise<void> {
  await request(`${BASE}/${listId}/items/${itemId}/archive`, { method: 'POST' })
}

export async function purgeItem(listId: string, itemId: string): Promise<void> {
  await request(`${BASE}/${listId}/items/${itemId}`, { method: 'DELETE' })
}

export async function reorderItems(
  listId: string,
  itemIds: string[],
): Promise<void> {
  await request(`${BASE}/${listId}/items/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ item_ids: itemIds }),
  })
}

// ── Quota ─────────────────────────────────────────────────────────────────────

export async function getQuota(): Promise<QuotaStatus> {
  const { data } = await request<QuotaStatus>(`${BASE}/quota`)
  return data
}

// ── Translations ──────────────────────────────────────────────────────────────

export async function getLocaleIndex(listId: string): Promise<LocaleIndexResponse> {
  const { data } = await request<LocaleIndexResponse>(
    `${BASE}/${listId}/translations`,
  )
  return data
}

export async function getLocaleEditor(
  listId: string,
  locale: string,
): Promise<LocaleEditorResponse> {
  const { data } = await request<LocaleEditorResponse>(
    `${BASE}/${listId}/translations/${locale}`,
  )
  return data
}

export async function saveTranslation(
  listId: string,
  itemId: string,
  locale: string,
  body: { label: string },
): Promise<void> {
  await request(`${BASE}/${listId}/items/${itemId}/translations/${locale}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

/**
 * POST …/translations/{locale}/autofill.
 *
 * Returns the response as-is, typed against the contract
 * (SelectionListAutofillResult, services/selection-list-service/openapi.yaml),
 * whose wire fields are `items_translated` / `items_skipped` / `list_translated`
 * — NOT `filled` / `skipped`. An earlier version of this function re-typed the
 * response as `{ filled, skipped }`, which doesn't exist on the wire: both
 * counts came back `undefined`, so the completion summary rendered
 * `data-items-skipped={undefined}` (attribute absent) and the "nothing to do"
 * branch could never be true. Consume the contract's own field names instead
 * of re-mapping them.
 */
export async function autofillTranslations(
  listId: string,
  locale: string,
  body: { overwrite_machine: boolean },
): Promise<AutofillResult> {
  const { data } = await request<AutofillResult>(
    `${BASE}/${listId}/translations/${locale}/autofill`,
    { method: 'POST', body: JSON.stringify(body) },
  )
  return data
}

// ── Access ────────────────────────────────────────────────────────────────────

export async function getAccessGrants(listId: string): Promise<AccessGrant[]> {
  const { data } = await request<AccessGrant[]>(`${BASE}/${listId}/access`)
  return data
}

export async function updateAccessGrant(
  listId: string,
  userId: string,
  body: { role: string },
): Promise<AccessGrant> {
  const { data } = await request<AccessGrant>(
    `${BASE}/${listId}/access/${userId}`,
    { method: 'PUT', body: JSON.stringify(body) },
  )
  return data
}

export async function revokeAccessGrant(
  listId: string,
  userId: string,
): Promise<void> {
  await request(`${BASE}/${listId}/access/${userId}`, { method: 'DELETE' })
}

// ── Resolve ───────────────────────────────────────────────────────────────────

/** `POST /v1/resolve` accepts at most this many ids per call (ResolveRequest.ids.maxItems). */
export const RESOLVE_MAX_IDS = 500

/**
 * Bulk-resolve item ids to labels (`POST /v1/resolve`).
 *
 * The wire contract answers `{ results: { [id]: { label, locale, is_machine,
 * status } }, missing: string[] }`; this normalises it to the array form the UI
 * works with (`resolved[]`, each carrying its own `id`). A legacy
 * `{ resolved: [...] }` body is also accepted. Ids are de-duplicated (the
 * request schema is `uniqueItems`) and sent in ONE call; only a batch over the
 * contract's 500-id cap is split, each chunk being a call of its own. An empty
 * batch makes no call (the contract requires at least one id).
 */
export async function resolveItems(ids: string[]): Promise<ResolveResponse> {
  const unique = Array.from(new Set(ids))
  if (unique.length === 0) return { resolved: [], missing: [] }

  const resolved: ResolvedItem[] = []
  const missing: string[] = []
  for (let i = 0; i < unique.length; i += RESOLVE_MAX_IDS) {
    const chunk = unique.slice(i, i + RESOLVE_MAX_IDS)
    const { data } = await request<ResolveWireResponse>('/api/v1/resolve', {
      method: 'POST',
      body: JSON.stringify({ ids: chunk }),
    })
    if (Array.isArray(data.resolved)) resolved.push(...data.resolved)
    for (const [id, r] of Object.entries(data.results ?? {})) resolved.push({ ...r, id })
    missing.push(...(data.missing ?? []))
  }
  return { resolved, missing }
}

// ── Users search ──────────────────────────────────────────────────────────────

export async function searchUsers(
  query: string,
): Promise<Array<{ id: string; name: string; email: string; already_granted?: boolean }>> {
  const qs = new URLSearchParams({ search: query })
  const { data } = await request<
    | Array<{ id: string; name: string; email: string; already_granted?: boolean }>
    | { users: Array<{ id: string; name: string; email: string; already_granted?: boolean }> }
  >(`/api/v1/users?${qs.toString()}`)
  if (Array.isArray(data)) return data
  return (data as { users: Array<{ id: string; name: string; email: string; already_granted?: boolean }> }).users ?? []
}

// ── Probe reorder permission (HEAD) ──────────────────────────────────────────

export async function probeReorderPermission(listId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/${listId}/items/reorder`, { method: 'HEAD' })
    return res.status !== 403
  } catch {
    // Network error → assume allowed (fail-open)
    return true
  }
}

// ── Helper: unwrap paged response ────────────────────────────────────────────

export function unwrapItems<T>(response: PagedResponse<T>): T[] {
  return response.data ?? response.items ?? []
}

export function unwrapCursor(response: PagedResponse<unknown>): string | null {
  return (
    response.next_cursor ??
    response.page?.nextCursor ??
    null
  )
}
