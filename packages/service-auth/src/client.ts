/**
 * @fuzefront/service-auth — the CALLER half.
 *
 * Obtains and caches a machine (client-credentials) bearer token from
 * FuzeFront's `POST /api/v1/security/tokens`. Never talks to the vendor
 * identity provider directly.
 *
 * Caching + refresh:
 *  - The token is cached in memory and reused until it is within
 *    `refreshMarginSeconds` of its `expiresIn` — refreshing BEFORE expiry, not
 *    on failure after it, so a well-behaved caller never presents an expired
 *    token.
 *  - Concurrent `getToken()` calls during a refresh share ONE in-flight
 *    request (single-flight) rather than each firing their own — a stampede
 *    of N callers refreshing at once would otherwise turn one expiry into N
 *    requests against the IdP-backed issuance endpoint.
 */

import { FetchLike, ServiceAuthError, TokenIssueResponse } from './types';

const TOKEN_PATH = '/api/v1/security/tokens';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_REFRESH_MARGIN_SECONDS = 30;

export interface ServiceAuthClientOptions {
  /** FuzeFront's same-origin API base, e.g. `https://app.fuzefront.com/api` or `http://backend:3001/api`. */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** Optional requested scope, forwarded verbatim to `TokenIssueRequest.scope`. */
  scope?: string;
  /** Inject an alternative fetch (tests, old Node). Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** Per-request timeout. Default 5000ms. */
  timeoutMs?: number;
  /**
   * How long before expiry to proactively refresh, in seconds. Default 30.
   * Refreshing happens on the NEXT `getToken()` call at or past this margin —
   * there is no background timer.
   */
  refreshMarginSeconds?: number;
}

export interface ServiceAuthClient {
  /**
   * Returns a valid bearer token, refreshing it first if it is missing or
   * within the refresh margin of expiry. Concurrent calls during a refresh
   * share the same underlying request.
   */
  getToken(): Promise<string>;
  /** Drop the cached token, forcing the next `getToken()` to fetch a fresh one. */
  invalidate(): void;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

/** Build a client bound to FuzeFront's machine-token issuance endpoint. */
export function createServiceAuthClient(options: ServiceAuthClientOptions): ServiceAuthClient {
  if (!options?.baseUrl || !options?.clientId || !options?.clientSecret) {
    throw new ServiceAuthError(
      'MISCONFIGURED',
      'createServiceAuthClient requires baseUrl, clientId, and clientSecret.',
      500,
    );
  }

  const base = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const marginMs = (options.refreshMarginSeconds ?? DEFAULT_REFRESH_MARGIN_SECONDS) * 1000;

  const resolvedFetch: FetchLike | undefined =
    options.fetch ??
    (typeof globalThis.fetch === 'function'
      ? (globalThis.fetch.bind(globalThis) as unknown as FetchLike)
      : undefined);

  if (!resolvedFetch) {
    throw new ServiceAuthError(
      'MISCONFIGURED',
      'No fetch implementation available. Pass `fetch` explicitly on Node <18.',
      500,
    );
  }

  let cached: CachedToken | null = null;
  // Single-flight: while a refresh is in progress, every concurrent caller
  // awaits THIS promise instead of starting its own request.
  let inflight: Promise<string> | null = null;

  function isFresh(token: CachedToken): boolean {
    return Date.now() < token.expiresAtMs - marginMs;
  }

  async function requestNewToken(): Promise<string> {
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await resolvedFetch!(`${base}${TOKEN_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: options.clientId,
          clientSecret: options.clientSecret,
          ...(options.scope ? { scope: options.scope } : {}),
        }),
        signal: controller?.signal,
      });
    } catch (err) {
      throw new ServiceAuthError(
        'TOKEN_REQUEST_FAILED',
        `Token issuance request failed: ${(err as Error)?.message ?? 'unknown error'}`,
        502,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!res.ok) {
      throw new ServiceAuthError(
        'TOKEN_REQUEST_FAILED',
        `Token issuance returned ${res.status}.`,
        res.status === 401 || res.status === 400 ? res.status : 502,
      );
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new ServiceAuthError(
        'MALFORMED_RESPONSE',
        `Token issuance returned a non-JSON body: ${(err as Error)?.message ?? 'parse error'}`,
        502,
      );
    }

    const payload = body as Partial<TokenIssueResponse> | null;
    if (!payload || typeof payload.accessToken !== 'string' || !payload.accessToken) {
      throw new ServiceAuthError(
        'MALFORMED_RESPONSE',
        'Token issuance response is missing a string `accessToken`.',
        502,
      );
    }

    const expiresIn =
      typeof payload.expiresIn === 'number' && Number.isFinite(payload.expiresIn) && payload.expiresIn > 0
        ? payload.expiresIn
        : 0;

    cached = {
      accessToken: payload.accessToken,
      expiresAtMs: Date.now() + expiresIn * 1000,
    };
    return cached.accessToken;
  }

  return {
    async getToken(): Promise<string> {
      if (cached && isFresh(cached)) return cached.accessToken;

      if (!inflight) {
        inflight = requestNewToken().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },

    invalidate(): void {
      cached = null;
    },
  };
}
