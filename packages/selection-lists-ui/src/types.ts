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
}

export interface QuotaScope {
  scope: 'org_lists' | 'user_lists' | 'list_items' | 'list_locales'
  current: number | null
  limit: number
}

export interface QuotaStatus {
  scopes: QuotaScope[]
}

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
