/**
 * Wire types for the selection-list-service.
 *
 * Hand-authored from `services/selection-list-service/openapi.yaml` v1.0.0 and
 * kept in lockstep with it. The spec is the source of truth: when it changes,
 * `contract-designer` amends the spec, bumps `info.version`, and updates this
 * file in the same PR. Nothing here may describe a shape the spec does not.
 *
 * Field casing mirrors the contract exactly: resource payloads are `snake_case`
 * (they mirror storage), while the pagination envelope is `camelCase` because
 * it is fixed verbatim by `governance/pagination-standard.md` and is identical
 * across every Fuze service.
 */

/* -------------------------------------------------------------------------- */
/* Identifiers                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * TypeID strings. These are deliberately plain `string` aliases rather than
 * branded types: ids are **opaque past their prefix**, so a consumer must never
 * parse, slice, or reconstruct one, and a brand would tempt exactly that. The
 * alias exists to document intent at call sites.
 */
export type SelectionListId = string
/** `sli_`-prefixed item id — the value consumers persist in their own rows. */
export type SelectionListItemId = string
/** `org_`-prefixed organization id. */
export type OrganizationId = string
/** `usr_`-prefixed user id. */
export type UserId = string

/** Wire prefixes minted by this service. */
export const SELECTION_LIST_ID_PREFIX = 'sl_'
/** Wire prefix for selection-list items. */
export const SELECTION_LIST_ITEM_ID_PREFIX = 'sli_'

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The supported locales, fixed by `i18n.languages.json`. Widening this set is a
 * contract change, not a client change.
 */
export const LOCALES = [
  'en',
  'es',
  'fr',
  'de',
  'pt',
  'ru',
  'zh',
  'ja',
  'hi',
  'ar',
  'he',
] as const

/** A supported BCP-47 language code. */
export type Locale = (typeof LOCALES)[number]

/** Lifecycle state. Archived rows are hidden from pickers but still resolve. */
export type LifecycleStatus = 'active' | 'archived'

/** Lifecycle filter accepted by the collection endpoints. */
export type StatusFilter = LifecycleStatus | 'all'

/** A ReBAC role held on one selection-list instance. Roles do not stack. */
export type SelectionListAccessRole =
  | 'list-owner'
  | 'list-editor'
  | 'list-contributor'
  | 'list-translator'
  | 'list-viewer'

/** The ceiling a `QUOTA_EXCEEDED` decision was made against. */
export type QuotaScope = 'org_lists' | 'user_lists' | 'list_items' | 'list_locales'

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

/** Cursor pagination envelope (`governance/pagination-standard.md` §1). */
export interface Page {
  /** Opaque cursor for the next page; `null` on the last page. Echo it back unmodified. */
  nextCursor: string | null
  /** Whether a further page exists. */
  hasMore: boolean
  /** Total rows matching the filter, when cheap enough to compute. */
  total?: number
}

/** A page of `T` plus its cursor envelope. */
export interface Paged<T> {
  /** The rows on this page. */
  items: T[]
  /** The cursor envelope for walking to the next page. */
  page: Page
}

/** Query parameters common to every cursor-paginated collection. */
export interface PageParams {
  /** Page size, 1–200. Clamped to 200 server-side. Defaults to 50. */
  limit?: number
  /** Opaque cursor from the previous page's `page.nextCursor`. */
  cursor?: string
}

/* -------------------------------------------------------------------------- */
/* Selection lists                                                             */
/* -------------------------------------------------------------------------- */

/** A selection list, with its text resolved for one locale. */
export interface SelectionList {
  /** The `sl_`-prefixed list id. */
  id: SelectionListId
  /** Owning organization. */
  organization_id: OrganizationId
  /** Org-unique stable slug, e.g. `countries`. */
  key: string
  /** The locale the list is authored in; the root of the fallback chain. */
  source_locale: Locale
  /** Lifecycle state. */
  status: LifecycleStatus
  /** Display name in the resolved locale. Never null. */
  name: string
  /** Optional longer description in the resolved locale. */
  description?: string | null
  /** The locale `name`/`description` actually came from. */
  resolved_locale: Locale
  /** Whether the resolved text was machine-translated. */
  is_machine: boolean
  /** Number of non-archived items, when the server includes it. */
  item_count?: number
  /** The user who created the list. */
  created_by: UserId
  /** RFC 3339 creation timestamp. */
  created_at: string
  /** RFC 3339 last-modification timestamp. */
  updated_at: string
}

/** Body for `POST /v1/selection-lists`. Carries no `id` — the service mints it. */
export interface SelectionListCreate {
  /** Org-unique stable slug. */
  key: string
  /** Authoring locale. Defaults to `en` server-side. */
  source_locale?: Locale
  /** List name in `source_locale`; seeds the source translation. */
  name: string
  /** Optional description in `source_locale`. */
  description?: string
}

/** Body for `PATCH /v1/selection-lists/{listId}`. At least one field required. */
export interface SelectionListUpdate {
  /** New org-unique slug. */
  key?: string
  /** New authoring locale. Does not re-translate anything. */
  source_locale?: Locale
  /** Set to `active` to un-archive, or `archived` to archive. */
  status?: LifecycleStatus
  /** New name, written to the `source_locale` translation. */
  name?: string
  /** New description for the `source_locale`; `null` clears it. */
  description?: string | null
}

/** Query parameters for `GET /v1/selection-lists`. */
export interface ListSelectionListsParams extends PageParams {
  /** Lifecycle filter. Defaults to `active`. */
  status?: StatusFilter
  /** Preferred locale for the resolved `name`/`description`. */
  locale?: Locale
  /** Exact-match filter on the org-unique list `key`. */
  key?: string
}

/* -------------------------------------------------------------------------- */
/* Items                                                                       */
/* -------------------------------------------------------------------------- */

/** One item of a selection list, with its text resolved for one locale. */
export interface SelectionListItem {
  /** The `sli_`-prefixed item id — persist this, never `code`. */
  id: SelectionListItemId
  /** The list this item belongs to. */
  list_id: SelectionListId
  /** Immutable interop key, e.g. `US`. Never displayed to end users. */
  code: string
  /** Display position, ascending, gapped by 100. */
  sort_order: number
  /** Lifecycle state. */
  status: LifecycleStatus
  /** Display text in the resolved locale. Never null. */
  label: string
  /** Optional helper text in the resolved locale. */
  description?: string | null
  /** The locale `label`/`description` actually came from. */
  resolved_locale: Locale
  /** Whether the resolved text was machine-translated. */
  is_machine: boolean
  /** The user who created the item. */
  created_by: UserId
  /** RFC 3339 creation timestamp. */
  created_at: string
  /** RFC 3339 last-modification timestamp. */
  updated_at: string
}

/** Body for `POST /v1/selection-lists/{listId}/items`. Carries no `id`. */
export interface SelectionListItemCreate {
  /** Immutable, list-unique interop key. */
  code: string
  /** Label in the list's `source_locale`. */
  label: string
  /** Optional helper text in the list's `source_locale`. */
  description?: string
  /** Explicit position. Omit to append at `max(sort_order) + 100`. */
  sort_order?: number
}

/**
 * Body for `PATCH /v1/selection-lists/{listId}/items/{itemId}`.
 *
 * `code` is absent by design — it is immutable after create, and the service
 * rejects unknown properties, so sending it is a `400 VALIDATION_ERROR` rather
 * than a silent no-op.
 */
export interface SelectionListItemUpdate {
  /** New label, written to the `source_locale` translation. */
  label?: string
  /** New helper text for the `source_locale`; `null` clears it. */
  description?: string | null
  /** New display position. Prefer `reorderItems` for bulk moves. */
  sort_order?: number
  /** Set to `active` to un-archive, or `archived` to archive. */
  status?: LifecycleStatus
}

/** Query parameters for `GET /v1/selection-lists/{listId}/items`. */
export interface ListSelectionListItemsParams extends PageParams {
  /** Lifecycle filter. Defaults to `active` so pickers never offer retired choices. */
  status?: StatusFilter
  /** Preferred locale for the resolved `label`/`description`. */
  locale?: Locale
}

/** Response of `PUT /v1/selection-lists/{listId}/items/reorder`. */
export interface SelectionListItemReorderResult {
  /** Every non-archived item, in its new order. */
  items: SelectionListItem[]
}

/* -------------------------------------------------------------------------- */
/* Translations                                                                */
/* -------------------------------------------------------------------------- */

/** A stored list translation for one locale. */
export interface SelectionListTranslation {
  /** The translated list. */
  list_id: SelectionListId
  /** The locale this row holds. */
  locale: Locale
  /** Translated list name. */
  name: string
  /** Translated description, if any. */
  description?: string | null
  /** Hash of the source text this came from; a mismatch marks it stale. */
  source_hash?: string | null
  /** Whether this row was machine-translated. */
  is_machine: boolean
  /** RFC 3339 timestamp of the last write. */
  updated_at: string
}

/** A stored item translation for one locale. */
export interface SelectionListItemTranslation {
  /** The translated item. */
  item_id: SelectionListItemId
  /** The locale this row holds. */
  locale: Locale
  /** Translated item label. */
  label: string
  /** Translated helper text, if any. */
  description?: string | null
  /** Hash of the source label this came from; a mismatch marks it stale. */
  source_hash?: string | null
  /** Whether this row was machine-translated. */
  is_machine: boolean
  /** RFC 3339 timestamp of the last write. */
  updated_at: string
}

/** Human-authored list text for one locale. */
export interface SelectionListTranslationUpsert {
  /** Translated list name. */
  name: string
  /** Translated description; `null` clears it. */
  description?: string | null
}

/** Human-authored item text for one locale. */
export interface SelectionListItemTranslationUpsert {
  /** Translated item label. */
  label: string
  /** Translated helper text; `null` clears it. */
  description?: string | null
}

/** Optional scoping for a machine-translation run. */
export interface SelectionListAutofillRequest {
  /**
   * Also refresh rows that already exist and were themselves machine-produced.
   * Human translations are never overwritten, regardless of this flag.
   */
  overwrite_machine?: boolean
  /** Restrict the run to these items. Omit to cover the whole list. */
  item_ids?: SelectionListItemId[]
}

/** What a machine-translation run wrote and what it left alone. */
export interface SelectionListAutofillResult {
  /** The target locale. */
  locale: Locale
  /** The locale translated from. */
  source_locale: Locale
  /** Whether the list's own name/description was written. */
  list_translated: boolean
  /** Count of item translations written. */
  items_translated: number
  /** Count of items skipped because a fresh human translation existed. */
  items_skipped: number
}

/* -------------------------------------------------------------------------- */
/* Access control                                                              */
/* -------------------------------------------------------------------------- */

/** One user's role on one selection list. */
export interface SelectionListAccessGrant {
  /** The list the grant is on. */
  list_id: SelectionListId
  /** The user holding the role. */
  user_id: UserId
  /** The single role held. */
  role: SelectionListAccessRole
  /** Who granted it. */
  granted_by: UserId
  /** RFC 3339 timestamp of the original grant. */
  granted_at: string
  /** RFC 3339 timestamp of the last role change. */
  updated_at: string
}

/** Body for `PUT /v1/selection-lists/{listId}/access/{userId}`. */
export interface SelectionListAccessUpsert {
  /** The single role to grant. */
  role: SelectionListAccessRole
}

/* -------------------------------------------------------------------------- */
/* Quota                                                                       */
/* -------------------------------------------------------------------------- */

/** Current usage against one ceiling. */
export interface SelectionListQuotaEntry {
  /** Which ceiling this entry describes. */
  scope: QuotaScope
  /** What the ceiling is counted per. */
  applies_to: 'organization' | 'user' | 'list'
  /** The ceiling itself. */
  limit: number
  /** Current usage, or `null` for per-list ceilings. */
  current: number | null
}

/** Quota ceilings and usage for the caller's organization. */
export interface SelectionListQuotaStatus {
  /** The organization the quotas apply to. */
  organization_id: OrganizationId
  /** One entry per quota scope. Fixed set of four. */
  quotas: SelectionListQuotaEntry[]
}

/* -------------------------------------------------------------------------- */
/* Resolve (hot path)                                                          */
/* -------------------------------------------------------------------------- */

/** Body for `POST /v1/resolve`. */
export interface ResolveRequest {
  /** Item ids to resolve. Bounded at 500 per call. */
  ids: SelectionListItemId[]
  /** Preferred locale for the returned labels. */
  locale?: Locale
}

/** The minimal resolution of one item id. */
export interface ResolvedSelectionListItem {
  /** Display text in the resolved locale. Never null. */
  label: string
  /** The locale the label came from. */
  locale: Locale
  /** Whether the label was machine-translated. */
  is_machine: boolean
  /** Lifecycle state — `archived` items still resolve; style them as retired. */
  status: LifecycleStatus
}

/**
 * Response of `POST /v1/resolve`.
 *
 * `results` and `missing` together always account for the whole request — an id
 * is never silently dropped, so a caller can always distinguish "no label" from
 * "no such item".
 */
export interface ResolveResponse {
  /** Resolutions keyed by the requested id. */
  results: Record<SelectionListItemId, ResolvedSelectionListItem>
  /** Requested ids that do not exist (never created, or purged). */
  missing: SelectionListItemId[]
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/** Stable, machine-readable error code. Branch on this, never on `message`. */
export type SelectionListErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'QUOTA_EXCEEDED'

/** One field-level validation problem. */
export interface SelectionListErrorDetail {
  /** JSON pointer to the offending property. */
  field: string
  /** What is wrong with it. */
  message: string
}

/** The single error body shape returned by every non-2xx response. */
export interface SelectionListErrorBody {
  /** Machine-readable code. */
  code: SelectionListErrorCode
  /** Human-readable explanation. Not for programmatic branching. */
  message: string
  /** Which ceiling was hit. Present only on `QUOTA_EXCEEDED`. */
  scope?: QuotaScope
  /** The ceiling. Present only on `QUOTA_EXCEEDED`. */
  limit?: number
  /** Usage at the time of refusal. Present only on `QUOTA_EXCEEDED`. */
  current?: number
  /** Field-level problems. Present only on `VALIDATION_ERROR`. */
  details?: SelectionListErrorDetail[]
}
