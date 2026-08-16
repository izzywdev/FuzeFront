import type {
  ConfigErrorBody,
  ConfigErrorCode,
  ConfigErrorDetail,
  Scope,
} from './types'

/**
 * `ConfigErrorCode`, plus the client-only `UNKNOWN`.
 *
 * `UNKNOWN` is never emitted by the service. It is what this client reports when
 * a response is not a contract response at all — an ingress `502`, a proxy
 * timeout, an HTML error page. Mapping those onto a real contract code would be
 * a lie that sends the caller down the wrong recovery path, so they get their
 * own value.
 */
export type ConfigApiErrorCode = ConfigErrorCode | 'UNKNOWN'

/**
 * Every non-2xx response from the config-service surfaces as one of these.
 *
 * It carries the contract's machine-readable `code` alongside the HTTP status,
 * because the two answer different questions: the status says how a cache or a
 * proxy should treat the response, the `code` says what the caller should do
 * about it. Callers branch on `code`; `message` is human-facing and may change
 * without a contract version bump.
 */
export class ConfigApiError extends Error {
  /** Machine-readable code from the contract's error envelope, or `UNKNOWN`. */
  readonly code: ConfigApiErrorCode
  /** HTTP status of the response. */
  readonly status: number
  /**
   * The scope holding the lock. Present only on `LOCKED_BY_ANCESTOR`.
   *
   * This is what lets a UI say *which* ancestor refused the write instead of
   * showing a generic denial — the reason the contract specifies 409 with a body
   * rather than a bare 403.
   */
  readonly lockedBy: Scope | undefined
  /**
   * The resolved view's actual version. Present only on `VERSION_CONFLICT`.
   *
   * Re-read at this version and retry; do not blind-retry the original write,
   * which would overwrite whatever the concurrent editor just saved.
   */
  readonly currentVersion: string | undefined
  /** Per-key or per-field problems. Present on validation failures. */
  readonly details: ConfigErrorDetail[] | undefined
  /** The raw parsed body, for anything this class does not model. */
  readonly body: ConfigErrorBody | undefined

  constructor(
    status: number,
    code: ConfigApiErrorCode,
    message: string,
    body?: ConfigErrorBody,
  ) {
    super(message)
    this.name = 'ConfigApiError'
    this.status = status
    this.code = code
    this.body = body
    this.lockedBy = body?.lockedBy ?? undefined
    this.currentVersion = body?.currentVersion ?? undefined
    this.details = body?.details ?? undefined
    // Restore the prototype chain: subclassing Error across the ES5 downlevel
    // target otherwise breaks `instanceof`.
    Object.setPrototypeOf(this, ConfigApiError.prototype)
  }

  /**
   * True when the write was refused because an ancestor scope locked the key.
   *
   * Distinct from a plain authorization failure: the caller may well be allowed
   * to write at this scope in general, and `lockedBy` names who overrode that.
   */
  get isLockedByAncestor(): boolean {
    return this.code === 'LOCKED_BY_ANCESTOR'
  }

  /** True when the resolved view moved since the version the caller read. */
  get isVersionConflict(): boolean {
    return this.code === 'VERSION_CONFLICT'
  }
}

/** Narrowing type guard for {@link ConfigApiError}. */
export function isConfigApiError(error: unknown): error is ConfigApiError {
  return error instanceof ConfigApiError
}
