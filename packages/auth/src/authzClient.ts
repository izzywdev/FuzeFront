/**
 * @fuzefront/auth — HTTP binding to FuzeFront's Security API authz surface.
 *
 * The consuming service talks HTTP to FuzeFront and nothing else. No policy
 * vendor SDK, no vendor API key, no vendor concepts leak across this boundary —
 * that boundary IS the product. See `authzTypes.ts` for the fail-closed rationale.
 */

import {
  AuthzCheck,
  AuthzClient,
  AuthzClientOptions,
  AuthzDecision,
  AuthzError,
  FetchLike,
  Grant,
  GrantRequest,
  GrantRevokeRequest,
  GrantPage,
  GrantListQuery,
} from './authzTypes';

/** Path of the single-decision endpoint, relative to `baseUrl`. */
const CHECK_PATH = '/api/v1/security/authz/check';
/** Path of the batch-decision endpoint, relative to `baseUrl`. */
const BULK_CHECK_PATH = '/api/v1/security/authz/bulk-check';
/** Path of the grants endpoint, relative to `baseUrl`. */
const GRANTS_PATH = '/api/v1/security/authz/grants';

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_CACHE_MAX_ENTRIES = 1000;

/**
 * Cache key for a positive decision. Includes the token so two principals can
 * never share a cached allow — the single most dangerous possible bug here.
 * Also includes tenant/resource/action/context, so any change in the question
 * is a different key rather than a stale hit.
 */
function cacheKey(check: AuthzCheck, token: string): string {
  return JSON.stringify([
    token,
    check.subject,
    check.tenant,
    check.resource.type,
    check.resource.key ?? null,
    check.action,
    check.context ?? null,
  ]);
}

/** A positive decision plus the epoch-ms after which it must be re-asked. */
interface CacheEntry {
  expiresAtMs: number;
}

/**
 * Build a fail-closed authz client bound to a FuzeFront Security API.
 *
 * @example
 *   const authz = createAuthzClient({ baseUrl: process.env.FUZEFRONT_API_URL! });
 *   const { allow } = await authz.check(
 *     { subject: userId, tenant, resource: { type: 'invoice', key: 'inv_1' }, action: 'read' },
 *     bearerToken,
 *   );
 */
export function createAuthzClient(options: AuthzClientOptions): AuthzClient {
  if (!options?.baseUrl) {
    throw new AuthzError(
      'AUTHZ_MISCONFIGURED',
      'createAuthzClient requires a baseUrl pointing at the FuzeFront Security API.',
      500,
    );
  }

  const base = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = (options.cacheTtlSeconds ?? 0) * 1000;
  const cacheMaxEntries = options.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
  // Only ever holds ALLOWs. A miss means "ask the PDP", never "assume deny" —
  // deny-by-guessing would be as wrong as allow-by-guessing, just quieter.
  const cache = new Map<string, CacheEntry>();

  const resolvedFetch: FetchLike | undefined =
    options.fetch ??
    (typeof globalThis.fetch === 'function'
      ? (globalThis.fetch.bind(globalThis) as unknown as FetchLike)
      : undefined);

  if (!resolvedFetch) {
    throw new AuthzError(
      'AUTHZ_MISCONFIGURED',
      'No fetch implementation available. Pass `fetch` explicitly on Node <18.',
      500,
    );
  }

  /** POST a body to the Security API as `token`. Any failure => AuthzError(DECISION_UNAVAILABLE). */
  async function post(path: string, body: unknown, token: string): Promise<unknown> {
    // AbortController may be absent on exotic runtimes; the timeout is then the
    // caller's own, but we still never fall through to an allow.
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
    try {
      const res = await resolvedFetch!(`${base}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The CALLER's token — the decision is for the real principal.
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
      if (!res.ok) {
        throw new AuthzError(
          'DECISION_UNAVAILABLE',
          `Security API returned ${res.status} for ${path}; denying.`,
        );
      }
      return await res.json();
    } catch (err) {
      // Timeouts, DNS failures, connection resets, non-200s, malformed JSON —
      // every one of them lands here, and every one of them is a deny.
      if (err instanceof AuthzError) throw err;
      throw new AuthzError(
        'DECISION_UNAVAILABLE',
        `Security API request to ${path} failed: ${(err as Error)?.message ?? 'unknown error'}; denying.`,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Make an HTTP request (POST, DELETE, GET) to the Security API.
   * Distinguishes MALFORMED (400) from PROVIDER_ERROR (502).
   * Returns status code and parsed JSON body (if applicable).
   */
  async function request(
    method: string,
    path: string,
    body: unknown | undefined,
    token: string,
  ): Promise<{ status: number; body: unknown }> {
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
    try {
      const reqInit: any = {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        signal: controller?.signal,
      };
      if (body !== undefined) {
        reqInit.body = JSON.stringify(body);
      }
      const res = await resolvedFetch!(`${base}${path}`, reqInit);
      let responseBody: unknown = undefined;
      if (res.status !== 204) {
        // 204 No Content has no body
        try {
          responseBody = await res.json();
        } catch {
          responseBody = null;
        }
      }
      return { status: res.status, body: responseBody };
    } catch (err) {
      // Timeout or transport error — treat as 502 (provider error)
      throw new AuthzError(
        'PROVIDER_ERROR',
        `Security API request to ${path} failed: ${(err as Error)?.message ?? 'unknown error'}`,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Read `{ allow: boolean }` strictly. Anything else is not a decision. */
  function readDecision(value: unknown): AuthzDecision {
    const allow = (value as { allow?: unknown } | null)?.allow;
    if (typeof allow !== 'boolean') {
      throw new AuthzError(
        'DECISION_UNAVAILABLE',
        'Security API returned a decision without a boolean `allow`; denying.',
      );
    }
    return { allow };
  }

  function rememberAllow(key: string): void {
    if (cacheTtlMs <= 0) return;
    if (cache.size >= cacheMaxEntries) {
      // Cheap FIFO eviction — the oldest inserted key. Bounded memory matters
      // more than optimal hit-rate for a few-second TTL.
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, { expiresAtMs: Date.now() + cacheTtlMs });
  }

  function cachedAllow(key: string): boolean {
    if (cacheTtlMs <= 0) return false;
    const hit = cache.get(key);
    if (!hit) return false;
    if (hit.expiresAtMs <= Date.now()) {
      cache.delete(key);
      return false;
    }
    return true;
  }

  return {
    async check(check: AuthzCheck, token: string): Promise<AuthzDecision> {
      const key = cacheKey(check, token);
      if (cachedAllow(key)) return { allow: true };

      const decision = readDecision(await post(CHECK_PATH, check, token));
      if (decision.allow) rememberAllow(key);
      return decision;
    },

    async bulkCheck(checks: AuthzCheck[], token: string): Promise<AuthzDecision[]> {
      if (checks.length === 0) return [];

      const body = { checks };
      const payload = await post(BULK_CHECK_PATH, body, token);
      const raw = (payload as { decisions?: unknown } | null)?.decisions;

      if (!Array.isArray(raw) || raw.length !== checks.length) {
        // A batch whose length does not match the request cannot be safely
        // index-aligned — attributing decision[i] to check[i] would be a guess,
        // and a wrong guess is an unauthorized allow. Deny the whole batch.
        throw new AuthzError(
          'DECISION_UNAVAILABLE',
          `Security API returned ${Array.isArray(raw) ? raw.length : 'no'} decisions for ` +
            `${checks.length} checks; cannot index-align, denying batch.`,
        );
      }

      const decisions = raw.map(readDecision);
      decisions.forEach((decision, i) => {
        if (decision.allow) rememberAllow(cacheKey(checks[i], token));
      });
      return decisions;
    },

    async grant(req: GrantRequest, token: string): Promise<Grant> {
      const { status, body } = await request('POST', GRANTS_PATH, req, token);
      if (status === 201) {
        // Success — body should be the created Grant
        const grant = body as Grant;
        if (!grant?.id) {
          throw new AuthzError('PROVIDER_ERROR', 'Security API returned 201 but no grant id');
        }
        return grant;
      }
      if (status === 400) {
        const msg =
          (body as { error?: string } | null)?.error || 'grant request malformed';
        throw new AuthzError('MALFORMED', msg);
      }
      if (status === 502) {
        const msg =
          (body as { error?: string } | null)?.error || 'provider error';
        throw new AuthzError('PROVIDER_ERROR', msg);
      }
      // Any other status is unexpected
      throw new AuthzError(
        'PROVIDER_ERROR',
        `Security API returned ${status} for grant; treating as transient error`,
      );
    },

    async revoke(req: GrantRevokeRequest, token: string): Promise<void> {
      const { status, body } = await request('DELETE', GRANTS_PATH, req, token);
      if (status === 204) {
        // Success
        return;
      }
      if (status === 400) {
        const msg =
          (body as { error?: string } | null)?.error || 'revoke request malformed';
        throw new AuthzError('MALFORMED', msg);
      }
      // 502 or other error
      if (status === 502) {
        const msg =
          (body as { error?: string } | null)?.error || 'provider error';
        throw new AuthzError('PROVIDER_ERROR', msg);
      }
      throw new AuthzError(
        'PROVIDER_ERROR',
        `Security API returned ${status} for revoke; treating as transient error`,
      );
    },

    async listGrants(query: GrantListQuery, token: string): Promise<GrantPage> {
      if (!query.tenant) {
        throw new AuthzError('MALFORMED', 'tenant is required for listGrants');
      }
      const params = new URLSearchParams();
      params.set('tenant', query.tenant);
      if (query.subject) params.set('subject', query.subject);
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.cursor) params.set('cursor', query.cursor);
      const { status, body } = await request(
        'GET',
        `${GRANTS_PATH}?${params.toString()}`,
        undefined,
        token,
      );
      if (status === 200) {
        // Success — body should be the page
        const page = body as GrantPage;
        if (!page?.items || !page?.page) {
          throw new AuthzError('PROVIDER_ERROR', 'Security API returned 200 but malformed page');
        }
        return page;
      }
      if (status === 400) {
        const msg =
          (body as { error?: string } | null)?.error || 'listGrants request malformed';
        throw new AuthzError('MALFORMED', msg);
      }
      if (status === 502) {
        const msg =
          (body as { error?: string } | null)?.error || 'provider error';
        throw new AuthzError('PROVIDER_ERROR', msg);
      }
      throw new AuthzError(
        'PROVIDER_ERROR',
        `Security API returned ${status} for listGrants; treating as transient error`,
      );
    },
  };
}
