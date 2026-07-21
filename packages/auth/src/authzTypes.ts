/**
 * @fuzefront/auth — authorization contract types.
 *
 * PROVIDER-NEUTRAL BY DESIGN. This surface names no authorization vendor and
 * requires no vendor SDK or vendor API key in the consuming service. A consumer
 * knows exactly one thing: the base URL of FuzeFront's Security API. The policy
 * engine behind that API is a server-side deployment detail and is free to be
 * swapped without a consumer recompiling.
 *
 * Decisions are made by the Security API for the REAL principal — the caller's
 * bearer token is forwarded, never a service-wide token that would flatten every
 * caller into one identity.
 *
 * FAIL-CLOSED: there is deliberately NO fail-open option anywhere in this
 * module. Every transport error, timeout, and non-200 is a DENY. The PDP's real
 * failure modes (stale tokens, cold-start timeouts, policy-store startup races)
 * all surface as exactly these errors, and a permissive fallback would silently
 * open every guarded route in the fleet at the worst possible moment.
 */

/**
 * Semantic version of the authz half of this contract. Bump on interface
 * changes; record in CHANGELOG.md.
 */
export const AUTHZ_CONTRACT_VERSION = '0.1.0' as const;

/** A resource the decision is about: a type, plus optionally a specific instance. */
export interface ResourceRef {
  /** Resource type, e.g. `'invoice'`. Always required. */
  type: string;
  /**
   * Specific instance key, e.g. `'inv_123'`. Its presence is what turns a
   * coarse role check into an instance-level (ABAC/ReBAC) decision.
   */
  key?: string;
}

/** A single authorization question. Mirrors `AuthzCheckRequest` in the frozen spec. */
export interface AuthzCheck {
  /** The principal the decision is about. */
  subject: string;
  /** Tenant/org scope. Required — an unscoped decision is not a decision. */
  tenant: string;
  resource: ResourceRef;
  action: string;
  /** Free-form attributes the policy may evaluate (the "A" in ABAC). */
  context?: Record<string, unknown>;
}

/** A single decision. Mirrors `AuthzDecision` in the frozen spec. */
export interface AuthzDecision {
  allow: boolean;
}

/**
 * Stable error codes for authorization failures. Distinct from `AuthErrorCode`
 * so a consumer can tell "we could not authenticate you" (401) apart from
 * "we could not/would not authorize you" (403) — collapsing them hides both
 * wiring bugs and real denials.
 */
export type AuthzErrorCode =
  /** No `req.identity` — the guard was mounted without `requireAuth` in front of it. A WIRING BUG. */
  | 'IDENTITY_MISSING'
  /** No tenant scope could be resolved for the decision. Fail-closed. */
  | 'TENANT_UNRESOLVED'
  /** The policy decision came back `allow: false`. The ordinary, expected denial. */
  | 'FORBIDDEN'
  /** The Security API could not be reached, timed out, or answered non-200. Denied. */
  | 'DECISION_UNAVAILABLE'
  /** The guard/client is misconfigured (e.g. no baseUrl). Denied. */
  | 'AUTHZ_MISCONFIGURED';

/** Error raised by the authz client/guard. Mirrors `AuthError`'s shape and discipline. */
export class AuthzError extends Error {
  readonly code: AuthzErrorCode;
  /** HTTP status the middleware surfaces (401 authn-wiring, 403 authz). */
  readonly status: number;
  constructor(code: AuthzErrorCode, message: string, status = 403) {
    super(message);
    this.name = 'AuthzError';
    this.code = code;
    this.status = status;
  }
}

/**
 * The minimal `fetch` shape this package needs. Declared structurally so the
 * package neither depends on DOM lib types nor pins a specific fetch
 * implementation — and so tests can inject a mock without a network.
 */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: unknown;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Options for {@link createAuthzClient}. */
export interface AuthzClientOptions {
  /**
   * Base URL of FuzeFront's Security API, e.g. `https://app.fuzefront.com`.
   * The client appends `/api/v1/security/authz/...`. Same-origin in-cluster
   * callers pass the service DNS name.
   */
  baseUrl: string;
  /** Injectable fetch. Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Per-request timeout in ms. On expiry the decision is DENIED. Default 3000. */
  timeoutMs?: number;
  /**
   * Positive-decision cache TTL in seconds. Default `0` — OFF. Opt-in only:
   * caching an authorization decision trades staleness for PDP load, and that
   * is the consuming service's risk to accept explicitly, not ours to assume.
   */
  cacheTtlSeconds?: number;
  /** Max cached positive decisions before eviction. Default 1000. */
  cacheMaxEntries?: number;
}

/** The authz client: a thin, fail-closed HTTP binding to the Security API. */
export interface AuthzClient {
  /**
   * Ask one authorization question as the given principal.
   * Resolves `{ allow }`. NEVER throws for a policy denial — a denial is a
   * successful decision of `false`. Throws `AuthzError('DECISION_UNAVAILABLE')`
   * when no decision could be obtained at all; the caller must treat that as deny.
   */
  check(check: AuthzCheck, token: string): Promise<AuthzDecision>;
  /**
   * Ask several questions in one round-trip. Returns decisions INDEX-ALIGNED
   * with `checks`. If the response is not index-aligned the whole batch is
   * treated as unavailable — a misaligned batch could otherwise attribute one
   * resource's `allow` to a different resource.
   */
  bulkCheck(checks: AuthzCheck[], token: string): Promise<AuthzDecision[]>;
}
