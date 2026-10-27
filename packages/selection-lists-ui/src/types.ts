// ── Domain types ──────────────────────────────────────────────────────────────

export interface SelectionList {
  id: string
  key: string
  name: string
  is_machine: boolean
  status: 'active' | 'archived'
  item_count: number
  source_locale: string
  created_at: string
  updated_at: string
}

export interface SelectionListItem {
  id: string
  list_id: string
  code: string
  label: string
  is_machine: boolean
  status: 'active' | 'archived'
  sort_order: number
  source_hash: string
  /** The locale `label` was resolved in (4.1.0 service); absent from older mocks. */
  resolved_locale?: string
}

/**
 * One ceiling in the quota response. Mirrors the contract's
 * `SelectionListQuotaEntry`; `quota-envelope.test.tsx` binds it to the generated
 * `@fuzeone/selection-list-client` type in both directions (a tsc error on drift).
 */
export interface QuotaScope {
  scope: 'org_lists' | 'user_lists' | 'list_items' | 'list_locales'
  /** What the ceiling is counted per. */
  applies_to: 'organization' | 'user' | 'list'
  /** `null` for per-list ceilings (usage depends on which list is asked about). */
  current: number | null
  limit: number
}

/**
 * `GET /v1/selection-lists/quota` — the contract's `SelectionListQuotaStatus`,
 * returned by `getQuota()` exactly as the service sends it. One entry per scope
 * under `quotas` (not `scopes`).
 */
export interface QuotaStatus {
  organization_id: string
  quotas: QuotaScope[]
}

/**
 * One row of the workbench's locale index — a VIEW MODEL built by `getLocaleIndex`
 * from the contract's `TranslationLocaleStatus` (`completeness_pct`,
 * `machine_translated`, `source_changed`). `total` is exact; `translated` is
 * recovered from the rounded percentage; `machine_count` / `stale_count` are 0 or
 * 1 (the contract carries a flag per locale, not a count — the UI shows the flag).
 */
export interface LocaleIndexEntry {
  locale: string
  is_source: boolean
  translated: number
  total: number
  machine_count: number
  stale_count: number
}

export interface LocaleIndexResponse {
  locales: LocaleIndexEntry[]
  quota_exceeded?: boolean
}

export interface TranslationEntry {
  item_id: string
  locale: string
  label: string
  is_machine: boolean
  source_hash: string
  source_hash_current: string
}

export interface LocaleEditorResponse {
  locale: string
  translations: TranslationEntry[]
}

export interface AccessGrant {
  user_id: string
  role: 'list-owner' | 'list-translator' | 'list-viewer'
  granted_by: string
  granted_at: string
  is_sole_owner: boolean
}

export interface ResolvedItem {
  id: string
  label: string
  locale: string
  is_machine: boolean
  status: 'active' | 'archived'
}

/** `POST /v1/resolve` as the service sends it (contract `ResolveResponse`). */
export interface ResolveWireResponse {
  results?: Record<string, Omit<ResolvedItem, 'id'>>
  /** Legacy array form; tolerated, never sent by the contract. */
  resolved?: ResolvedItem[]
  missing?: string[]
}

/** `POST /v1/resolve` normalised for the UI: every resolution carries its own `id`. */
export interface ResolveResponse {
  resolved: ResolvedItem[]
  missing: string[]
}

// ── API response envelopes ────────────────────────────────────────────────────

export interface PagedResponse<T> {
  data?: T[]
  items?: T[]
  next_cursor?: string | null
  page?: { nextCursor?: string | null; hasMore?: boolean }
  total?: number
}

// ── API error shapes ──────────────────────────────────────────────────────────

export interface ApiError {
  code?: string
  message?: string
  scope?: string
  current?: number
  limit?: number
}

/** Mirrors contract `SelectionListAutofillResult`. */
export interface AutofillResult {
  locale: string
  source_locale: string
  list_translated: boolean
  items_translated: number
  items_skipped: number
}
