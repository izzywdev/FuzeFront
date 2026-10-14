/**
 * Authentication wiring between the shell and `@fuzeone/selection-lists-ui`.
 *
 * selection-list-service derives the caller's organization ONLY from a verified
 * claim in the bearer token. The token the shell holds after login is a plain
 * session token `{ userId, sessionId, tid }` with NO organization (`tid` is the
 * identity-directory tenant, not an org), so on its own every selection-list
 * route answers 401. The Security API therefore exchanges it, per active org,
 * for a short-lived org-scoped token after checking the caller's membership:
 *
 *     POST /api/organizations/:id/session-token   (Bearer = session token)
 *       -> { token, tokenType: 'Bearer', expiresIn, organizationId }
 *
 * (backend/security/src/services/orgSessionToken.ts). This module owns that
 * exchange for the shell:
 *   - same-origin, relative URL only: never an absolute host;
 *   - the session token comes from the ONE token resolver (lib/accounts.ts);
 *   - cached per (session token, org) and refreshed shortly before expiry, so a
 *     page of requests costs one exchange, not one per call;
 *   - single-flight: concurrent callers share one in-flight exchange;
 *   - fail-quiet: a refused/failed exchange yields `null` (no credential), never
 *     a throw into render;
 *   - a REFUSAL (any non-2xx answer) is remembered for FAILURE_BACKOFF_MS per
 *     (session, org). The Security API mounts `tokenAuthRateLimiter` (10 non-2xx
 *     per IP per minute) in front of EVERY /api/organizations/* route, so
 *     re-asking on each selection-list call after a 403 (stale active org,
 *     removed membership, deactivated org) would lock the user, and everyone
 *     behind the same NAT, out of all org routes for a minute. A network error
 *     or a malformed body never reached the limiter as a refusal and is retried;
 *   - a change of session token (logout, account switch) drops every cached
 *     org token, so no previous account's credential lingers in memory.
 *
 * The org-scoped token never leaves memory: it is not written to storage.
 */
import { useEffect, useMemo, useRef } from 'react'
import { configureSelectionListsAuth } from '@fuzeone/selection-lists-ui'
import { getActiveAuthToken } from './accounts'
import { useOrganizations } from './shared'

/** Refresh this long before the token's own expiry so a request never carries a token about to lapse. */
const REFRESH_SKEW_MS = 60_000

/** After a refused exchange, do not ask again for this (session, org) for this long. */
export const FAILURE_BACKOFF_MS = 30_000

export interface OrgTokenProviderDeps {
  /** The plain session token (lib/accounts.getActiveAuthToken). */
  getSessionToken: () => string | null
  /** The org the user is acting in right now; null = Personal context (no org). */
  getOrgId: () => string | null | undefined
  fetchImpl?: typeof fetch
  now?: () => number
}

interface CacheEntry {
  token: string
  refreshAtMs: number
}

export function createOrgSessionTokenProvider(deps: OrgTokenProviderDeps): () => Promise<string | null> {
  const now = deps.now ?? Date.now
  const cache = new Map<string, CacheEntry>()
  const inflight = new Map<string, Promise<string | null>>()
  /** key -> time before which a refused exchange is not retried. */
  const refusedUntil = new Map<string, number>()
  let lastSessionToken: string | null = null

  async function exchange(sessionToken: string, orgId: string, key: string): Promise<string | null> {
    try {
      const doFetch = deps.fetchImpl ?? globalThis.fetch.bind(globalThis)
      const res = await doFetch(`/api/organizations/${encodeURIComponent(orgId)}/session-token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}`, Accept: 'application/json' },
      })
      if (!res.ok) {
        refusedUntil.set(key, now() + FAILURE_BACKOFF_MS)
        return null
      }
      const body = (await res.json()) as { token?: unknown; expiresIn?: unknown }
      if (typeof body.token !== 'string' || body.token.length === 0) return null
      const ttlMs = (typeof body.expiresIn === 'number' && body.expiresIn > 0 ? body.expiresIn : 0) * 1000
      // No usable lifetime -> do not cache; hand the token to this caller only.
      if (ttlMs > REFRESH_SKEW_MS) cache.set(key, { token: body.token, refreshAtMs: now() + ttlMs - REFRESH_SKEW_MS })
      return body.token
    } catch {
      return null
    }
  }

  return async function getOrgToken(): Promise<string | null> {
    const orgId = deps.getOrgId()
    const sessionToken = deps.getSessionToken()
    if (sessionToken !== lastSessionToken) {
      // Logout / account switch: nothing minted for the previous session may
      // stay reachable (the keys below would never match again anyway).
      cache.clear()
      refusedUntil.clear()
      lastSessionToken = sessionToken
    }
    if (!orgId || !sessionToken) return null

    // Keyed on the session token as well: switching account (a different
    // session token) must never reuse the previous account's org token.
    const key = `${sessionToken}\u0000${orgId}`
    const hit = cache.get(key)
    if (hit && now() < hit.refreshAtMs) return hit.token
    cache.delete(key)
    const refused = refusedUntil.get(key)
    if (refused !== undefined) {
      if (now() < refused) return null
      refusedUntil.delete(key)
    }

    let pending = inflight.get(key)
    if (!pending) {
      pending = exchange(sessionToken, orgId, key).finally(() => inflight.delete(key))
      inflight.set(key, pending)
    }
    return pending
  }
}

/**
 * Wire the package's API client to the shell's session + active org. Call from
 * the route guard that renders the selection-list flows.
 *
 * Configured DURING the first render (useMemo), not in an effect: React runs a
 * child's effects before its parent's, so a flow's mount-time fetch would
 * otherwise fire before an effect-installed provider existed and go out with no
 * credential. The configuration is idempotent, so a repeat render is harmless;
 * the effect only clears it on unmount.
 */
export function useSelectionListsAuth(): void {
  const { activeOrganizationId } = useOrganizations()
  // Read at call time, not captured: the active org can change between requests.
  const orgIdRef = useRef<string | null>(activeOrganizationId ?? null)
  orgIdRef.current = activeOrganizationId ?? null

  const auth = useMemo(() => {
    const next = {
      getOrgToken: createOrgSessionTokenProvider({
        getSessionToken: getActiveAuthToken,
        getOrgId: () => orgIdRef.current,
      }),
      getSessionToken: getActiveAuthToken,
    }
    configureSelectionListsAuth(next)
    return next
  }, [])

  // Re-install on mount as well: under StrictMode the effect's cleanup runs once
  // before the real mount, which would otherwise leave the client unconfigured.
  useEffect(() => {
    configureSelectionListsAuth(auth)
    return () => configureSelectionListsAuth(undefined)
  }, [auth])
}
