import type {
  QuotaScope,
  SelectionListErrorBody,
  SelectionListErrorCode,
  SelectionListErrorDetail,
} from './types'

/**
 * Every non-2xx response from the selection-list-service surfaces as one of
 * these. It carries the contract's machine-readable `code` alongside the HTTP
 * status, because the two answer different questions: the status says how a
 * cache or a proxy should treat the response, the `code` says what the caller
 * should do about it. Callers branch on `code`; `message` is human-facing and
 * may change without a contract version bump.
 */
/**
 * `SelectionListErrorCode`, plus the client-only `UNKNOWN`.
 *
 * `UNKNOWN` is never emitted by the service. It is what this client reports when
 * a response is not a contract response at all — an ingress `502`, a proxy
 * timeout, an HTML error page. Mapping those onto a real contract code would be
 * a lie that sends the caller down the wrong recovery path, so they get their
 * own value.
 */
export type SelectionListApiErrorCode = SelectionListErrorCode | 'UNKNOWN'

export class SelectionListApiError extends Error {
  /** Machine-readable code from the contract's error envelope, or `UNKNOWN`. */
  readonly code: SelectionListApiErrorCode
  /** HTTP status of the response. */
  readonly status: number
  /** Which quota ceiling was hit. Present only on `QUOTA_EXCEEDED`. */
  readonly scope: QuotaScope | undefined
  /** The ceiling. Present only on `QUOTA_EXCEEDED`. */
  readonly limit: number | undefined
  /** Usage at the time of refusal. Present only on `QUOTA_EXCEEDED`. */
  readonly current: number | undefined
  /** Field-level problems. Present only on `VALIDATION_ERROR`. */
  readonly details: SelectionListErrorDetail[] | undefined
  /** The raw parsed body, for anything this class does not model. */
  readonly body: SelectionListErrorBody | undefined

  constructor(
    status: number,
    body: SelectionListErrorBody | undefined,
    fallbackMessage: string
  ) {
    super(body?.message ?? fallbackMessage)
    this.name = 'SelectionListApiError'
    this.status = status
    this.code = body?.code ?? statusToCode(status)
    this.scope = body?.scope
    this.limit = body?.limit
    this.current = body?.current
    this.details = body?.details
    this.body = body
    // Restores the prototype chain when the package is consumed from a
    // down-levelled (ES5) build, where `instanceof` otherwise silently fails.
    Object.setPrototypeOf(this, SelectionListApiError.prototype)
  }

  /** True when the caller hit a quota ceiling rather than a permission wall. */
  get isQuotaExceeded(): boolean {
    return this.code === 'QUOTA_EXCEEDED'
  }

  /**
   * True when the resource is absent *or* invisible to this caller. The service
   * deliberately conflates the two so it is not a cross-org existence oracle —
   * do not report "deleted" to a user on the strength of this alone.
   */
  get isNotFound(): boolean {
    return this.code === 'NOT_FOUND'
  }

  /** True for a duplicate `key`/`code`, or a last-owner removal. */
  get isConflict(): boolean {
    return this.code === 'CONFLICT'
  }
}

/** Narrowing type guard for `catch` blocks. */
export function isSelectionListApiError(
  error: unknown
): error is SelectionListApiError {
  return error instanceof SelectionListApiError
}

/**
 * Best-effort code when a response carries no parseable contract body — only
 * for the statuses the contract does define. Anything else is `UNKNOWN`, not a
 * guess.
 */
function statusToCode(status: number): SelectionListApiErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR'
    case 401:
      return 'UNAUTHENTICATED'
    case 403:
      return 'FORBIDDEN'
    case 404:
      return 'NOT_FOUND'
    case 409:
      return 'CONFLICT'
    default:
      return 'UNKNOWN'
  }
}
