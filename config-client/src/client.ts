import { ConfigApiError } from './errors'
import type {
  ConfigErrorBody,
  ConfigWriteRequest,
  ConfigWriteResult,
  EffectiveConfig,
  KeyDefinition,
  KeyDefinitionManifest,
  KeyDefinitionManifestResult,
  ListKeyDefinitionsParams,
  Namespace,
  NamespaceCreate,
  NamespaceName,
  KeyName,
  Paged,
  PageParams,
  Scope,
} from './types'

/** A token, or a function that produces one (so short-lived tokens can refresh). */
export type TokenProvider =
  | string
  | (() => string | undefined | Promise<string | undefined>)

/** Constructor options for {@link ConfigClient}. */
export interface ConfigClientOptions {
  /**
   * Base URL of the service.
   *
   * In the browser this MUST be a **same-origin** path (`'/api/config'`), never
   * an absolute host: the shell is served over TLS behind an ingress, and a
   * hard-coded host breaks the moment the environment changes and triggers
   * mixed-content blocks under TLS (see CLAUDE.md).
   */
  baseUrl: string
  /** Bearer token, or a provider for one. */
  token?: TokenProvider
  /** Injected `fetch`, for tests or a non-global runtime. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch
  /** Extra headers merged into every request (tracing, tenant hints). */
  headers?: Record<string, string>
}

/** Result of a conditional read that the server answered with 304. */
export interface NotModified {
  /** Discriminant: the resolved view is unchanged. */
  notModified: true
}

/** A conditional read either returns the config or reports it unchanged. */
export type ConditionalEffectiveConfig = EffectiveConfig | NotModified

/** Narrowing guard for a 304 answer from {@link ConfigClient.getEffectiveConfig}. */
export function isNotModified(
  result: ConditionalEffectiveConfig,
): result is NotModified {
  return (result as NotModified).notModified === true
}

/**
 * Typed client for the FuzeFront config-service.
 *
 * Derived by hand from `services/config-service/openapi.yaml` v1.0.0. That spec
 * is the frozen contract; this class is a projection of it.
 *
 * Zero runtime dependencies — it uses `fetch` and nothing else.
 */
export class ConfigClient {
  readonly #baseUrl: string
  readonly #token: TokenProvider | undefined
  readonly #fetch: typeof fetch
  readonly #headers: Record<string, string>

  constructor(options: ConfigClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.#token = options.token
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#headers = options.headers ?? {}

    if (typeof this.#fetch !== 'function') {
      throw new TypeError(
        'ConfigClient: no `fetch` available. Pass one via options.fetch.',
      )
    }
  }

  // ---------------------------------------------------------------------------
  // Namespaces
  // ---------------------------------------------------------------------------

  /** List the configuration namespaces the caller may see. */
  async listNamespaces(params: PageParams = {}): Promise<Paged<Namespace>> {
    return this.#request<Paged<Namespace>>('GET', '/v1/namespaces', {
      query: { cursor: params.cursor, limit: params.limit },
    })
  }

  /**
   * Register a namespace.
   *
   * Idempotent on `namespace`, so an app can register unconditionally at
   * startup rather than probing first.
   */
  async createNamespace(body: NamespaceCreate): Promise<Namespace> {
    return this.#request<Namespace>('POST', '/v1/namespaces', { body })
  }

  // ---------------------------------------------------------------------------
  // Key definitions (the catalog)
  // ---------------------------------------------------------------------------

  /**
   * List a namespace's key definitions.
   *
   * `isHidden` keys are omitted server-side for ordinary callers — this client
   * does no filtering of its own, because a hidden key that reached the browser
   * would already have failed to be hidden.
   */
  async listKeyDefinitions(
    namespace: NamespaceName,
    params: ListKeyDefinitionsParams = {},
  ): Promise<Paged<KeyDefinition>> {
    return this.#request<Paged<KeyDefinition>>(
      'GET',
      `/v1/namespaces/${encodeURIComponent(namespace)}/keys`,
      {
        query: {
          cursor: params.cursor,
          limit: params.limit,
          search: params.search,
          category: params.category,
          includeHidden: params.includeHidden,
        },
      },
    )
  }

  /** Get one key's metadata. */
  async getKeyDefinition(
    namespace: NamespaceName,
    key: KeyName,
  ): Promise<KeyDefinition> {
    return this.#request<KeyDefinition>(
      'GET',
      `/v1/namespaces/${encodeURIComponent(namespace)}/keys/${encodeURIComponent(key)}`,
    )
  }

  /**
   * Declare (upsert) the key definitions a namespace owns.
   *
   * Idempotent: re-registering an unchanged manifest is a no-op. Set
   * `complete: true` only when the manifest really is the whole catalog — that
   * is the flag that lets omitted keys be deprecated.
   */
  async registerKeyDefinitions(
    namespace: NamespaceName,
    manifest: KeyDefinitionManifest,
  ): Promise<KeyDefinitionManifestResult> {
    return this.#request<KeyDefinitionManifestResult>(
      'PUT',
      `/v1/namespaces/${encodeURIComponent(namespace)}/keys`,
      { body: manifest },
    )
  }

  // ---------------------------------------------------------------------------
  // Effective configuration
  // ---------------------------------------------------------------------------

  /**
   * Read a scope's fully-resolved configuration.
   *
   * Pass `ifNoneMatch` (a `version` from a previous read) to get a cheap
   * {@link NotModified} answer when nothing changed. The version reflects the
   * **resolved view**, so a change at an ancestor scope invalidates it too.
   */
  async getEffectiveConfig(
    namespace: NamespaceName,
    scope: Scope,
    ifNoneMatch?: string,
  ): Promise<ConditionalEffectiveConfig> {
    const response = await this.#send('GET', '/v1/config', {
      query: {
        namespace,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId ?? undefined,
      },
      extraHeaders: ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : undefined,
    })

    if (response.status === 304) return { notModified: true }
    await this.#throwIfError(response)
    return (await response.json()) as EffectiveConfig
  }

  // ---------------------------------------------------------------------------
  // Values
  // ---------------------------------------------------------------------------

  /**
   * Apply a batch of value operations to one scope, atomically.
   *
   * All operations succeed or none do. A refusal throws {@link ConfigApiError};
   * check `isLockedByAncestor` (which carries `lockedBy`) and
   * `isVersionConflict` (which carries `currentVersion`) to tell a policy
   * refusal from a concurrent-edit collision.
   */
  async writeConfigValues(
    request: ConfigWriteRequest,
  ): Promise<ConfigWriteResult> {
    return this.#request<ConfigWriteResult>('PUT', '/v1/config', {
      body: request,
    })
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  async #request<T>(
    method: string,
    path: string,
    init: {
      query?: Record<string, string | number | boolean | undefined>
      body?: unknown
    } = {},
  ): Promise<T> {
    const response = await this.#send(method, path, init)
    await this.#throwIfError(response)
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  async #send(
    method: string,
    path: string,
    init: {
      query?: Record<string, string | number | boolean | undefined>
      body?: unknown
      extraHeaders?: Record<string, string>
    } = {},
  ): Promise<Response> {
    const url = new URL(`${this.#baseUrl}${path}`, 'http://localhost')
    const isAbsolute = /^https?:\/\//i.test(this.#baseUrl)

    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.#headers,
      ...(init.extraHeaders ?? {}),
    }
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'

    const token = await this.#resolveToken()
    if (token) headers['Authorization'] = `Bearer ${token}`

    // Preserve a same-origin relative base: re-serialising through URL would
    // turn '/api/config' into 'http://localhost/api/config' and defeat the
    // same-origin requirement the contract states.
    const target = isAbsolute
      ? url.toString()
      : `${url.pathname}${url.search}`

    return this.#fetch(target, {
      method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  }

  async #resolveToken(): Promise<string | undefined> {
    if (typeof this.#token === 'function') return this.#token()
    return this.#token
  }

  async #throwIfError(response: Response): Promise<void> {
    if (response.ok) return

    let body: ConfigErrorBody | undefined
    try {
      body = (await response.json()) as ConfigErrorBody
    } catch {
      // Not a contract response at all — an ingress error page, a proxy
      // timeout. Deliberately left undefined so the code below reports UNKNOWN
      // rather than inventing a contract code.
      body = undefined
    }

    throw new ConfigApiError(
      response.status,
      body?.code ?? 'UNKNOWN',
      body?.message ?? `config-service request failed with ${response.status}`,
      body,
    )
  }
}
