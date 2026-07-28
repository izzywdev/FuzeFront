import { Request, Response, NextFunction } from 'express'
import type { Knex } from 'knex'
import { db as defaultDb } from '../config/database'
import {
  findPortalByDomain,
  findPortalBySlug,
  getRootPortal,
} from '../repositories/portalRepository'
import { isMultiTenantPortalsEnabled, PortalFlagContext } from '../utils/portalFlag'

/**
 * FF-EPIC-10-S1 — resolvePortalContext middleware.
 *
 * Resolves the active portal for every request from (in order): the Host
 * header (portal_domains kind subdomain|custom), else the `/p/<slug>` path
 * prefix, else the seeded root portal. Fail-closed: a suspended portal
 * short-circuits with 403 `PORTAL_SUSPENDED` before any downstream handler
 * runs.
 *
 * Gated by the master flag `fuzefront.platform.multi-tenant-portals`
 * (default OFF, feature-flags skill). When OFF this middleware is a pure
 * no-op — `req.portal` stays undefined and next() is called immediately — so
 * existing routes that never read `req.portal` see zero behavior change,
 * matching FF-EPIC-09-S4 AC1 ("pre-epic behavior ... unchanged from today").
 *
 * BOOTSTRAP MODE: when the flag is ON but no root portal has been seeded yet
 * (a fresh install — see `ensureRootPortal()`), this ALSO passes through
 * (`req.portal` stays undefined) instead of 404ing. This middleware is
 * mounted globally ahead of every route, so failing closed here would block
 * login/signup/health too — and nothing could ever create the first user to
 * seed the root portal, permanently bricking the platform. Once a root
 * portal exists, an unresolved tenant host falls back to it as designed; a
 * suspended resolved portal still fails closed with 403.
 */

const DEFAULT_TTL_MS = 30_000

function ttlMs(): number {
  const raw = process.env.PORTAL_RESOLUTION_CACHE_TTL_MS
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TTL_MS
}

interface CacheEntry {
  row: any | null
  expiresAt: number
}

// Module-level cache, keyed by lookup ("host:<host>" | "slug:<slug>" |
// "root"). A short TTL bounds staleness; suspend/resume (FF-EPIC-09-S3, a
// later PR) additionally calls invalidatePortalCache() for immediate effect.
const cache = new Map<string, CacheEntry>()

export function invalidatePortalCache(portalId?: string): void {
  if (!portalId) {
    cache.clear()
    return
  }
  for (const [key, entry] of cache) {
    // Positive-hit entries for this exact portal, AND every negative (miss,
    // `row === null`) entry. A miss can never be matched by portalId (there
    // was no portal to match when it was cached) — yet a stale miss is
    // EXACTLY the failure mode a targeted invalidation must fix: create a
    // portal/domain for a host that previously resolved to nothing, and the
    // cached `null` for that host/slug key would otherwise stick for the
    // full TTL, leaving the brand-new portal unresolvable right after
    // creation. Clearing all negative entries on any invalidation call is a
    // deliberately conservative trade (a few extra reloads) for correctness.
    if (entry.row === null || entry.row?.id === portalId) cache.delete(key)
  }
}

/** Test-only: reset cache state between test cases. */
export function _clearPortalCacheForTests(): void {
  cache.clear()
}

async function cached(
  key: string,
  loader: () => Promise<any | undefined>
): Promise<any | null> {
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && hit.expiresAt > now) return hit.row

  const row = (await loader()) ?? null
  cache.set(key, { row, expiresAt: now + ttlMs() })
  return row
}

const PATH_SLUG_RE = /^\/p\/([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)(?:\/|$)/

export interface ResolvePortalContextDeps {
  db?: Knex
  isEnabled?: (ctx: PortalFlagContext) => Promise<boolean>
}

// The three outcomes resolution can reach. Computed entirely inside the
// try/catch (Bug 3 fix — no response is sent and next() is never called from
// inside the try); the switch below acts on it AFTER the try/catch returns.
type Outcome =
  | { kind: 'error' }
  | { kind: 'bootstrap' } // Bug 4 — no root portal seeded yet; pass through.
  | { kind: 'suspended'; row: any }
  | { kind: 'resolved'; row: any }
  | { kind: 'flag-off' }

export function createResolvePortalContext(deps: ResolvePortalContextDeps = {}) {
  const db = deps.db ?? defaultDb
  // Resolved per-call (not snapshotted here) so the default wiring always
  // reads the CURRENT `isMultiTenantPortalsEnabled` binding — required both
  // for live OpenFeature re-evaluation per request and so tests can swap the
  // implementation (e.g. jest.spyOn) after this module has already loaded.
  const isEnabled = deps.isEnabled

  return async function resolvePortalContext(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    // Bug 3 fix — ALL resolution work (including any DB error) happens
    // inside this try/catch; next() and every res.* call happen AFTER it,
    // never inside it. Previously `next()` was called from inside the try,
    // so a SYNCHRONOUS throw from a downstream handler (mounted after this
    // middleware) unwound back into this frame, got swallowed by this
    // catch, and triggered a SECOND response (res.status(500)...) on top of
    // whatever the downstream handler/Express's own error handler already
    // sent — crashing the request with ERR_HTTP_HEADERS_SENT and masking
    // the real error.
    //
    // Declared WITHOUT an initializer (CodeQL alert #1463, "useless
    // assignment" — every path below assigns it before use: the try block's
    // success paths, or the catch block unconditionally). TypeScript's
    // definite-assignment analysis proves it's always set before the switch.
    let outcome: Outcome

    try {
      const enabled = await (isEnabled ?? isMultiTenantPortalsEnabled)({})
      // Fix (b) — stash the decision on the request so authenticateToken
      // (which runs downstream and CANNOT use this same pre-auth {} context,
      // since it evaluates per-user) reuses THIS exact result instead of
      // re-evaluating independently. Two separate evaluations of a
      // per-user-targeted flag can legitimately disagree (e.g. gradual
      // rollout by userId): this middleware sees the flag OFF (no user yet)
      // while authenticateToken's own per-user evaluation sees it ON, or vice
      // versa — which silently skips the cross-portal JWT check below and
      // fails OPEN. A single evaluation shared for the whole request removes
      // that disagreement by construction rather than by convention.
      req.portalsFlagEnabled = enabled

      if (!enabled) {
        outcome = { kind: 'flag-off' }
      } else {
        const host = (req.headers.host || '').split(':')[0].toLowerCase()

        let row: any | null = null

        if (host) {
          row = await cached(`host:${host}`, () => findPortalByDomain(host, db))
        }

        if (!row) {
          const match = PATH_SLUG_RE.exec(req.path)
          if (match) {
            const slug = match[1]
            row = await cached(`slug:${slug}`, () => findPortalBySlug(slug, db))
          }
        }

        if (!row) {
          row = await cached('root', () => getRootPortal(db))
        }

        if (!row) {
          // Bug 4 fix — no root portal seeded yet. This is a genuinely
          // supported, expected state (a fresh install: migrations have run
          // but ensureRootPortal() found no user yet to own the platform
          // org — see repositories/portalRepository.ts). The OLD behavior
          // (404 here) fails closed at the WRONG layer: this middleware is
          // mounted globally, ahead of EVERY route, so it 404'd login,
          // signup, health, and /portal/context alike — and since nothing
          // can authenticate, no user can ever be created to seed the root
          // portal. The platform was permanently bricked until an operator
          // manually flipped the flag back off. Fail-closed must not mean
          // fail-to-boot (feature-flags skill): a release flag can gate NEW
          // capability, but it must never be able to wedge the platform out
          // of its own bootstrap sequence. So: pass through untouched
          // (`req.portal` stays undefined) rather than block the request —
          // downstream routes that care about a resolved portal (e.g.
          // /portal/context, /portal/current) make their own honest
          // decision about the missing-portal state; every unrelated route
          // (login, health, apps, ...) is completely unaffected, exactly as
          // if the flag were off, until a root portal exists to actually
          // enforce fail-closed resolution against.
          outcome = { kind: 'bootstrap' }
        } else if (row.status === 'suspended') {
          outcome = { kind: 'suspended', row }
        } else {
          outcome = { kind: 'resolved', row }
        }
      }
    } catch (error) {
      console.error('resolvePortalContext error:', error)
      outcome = { kind: 'error' }
    }

    switch (outcome.kind) {
      case 'error':
        res.status(500).json({ error: 'INTERNAL', message: 'Portal resolution failed.' })
        return
      case 'suspended':
        res.status(403).json({
          error: 'PORTAL_SUSPENDED',
          message: `Portal '${outcome.row.slug}' is suspended.`,
        })
        return
      case 'flag-off':
      case 'bootstrap':
        // Both are a pure pass-through: req.portal stays undefined.
        next()
        return
      case 'resolved':
        req.portal = outcome.row
        next()
        return
    }
  }
}

export const resolvePortalContext = createResolvePortalContext()
