/**
 * Selection Lists API client — same-origin /api/v1 base.
 * No absolute host — works identically under local TLS and prod ingress.
 */

import type {
  Locale,
  TranslationLocaleStatus,
} from '@fuzeone/selection-list-client'
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
  LocaleIndexEntry,
  TranslationEntry,
} from './types'

const BASE = '/api/v1/selection-lists'

/**
 * The same-origin list collection path. Exported (not from the package index) for
 * `shared-lists/core/api`, so the shared-lists wrappers build their URLs from the
 * one constant and can never drift to a different base.
 */
export const SELECTION_LISTS_API_BASE = BASE

// ── Authentication ────────────────────────────────────────────────────────────
//
// This package is host-agnostic: it never reads storage and never knows which
// organization is active. The HOST SHELL injects both, once, via
// `configureSelectionListsAuth` (see frontend/src/lib/selectionListsAuth.ts).
//
//  - `getOrgToken` -> the short-lived ORG-SCOPED token (Security API
//    `POST /api/organizations/:id/session-token`). selection-list-service derives
//    the org ONLY from a verified claim in this token, so every
//    selection-list / resolve call must carry it. Resolves to null when there is
//    no active org (Personal context): the request is then sent without a
//    credential and the service answers 401, rendered by the flows' error state.
//  - `getSessionToken` -> the plain session token, for the one call that goes to
//    the host backend rather than to selection-list-service (user search).
//
// Nothing configured -> no Authorization header (unchanged behaviour, and what
// the package's own tests rely on).
export interface SelectionListsAuth {
  getOrgToken?: () => Promise<string | null | undefined> | string | null | undefined
  getSessionToken?: () => string | null | undefined
}

let auth: SelectionListsAuth = {}

/** Called by the host shell. Pass `undefined` to clear (e.g. on unmount). */
export function configureSelectionListsAuth(next?: SelectionListsAuth): void {
  auth = next ?? {}
}

// Supplied by older hosts so switching accounts changes the bearer token on the
// next request. Superseded by configureSelectionListsAuth; kept so an existing
// host keeps working. The package must not inspect localStorage itself.
let legacyAuthTokenProvider: (() => string | null) | undefined
export function setSelectionListAuthTokenProvider(provider: () => string | null): void {
  legacyAuthTokenProvider = provider
}

type TokenKind = 'org' | 'session'

async function bearerFor(kind: TokenKind): Promise<string | null> {
  try {
    const token = kind === 'org' ? await auth.getOrgToken?.() : auth.getSessionToken?.()
    if (token) return token
    // Legacy hook (setSelectionListAuthTokenProvider): one plain bearer for
    // every call. Only consulted when the matching org-aware hook is not
    // configured at all, so a host that configured configureSelectionListsAuth
    // never falls back to a session token that names no organization.
    const configured = kind === 'org' ? auth.getOrgToken : auth.getSessionToken
    return configured ? null : legacyAuthTokenProvider?.() || null
  } catch {
    // A failed token resolution must not throw into render: send no credential
    // and let the service's 401 surface through the normal error state.
    return null
  }
}

/**
 * The one authenticated, same-origin request path (org-scoped bearer, error
 * decoration). Exported (not from the package index) so `shared-lists/core/api`
 * rides the SAME auth wiring instead of growing a second one.
 */
export async function request<T>(
  url: string,
  options: RequestInit = {},
  tokenKind: TokenKind = 'org',
): Promise<{ data: T; status: number }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string> | undefined) ?? {}),
  }
  const token = await bearerFor(tokenKind)
  if (token && !headers['Authorization']) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(url, { ...options, headers })

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
  params: {
    cursor?: string | null
    /**
     * The service accepts `active` (the default) and `archived`; anything else,
     * including the openapi's documented `all`, is a 400 (routes/items.ts). A
     * caller wanting both reads the two statuses and combines them.
     */
    status?: 'active' | 'archived'
    /** Page size (service default 50, max 200). */
    limit?: number
    /** Resolve labels in this locale (falls back along the service's chain). */
    locale?: string
    signal?: AbortSignal
  } = {},
): Promise<PagedResponse<SelectionListItem>> {
  const qs = new URLSearchParams()
  if (params.limit !== undefined) qs.set('limit', String(params.limit))
  if (params.cursor) qs.set('cursor', params.cursor)
  if (params.status) qs.set('status', params.status)
  if (params.locale) qs.set('locale', params.locale)
  const url = `${BASE}/${listId}/items${qs.toString() ? '?' + qs.toString() : ''}`
  const { data } = await request<PagedResponse<SelectionListItem>>(url, {
    signal: params.signal,
  })
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

/**
 * `GET /v1/selection-lists/quota`, returned exactly as the service sends it: the
 * contract's `SelectionListQuotaStatus` = `{ organization_id, quotas: [{ scope,
 * applies_to, limit, current }] }`. There is no second view model to drift from
 * the wire; the 4.0.0 UI read `scopes`, which the service has never sent. A body
 * that is not this shape is rejected by the readers (see the management flow's
 * `isQuotaStatus`), which treat the advisory quota read as unavailable.
 */
export async function getQuota(): Promise<QuotaStatus> {
  const { data } = await request<QuotaStatus>(`${BASE}/quota`)
  return data
}

// ── Translations ──────────────────────────────────────────────────────────────

/**
 * The locales a list can be translated into — the contract's `Locale` enum
 * (`satisfies` makes a value outside it a tsc error; the api test pins the set).
 * The service lists only locales that already HAVE a list translation, so the
 * workbench adds the rest as untranslated rows ("Start" / "Autofill").
 */
const SUPPORTED_LOCALES = [
  'en', 'es', 'fr', 'de', 'pt', 'ru', 'zh', 'ja', 'hi', 'ar', 'he',
] as const satisfies readonly Locale[]

/** Every page of a list's ACTIVE items resolved in `locale` (`GET …/items?locale=`). */
async function readActiveItems(
  listId: string,
  locale: string,
): Promise<SelectionListItem[]> {
  const rows: SelectionListItem[] = []
  let cursor: string | null = null
  for (let page = 0; page < 50; page += 1) {
    const res: PagedResponse<SelectionListItem> = await listItems(listId, {
      status: 'active',
      locale,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    })
    rows.push(...unwrapItems(res))
    cursor = unwrapCursor(res)
    if (!cursor) return rows
  }
  throw new Error('items: page bound reached before the end of the list')
}

/**
 * The workbench's locale index, built from what the service really answers:
 * `GET /:listId/translations` is a top-level `TranslationLocaleStatus[]`
 * (`locale`, `completeness_pct`, `machine_translated`, `source_changed`; the
 * source locale and locales with no list translation are absent) and the list
 * supplies `source_locale` and `item_count`.
 *
 * What the contract does NOT carry is derived, and is as approximate as the
 * contract is: `total` is exact (the list + its active items); `translated` is
 * recovered from the rounded percentage; `machine_count` / `stale_count` are 0
 * or 1 — the contract reports a FLAG per locale, not a count, and the UI shows
 * the flag. `quota_exceeded` is not on the wire either: it is derived from
 * `GET /quota` (`list_locales` ceiling vs the locales this list already has);
 * the service still answers a write past it with 403 `QUOTA_EXCEEDED`.
 */
export async function getLocaleIndex(listId: string): Promise<LocaleIndexResponse> {
  const [list, statuses, quota] = await Promise.all([
    getSelectionList(listId),
    request<TranslationLocaleStatus[]>(`${BASE}/${listId}/translations`).then(r => r.data),
    // Best effort: an unreadable quota (403 without `read_quota`) never blocks the index.
    getQuota().catch(() => undefined),
  ])
  if (!Array.isArray(statuses)) {
    throw new TypeError('GET …/translations did not answer an array')
  }
  const source = list.source_locale
  const total = 1 + (list.item_count ?? 0)
  const byLocale = new Map(statuses.map(s => [s.locale as string, s]))
  const locales: LocaleIndexEntry[] = [
    { locale: source, is_source: true, translated: total, total, machine_count: 0, stale_count: 0 },
  ]
  const wanted: string[] = [...SUPPORTED_LOCALES]
  for (const extra of byLocale.keys()) if (!wanted.includes(extra)) wanted.push(extra)
  for (const locale of wanted) {
    if (locale === source) continue
    const status = byLocale.get(locale)
    locales.push({
      locale,
      is_source: false,
      total,
      translated: status
        ? Math.min(total, Math.round((status.completeness_pct * total) / 100))
        : 0,
      machine_count: status?.machine_translated ? 1 : 0,
      stale_count: status?.source_changed ? 1 : 0,
    })
  }
  // `list_locales` counts the locales with a list-level translation row, the source
  // included; a locale the list already has is an update and is never refused.
  const limit = quota?.quotas?.find(q => q.scope === 'list_locales')?.limit
  const quotaExceeded = typeof limit === 'number' && statuses.length + 1 >= limit
  return { locales, quota_exceeded: quotaExceeded }
}

/**
 * One locale's rows for the writable editor. The service has no
 * `GET …/translations/{locale}`: the text is read with `GET …/items?locale=`,
 * which FALLS BACK along the locale chain for an item with no text in `locale`
 * (reported as `resolved_locale`). Such a row is MISSING here (empty label), not
 * a translation — otherwise saving the form would write the source text as the
 * translation. The list endpoint carries no per-item staleness (that needs one
 * `…/items/{id}/translations` read per item), so rows are never marked stale.
 */
export async function getLocaleEditor(
  listId: string,
  locale: string,
): Promise<LocaleEditorResponse> {
  const items = await readActiveItems(listId, locale)
  const translations: TranslationEntry[] = items.map(item => {
    const translated = item.resolved_locale === undefined || item.resolved_locale === locale
    const hash = item.source_hash ?? ''
    return {
      item_id: item.id,
      locale,
      label: translated ? item.label : '',
      is_machine: translated && item.is_machine,
      source_hash: hash,
      source_hash_current: hash,
    }
  })
  return { locale, translations }
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
  >(`/api/v1/users?${qs.toString()}`, {}, 'session')
  if (Array.isArray(data)) return data
  return (data as { users: Array<{ id: string; name: string; email: string; already_granted?: boolean }> }).users ?? []
}

// ── Probe reorder permission (HEAD) ──────────────────────────────────────────

export async function probeReorderPermission(listId: string): Promise<boolean> {
  try {
    const token = await bearerFor('org')
    const res = await fetch(`${BASE}/${listId}/items/reorder`, {
      method: 'HEAD',
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    })
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
