/**
 * @fuzefront/service-auth — shared types.
 *
 * This package is the runtime binding for FuzeFront's S2S (machine-to-machine)
 * identity contract, frozen in `@fuzefront/security-client`
 * (`TokenIssueRequest`/`TokenIssueResponse`/`TokenIntrospectRequest`/
 * `TokenIntrospection`, generated from `packages/security/openapi.yaml`).
 *
 * It talks to FuzeFront's OWN `/api/v1/security/tokens*` endpoints — never to
 * the vendor identity provider behind them. That indirection is the whole
 * point of the contract: consumers know only FuzeFront.
 */

import type { components } from '@fuzefront/security-client';

/** Semantic version of this package's runtime contract. Bump on interface change. */
export const SERVICE_AUTH_CONTRACT_VERSION = '0.1.0' as const;

export type TokenIssueRequest = components['schemas']['TokenIssueRequest'];
export type TokenIssueResponse = components['schemas']['TokenIssueResponse'];
export type TokenIntrospectRequest = components['schemas']['TokenIntrospectRequest'];
export type TokenIntrospection = components['schemas']['TokenIntrospection'];

/** Minimal fetch shape so callers can inject an alternative implementation (tests, old Node). */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** Stable error codes across the client, verifier, and middleware. All failures are denials. */
export type ServiceAuthErrorCode =
  | 'MISCONFIGURED'
  | 'TOKEN_REQUEST_FAILED'
  | 'MALFORMED_RESPONSE'
  | 'NO_TOKEN'
  | 'MALFORMED_HEADER'
  | 'INTROSPECTION_UNAVAILABLE'
  | 'TOKEN_INACTIVE'
  | 'FORBIDDEN'
  | 'UNKNOWN';

/**
 * The single error type thrown/surfaced anywhere in this package. Every
 * ambiguity (network error, timeout, malformed body, missing `active`) becomes
 * one of these — never a permissive fallback.
 */
export class ServiceAuthError extends Error {
  readonly code: ServiceAuthErrorCode;
  /** Suggested HTTP status for a resource server translating this to a response. */
  readonly status: number;

  constructor(code: ServiceAuthErrorCode, message: string, status = 401) {
    super(message);
    this.name = 'ServiceAuthError';
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, ServiceAuthError.prototype);
  }
}

/**
 * The normalized, typed identity a resource server gets back for a valid
 * machine token. Deliberately narrower than the raw `TokenIntrospection` body —
 * `scopes` is always an array (never undefined), and `raw` carries the wire
 * shape for anything bespoke a caller still needs.
 */
export interface MachineIdentity {
  /** Stable subject/client identifier for the calling service. Always present. */
  subject: string;
  /** Tenant scope, when the token carries one. `null` when unresolved. */
  tenantId: string | null;
  /** Space-delimited scope string as introspection returned it, if any. */
  scope?: string;
  /** `scope` split on whitespace. Always an array — empty means "no scopes". */
  scopes: string[];
  /** Token expiry (epoch seconds), when present. */
  expiresAt?: number;
  /** The raw introspection response this identity was built from. */
  raw: TokenIntrospection;
}
