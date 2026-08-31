/**
 * @fuzefront/service-auth — the RESOURCE SERVER half.
 *
 * `POST /api/v1/security/tokens/introspect` ALWAYS answers HTTP 200 — per
 * `packages/security/openapi.yaml`'s `TokenIntrospection` schema, the wire
 * contract is "fail-closed IN THE BODY": an unknown/expired/revoked token
 * still comes back 200 with `{ active: false }`. A caller that branches on
 * status code instead of the `active` boolean fails OPEN — every 200 would
 * look like success. This module branches on `active`, never on status, and
 * that is the entire reason it exists rather than "just call fetch".
 *
 * Every ambiguity is a denial: network error, timeout, non-200 status,
 * unparsable body, a body missing `active`, `active` typed as anything but a
 * boolean. None of those return a permissive identity — they throw.
 */

import { FetchLike, MachineIdentity, ServiceAuthError, TokenIntrospection } from './types';

const INTROSPECT_PATH = '/api/v1/security/tokens/introspect';
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_CACHE_TTL_SECONDS = 5;
const DEFAULT_CACHE_MAX_ENTRIES = 1000;

export interface MachineTokenVerifierOptions {
  /** FuzeFront's same-origin API base, e.g. `https://app.fuzefront.com/api`. */
  baseUrl: string;
  /** Inject an alternative fetch (tests, old Node). Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** Per-request timeout. Default 3000ms. */
  timeoutMs?: number;
  /**
   * How long a POSITIVE (`active: true`) result may be reused for the same
   * token, in seconds. Default 5. Set to 0 to disable caching entirely.
   *
   * NEGATIVE results are NEVER cached, at any setting — an inactive/expired/
   * revoked verdict is always re-asked next time, so a revocation is visible
   * on the very next call rather than being masked by a stale cache entry.
   * The cache also never outlives the token's own `exp`.
   */
  cacheTtlSeconds?: number;
  /** Bound on cache size (FIFO eviction). Default 1000. */
  cacheMaxEntries?: number;
}

export interface MachineTokenVerifier {
  /**
   * Introspect `token` and return its normalized identity, or throw
   * `ServiceAuthError`. NEVER returns a value for an inactive/undecidable
   * token — every failure mode is a throw.
   */
  verifyMachineToken(token: string): Promise<MachineIdentity>;
}

interface CacheEntry {
  identity: MachineIdentity;
  expiresAtMs: number;
}

/** Build a fail-closed verifier bound to FuzeFront's introspection endpoint. */
export function createMachineTokenVerifier(options: MachineTokenVerifierOptions): MachineTokenVerifier {
  if (!options?.baseUrl) {
    throw new ServiceAuthError(
      'MISCONFIGURED',
      'createMachineTokenVerifier requires a baseUrl pointing at the FuzeFront Security API.',
      500,
    );
  }

  const base = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = (options.cacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS) * 1000;
  const cacheMaxEntries = options.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
  // Only ever holds ACTIVE identities. A cache miss means "ask introspection
  // again", never "assume inactive" and never "assume active".
  const cache = new Map<string, CacheEntry>();

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

  function cachedIdentity(token: string): MachineIdentity | undefined {
    if (cacheTtlMs <= 0) return undefined;
    const hit = cache.get(token);
    if (!hit) return undefined;
    if (hit.expiresAtMs <= Date.now()) {
      cache.delete(token);
      return undefined;
    }
    return hit.identity;
  }

  function remember(token: string, identity: MachineIdentity): void {
    if (cacheTtlMs <= 0) return;
    if (cache.size >= cacheMaxEntries) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    // Never cache past the token's own expiry, on top of the configured TTL.
    let ttl = cacheTtlMs;
    if (typeof identity.expiresAt === 'number') {
      const tokenTtlMs = identity.expiresAt * 1000 - Date.now();
      ttl = Math.max(0, Math.min(ttl, tokenTtlMs));
    }
    if (ttl <= 0) return;
    cache.set(token, { identity, expiresAtMs: Date.now() + ttl });
  }

  async function introspect(token: string): Promise<TokenIntrospection> {
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await resolvedFetch!(`${base}${INTROSPECT_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: controller?.signal,
      });
    } catch (err) {
      // Network error, DNS failure, connection reset, timeout (abort). Every
      // one of these is undecidable => deny, never "assume active".
      throw new ServiceAuthError(
        'INTROSPECTION_UNAVAILABLE',
        `Introspection request failed: ${(err as Error)?.message ?? 'unknown error'}; denying.`,
        401,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!res.ok) {
      // The contract says introspection always answers 200. A non-200 here
      // means something ELSE went wrong in front of it (proxy, LB, outage) —
      // still undecidable, still a denial. This is deliberately NOT treated
      // the same as an in-body `active: false`.
      throw new ServiceAuthError(
        'INTROSPECTION_UNAVAILABLE',
        `Introspection returned unexpected status ${res.status}; denying.`,
        401,
      );
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new ServiceAuthError(
        'MALFORMED_RESPONSE',
        `Introspection returned a non-JSON body: ${(err as Error)?.message ?? 'parse error'}; denying.`,
        401,
      );
    }

    const active = (body as { active?: unknown } | null)?.active;
    if (typeof active !== 'boolean') {
      // Missing/mistyped `active` is exactly as dangerous as a false one
      // treated as true would be. Deny.
      throw new ServiceAuthError(
        'MALFORMED_RESPONSE',
        'Introspection response is missing a boolean `active`; denying.',
        401,
      );
    }

    return body as TokenIntrospection;
  }

  return {
    async verifyMachineToken(token: string): Promise<MachineIdentity> {
      if (!token) {
        throw new ServiceAuthError('NO_TOKEN', 'No token presented to verify.', 401);
      }

      const cached = cachedIdentity(token);
      if (cached) return cached;

      // THIS is the branch the whole package exists to get right: the HTTP
      // call above always resolves with status 200 on success. Whether the
      // token is usable is decided here, from the body — never from `res.ok`.
      const introspection = await introspect(token);

      if (!introspection.active) {
        throw new ServiceAuthError('TOKEN_INACTIVE', 'Token is not active.', 401);
      }
      if (!introspection.subject) {
        throw new ServiceAuthError(
          'MALFORMED_RESPONSE',
          'Active introspection result is missing `subject`; denying.',
          401,
        );
      }

      const identity: MachineIdentity = {
        subject: introspection.subject,
        tenantId: introspection.tenantId ?? null,
        scope: introspection.scope,
        scopes: introspection.scope ? introspection.scope.split(/\s+/).filter(Boolean) : [],
        expiresAt: introspection.expiresAt,
        raw: introspection,
      };

      remember(token, identity);
      return identity;
    },
  };
}
