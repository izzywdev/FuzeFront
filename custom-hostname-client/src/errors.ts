import type { ErrorBody, ErrorCode } from './types';

/**
 * A typed failure from the Custom Hostname API.
 *
 * The contract guarantees a stable machine-readable `error` code; `message` is
 * human-readable prose and is explicitly NOT stable. Every consumer must branch
 * on `code`.
 *
 * One contract gap is handled here: `429 quota_exceeded` is documented in
 * FuzeInfra's `CUSTOM_DOMAINS.md` §4.7 and present in the `Error.error` enum,
 * but is not declared as a response on `POST /custom-hostnames`, so the
 * generated types do not know about it. We derive the code from the body when
 * present and fall back to the HTTP status, which covers it either way.
 * Filed upstream — see `services/custom-hostname-api/README.md`.
 */
export class CustomHostnameApiError extends Error {
  /** Stable machine-readable code. Branch on this. */
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: string | null;

  constructor(code: ErrorCode, status: number, message: string, detail: string | null = null) {
    super(message);
    this.name = 'CustomHostnameApiError';
    this.code = code;
    this.status = status;
    this.detail = detail;
    // Preserve `instanceof` across the ES5 target downlevelling tsup emits.
    Object.setPrototypeOf(this, CustomHostnameApiError.prototype);
  }

  /** Quota is a real, terminal error — surface it to the user, never retry it. */
  get isQuotaExceeded(): boolean {
    return this.code === 'quota_exceeded';
  }

  /**
   * The domain was rejected outright: malformed, a wildcard, or inside
   * `fuzefront.com` (already served by the wildcard Ingress rule). Never
   * retryable — the input has to change.
   */
  get isValidationError(): boolean {
    return this.code === 'validation_error';
  }

  /** Upstream (Cloudflare or the Kubernetes API) faltered. Retryable. */
  get isUpstreamError(): boolean {
    return this.code === 'upstream_error';
  }

  static fromResponse(status: number, body: unknown): CustomHostnameApiError {
    const parsed = (body ?? {}) as Partial<ErrorBody>;
    const code =
      typeof parsed.error === 'string'
        ? (parsed.error as ErrorCode)
        : statusToCode(status);
    const message =
      typeof parsed.message === 'string' && parsed.message.length > 0
        ? parsed.message
        : `Custom Hostname API returned ${status}`;
    const detail = typeof parsed.detail === 'string' ? parsed.detail : null;
    return new CustomHostnameApiError(code, status, message, detail);
  }
}

/**
 * Fallback when the body is absent or unparseable (a proxy 502 with an HTML
 * body, a network-level truncation). Keeps `code` meaningful so callers can
 * still branch rather than string-matching a message.
 */
function statusToCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 422:
      return 'validation_error';
    case 429:
      return 'quota_exceeded';
    default:
      return 'upstream_error';
  }
}
