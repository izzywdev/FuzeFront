import { SelectionListApiError } from './errors'
import type {
  ListSelectionListItemsParams,
  ListSelectionListsParams,
  Locale,
  PageParams,
  Paged,
  ResolveResponse,
  SelectionList,
  SelectionListAccessGrant,
  SelectionListAccessRole,
  SelectionListAutofillRequest,
  SelectionListAutofillResult,
  SelectionListCreate,
  SelectionListErrorBody,
  SelectionListId,
  SelectionListItem,
  SelectionListItemCreate,
  SelectionListItemId,
  SelectionListItemReorderResult,
  SelectionListItemTranslation,
  SelectionListItemTranslationUpsert,
  SelectionListItemUpdate,
  SelectionListQuotaStatus,
  SelectionListTranslation,
  SelectionListTranslationUpsert,
  SelectionListUpdate,
  UserId,
} from './types'

/** A token, or a function that produces one (so short-lived tokens can refresh). */
export type TokenProvider =
  | string
  | (() => string | undefined | Promise<string | undefined>)

/** Constructor options for {@link SelectionListClient}. */
export interface SelectionListClientOptions {
  /**
   * Base URL of the service.
   *
   * In the browser this MUST be a **same-origin** path (`'/api/selection-lists'`),
   * never an absolute host — the shell is served over TLS behind an ingress, and
   * a hard-coded host breaks the moment the environment changes and triggers
   * mixed-content blocks under TLS (see CLAUDE.md).
   */
  baseUrl: string
  /**
   * Bearer token, or a provider for one. Optional: `resolveIds` may be called
   * unauthenticated by a trusted in-cluster caller that has already authorized
   * its own end user.
   */
  token?: TokenProvider
  /** Injected `fetch`, for tests or a non-global runtime. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch
  /** Locale applied to every request that does not pass its own. */
  defaultLocale?: Locale
  /** Extra headers merged into every request (tracing, tenant hints). */
  headers?: Record<string, string>
}

interface RequestOptions {
  method: string
  path: string
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  /** Set when the endpoint may legitimately answer `204 No Content`. */
  allowEmpty?: boolean
  signal?: AbortSignal
}

/**
 * Typed client for the FuzeFront selection-list-service.
 *
 * One method per endpoint of `services/selection-list-service/openapi.yaml`
 * v1.0.0, plus {@link SelectionListClient.paginate} for walking a cursor.
 * Zero runtime dependencies — it uses the platform `fetch`.
 */
export class SelectionListClient {
  private readonly baseUrl: string
  private readonly token: TokenProvider | undefined
  private readonly fetchImpl: typeof fetch
  private readonly defaultLocale: Locale | undefined
  private readonly extraHeaders: Record<string, string>

  constructor(options: SelectionListClientOptions) {
    if (!options.baseUrl) {
      throw new Error('SelectionListClient: `baseUrl` is required')
    }
    // Trailing slashes are stripped so callers can pass either form without
    // producing `//v1/...`, which some ingresses normalise and others 404 on.
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.token = options.token
    const resolvedFetch = options.fetch ?? globalThis.fetch
    if (typeof resolvedFetch !== 'function') {
      throw new Error(
        'SelectionListClient: no `fetch` available — pass one via options.fetch'
      )
    }
    this.fetchImpl = resolvedFetch.bind(globalThis)
    this.defaultLocale = options.defaultLocale
    this.extraHeaders = options.headers ?? {}
  }

  /* ---------------------------------------------------------------------- */
  /* Lists                                                                   */
  /* ---------------------------------------------------------------------- */

  /** `GET /v1/selection-lists` — a page of lists in the caller's org. */
  async getLists(
    params: ListSelectionListsParams = {},
    signal?: AbortSignal
  ): Promise<Paged<SelectionList>> {
    return this.request<Paged<SelectionList>>({
      method: 'GET',
      path: '/v1/selection-lists',
      query: {
        limit: params.limit,
        cursor: params.cursor,
        status: params.status,
        key: params.key,
        locale: params.locale ?? this.defaultLocale,
      },
      signal,
    })
  }

  /** `POST /v1/selection-lists` — create a list. The service mints the id. */
  async createList(
    body: SelectionListCreate,
    signal?: AbortSignal
  ): Promise<SelectionList> {
    return this.request<SelectionList>({
      method: 'POST',
      path: '/v1/selection-lists',
      body,
      signal,
    })
  }

  /** `GET /v1/selection-lists/{listId}` — one list, text resolved for `locale`. */
  async getList(
    listId: SelectionListId,
    locale?: Locale,
    signal?: AbortSignal
  ): Promise<SelectionList> {
    return this.request<SelectionList>({
      method: 'GET',
      path: `/v1/selection-lists/${encodeURIComponent(listId)}`,
      query: { locale: locale ?? this.defaultLocale },
      signal,
    })
  }

  /** `PATCH /v1/selection-lists/{listId}` — partial update. */
  async updateList(
    listId: SelectionListId,
    body: SelectionListUpdate,
    signal?: AbortSignal
  ): Promise<SelectionList> {
    return this.request<SelectionList>({
      method: 'PATCH',
      path: `/v1/selection-lists/${encodeURIComponent(listId)}`,
      body,
      signal,
    })
  }

  /** `POST /v1/selection-lists/{listId}/archive` — archive a list. Idempotent. */
  async archiveList(
    listId: SelectionListId,
    signal?: AbortSignal
  ): Promise<SelectionList> {
    return this.request<SelectionList>({
      method: 'POST',
      path: `/v1/selection-lists/${encodeURIComponent(listId)}/archive`,
      signal,
    })
  }

  /**
   * `DELETE /v1/selection-lists/{listId}` — archives by default.
   *
   * Pass `purge: true` only deliberately: it is irreversible and permanently
   * breaks every consumer row holding one of the list's item ids. Returns the
   * archived list, or `null` when purged (the service answers `204`).
   */
  async deleteList(
    listId: SelectionListId,
    options: { purge?: boolean } = {},
    signal?: AbortSignal
  ): Promise<SelectionList | null> {
    return this.request<SelectionList | null>({
      method: 'DELETE',
      path: `/v1/selection-lists/${encodeURIComponent(listId)}`,
      query: { purge: options.purge },
      allowEmpty: true,
      signal,
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Items                                                                   */
  /* ---------------------------------------------------------------------- */

  /** `GET /v1/selection-lists/{listId}/items` — a page of items, in `sort_order`. */
  async getItems(
    listId: SelectionListId,
    params: ListSelectionListItemsParams = {},
    signal?: AbortSignal
  ): Promise<Paged<SelectionListItem>> {
    return this.request<Paged<SelectionListItem>>({
      method: 'GET',
      path: `/v1/selection-lists/${encodeURIComponent(listId)}/items`,
      query: {
        limit: params.limit,
        cursor: params.cursor,
        status: params.status,
        locale: params.locale ?? this.defaultLocale,
      },
      signal,
    })
  }

  /** `POST /v1/selection-lists/{listId}/items` — add an item. */
  async createItem(
    listId: SelectionListId,
    body: SelectionListItemCreate,
    signal?: AbortSignal
  ): Promise<SelectionListItem> {
    return this.request<SelectionListItem>({
      method: 'POST',
      path: `/v1/selection-lists/${encodeURIComponent(listId)}/items`,
      body,
      signal,
    })
  }

  /**
   * `PATCH /v1/selection-lists/{listId}/items/{itemId}` — partial update.
   *
   * `code` is not updatable: it is immutable after create, so the type omits it
   * and the service rejects it.
   */
  async updateItem(
    listId: SelectionListId,
    itemId: SelectionListItemId,
    body: SelectionListItemUpdate,
    signal?: AbortSignal
  ): Promise<SelectionListItem> {
    return this.request<SelectionListItem>({
      method: 'PATCH',
      path: `/v1/selection-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`,
      body,
      signal,
    })
  }

  /** `POST /v1/selection-lists/{listId}/items/{itemId}/archive` — idempotent archive. */
  async archiveItem(
    listId: SelectionListId,
    itemId: SelectionListItemId,
    signal?: AbortSignal
  ): Promise<SelectionListItem> {
    return this.request<SelectionListItem>({
      method: 'POST',
      path: `/v1/selection-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}/archive`,
      signal,
    })
  }

  /**
   * `DELETE /v1/selection-lists/{listId}/items/{itemId}` — archives by default.
   *
   * An archived item still resolves, so consumer rows keep rendering a label.
   * A purged one does not — it becomes a `missing` entry on every resolve.
   * Returns the archived item, or `null` when purged.
   */
  async deleteItem(
    listId: SelectionListId,
    itemId: SelectionListItemId,
    options: { purge?: boolean } = {},
    signal?: AbortSignal
  ): Promise<SelectionListItem | null> {
    return this.request<SelectionListItem | null>({
      method: 'DELETE',
      path: `/v1/selection-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`,
      query: { purge: options.purge },
      allowEmpty: true,
      signal,
    })
  }

  /**
   * `PUT /v1/selection-lists/{listId}/items/reorder` — set the whole order.
   *
   * `itemIds` must be a permutation of exactly the list's non-archived items.
   * The whole-collection form is what makes the reorder atomic; a sparse patch
   * has no unambiguous meaning when two editors drag at once.
   */
  async reorderItems(
    listId: SelectionListId,
    itemIds: SelectionListItemId[],
    signal?: AbortSignal
  ): Promise<SelectionListItemReorderResult> {
    return this.request<SelectionListItemReorderResult>({
      method: 'PUT',
      path: `/v1/selection-lists/${encodeURIComponent(listId)}/items/reorder`,
      body: { item_ids: itemIds },
      signal,
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Translations                                                            */
  /* ---------------------------------------------------------------------- */

  /** `PUT /v1/selection-lists/{listId}/translations/{locale}` — human list text. */
  async upsertListTranslation(
    listId: SelectionListId,
    locale: Locale,
    body: SelectionListTranslationUpsert,
    signal?: AbortSignal
  ): Promise<SelectionListTranslation> {
    return this.request<SelectionListTranslation>({
      method: 'PUT',
      path: `/v1/selection-lists/${encodeURIComponent(listId)}/translations/${encodeURIComponent(locale)}`,
      body,
      signal,
    })
  }

  /**
   * `PUT /v1/selection-lists/{listId}/items/{itemId}/translations/{locale}` —
   * human item text. Always stored with `is_machine: false`, which is what
   * protects it from a later autofill.
   */
  async upsertItemTranslation(
    listId: SelectionListId,
    itemId: SelectionListItemId,
    locale: Locale,
    body: SelectionListItemTranslationUpsert,
    signal?: AbortSignal
  ): Promise<SelectionListItemTranslation> {
    return this.request<SelectionListItemTranslation>({
      method: 'PUT',
      path: `/v1/selection-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}/translations/${encodeURIComponent(locale)}`,
      body,
      signal,
    })
  }

  /**
   * `POST /v1/selection-lists/{listId}/translations/{locale}/autofill` —
   * machine-translate everything missing or stale. Requires `translate`.
   * Never overwrites a human translation.
   */
  async autofillTranslations(
    listId: SelectionListId,
    locale: Locale,
    body: SelectionListAutofillRequest = {},
    signal?: AbortSignal
  ): Promise<SelectionListAutofillResult> {
    return this.request<SelectionListAutofillResult>({
      method: 'POST',
      path: `/v1/selection-lists/${encodeURIComponent(listId)}/translations/${encodeURIComponent(locale)}/autofill`,
      body,
      signal,
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Access                                                                  */
  /* ---------------------------------------------------------------------- */

  /** `GET /v1/selection-lists/{listId}/access` — a page of grants. */
  async getAccess(
    listId: SelectionListId,
    params: PageParams = {},
    signal?: AbortSignal
  ): Promise<Paged<SelectionListAccessGrant>> {
    return this.request<Paged<SelectionListAccessGrant>>({
      method: 'GET',
      path: `/v1/selection-lists/${encodeURIComponent(listId)}/access`,
      query: { limit: params.limit, cursor: params.cursor },
      signal,
    })
  }

  /**
   * `PUT /v1/selection-lists/{listId}/access/{userId}` — grant or change a role.
   * Demoting the last `list-owner` is refused with `409 CONFLICT`.
   */
  async setAccess(
    listId: SelectionListId,
    userId: UserId,
    role: SelectionListAccessRole,
    signal?: AbortSignal
  ): Promise<SelectionListAccessGrant> {
    return this.request<SelectionListAccessGrant>({
      method: 'PUT',
      path: `/v1/selection-lists/${encodeURIComponent(listId)}/access/${encodeURIComponent(userId)}`,
      body: { role },
      signal,
    })
  }

  /** `DELETE /v1/selection-lists/{listId}/access/{userId}` — idempotent revoke. */
  async revokeAccess(
    listId: SelectionListId,
    userId: UserId,
    signal?: AbortSignal
  ): Promise<void> {
    await this.request<null>({
      method: 'DELETE',
      path: `/v1/selection-lists/${encodeURIComponent(listId)}/access/${encodeURIComponent(userId)}`,
      allowEmpty: true,
      signal,
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Quota                                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * `GET /v1/selection-lists/quota` — usage and ceilings for the caller's org.
   * Call it to warn *before* a create fails, rather than surfacing
   * `403 QUOTA_EXCEEDED` as a surprise.
   */
  async getQuota(signal?: AbortSignal): Promise<SelectionListQuotaStatus> {
    return this.request<SelectionListQuotaStatus>({
      method: 'GET',
      path: '/v1/selection-lists/quota',
      signal,
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Resolve (hot path)                                                      */
  /* ---------------------------------------------------------------------- */

  /**
   * `POST /v1/resolve` — turn persisted item ids back into labels, in one call.
   *
   * Read-only and cacheable despite being a POST (the id batch does not fit a
   * URL). Archived ids resolve normally with `status: 'archived'`; only purged
   * or never-existent ids come back in `missing`. Bounded at 500 ids per call —
   * chunk larger batches yourself so the cap stays visible at the call site.
   */
  async resolveIds(
    ids: SelectionListItemId[],
    options: { locale?: Locale } = {},
    signal?: AbortSignal
  ): Promise<ResolveResponse> {
    return this.request<ResolveResponse>({
      method: 'POST',
      path: '/v1/resolve',
      body: { ids, locale: options.locale ?? this.defaultLocale },
      signal,
    })
  }

  /* ---------------------------------------------------------------------- */
  /* Helpers                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Walk every page of a cursor-paginated endpoint.
   *
   * Exists so no consumer hand-rolls the cursor loop — the standard's guarantee
   * (no gaps, no duplicates under concurrent writes) only holds if the cursor is
   * echoed back verbatim and the walk stops on `nextCursor === null`, and both
   * are easy to get subtly wrong.
   *
   * ```ts
   * for await (const item of client.paginate((p) => client.getItems(listId, p))) {
   *   // ...
   * }
   * ```
   */
  async *paginate<T>(
    fetchPage: (params: PageParams) => Promise<Paged<T>>,
    params: PageParams = {}
  ): AsyncGenerator<T, void, undefined> {
    let cursor: string | undefined = params.cursor
    for (;;) {
      const page: Paged<T> = await fetchPage(
        cursor === undefined ? { limit: params.limit } : { limit: params.limit, cursor }
      )
      for (const item of page.items) {
        yield item
      }
      if (!page.page.hasMore || page.page.nextCursor === null) {
        return
      }
      cursor = page.page.nextCursor
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Transport                                                               */
  /* ---------------------------------------------------------------------- */

  private async resolveToken(): Promise<string | undefined> {
    if (typeof this.token === 'function') {
      return this.token()
    }
    return this.token
  }

  private buildUrl(
    path: string,
    query: RequestOptions['query']
  ): string {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) continue
      search.append(key, String(value))
    }
    const qs = search.toString()
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`
  }

  private async request<T>(options: RequestOptions): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.extraHeaders,
    }
    const token = await this.resolveToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    const init: RequestInit = {
      method: options.method,
      headers,
    }
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body)
    }
    if (options.signal) {
      init.signal = options.signal
    }

    const response = await this.fetchImpl(
      this.buildUrl(options.path, options.query),
      init
    )

    if (response.status === 204 || response.status === 205) {
      // `allowEmpty` is declared per call rather than inferred from the status,
      // so an endpoint that unexpectedly returns no body fails loudly here
      // instead of handing the caller an undefined it will dereference later.
      if (options.allowEmpty) {
        return null as T
      }
      throw new SelectionListApiError(
        response.status,
        undefined,
        `Unexpected empty response from ${options.method} ${options.path}`
      )
    }

    const raw = await response.text()
    let parsed: unknown
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = undefined
      }
    }

    if (!response.ok) {
      throw new SelectionListApiError(
        response.status,
        isErrorBody(parsed) ? parsed : undefined,
        `${options.method} ${options.path} failed with HTTP ${response.status}`
      )
    }

    if (parsed === undefined) {
      if (options.allowEmpty) {
        return null as T
      }
      throw new SelectionListApiError(
        response.status,
        undefined,
        `Malformed JSON in response to ${options.method} ${options.path}`
      )
    }

    return parsed as T
  }
}

function isErrorBody(value: unknown): value is SelectionListErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  )
}
