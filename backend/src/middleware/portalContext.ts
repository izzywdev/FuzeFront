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
 * runs; a host/path that matches nothing (and no root portal is seeded yet)
 * yields no `req.portal` rather than guessing.
 *
 * Gated by the master flag `fuzefront.platform.multi-tenant-portals`
 * (default OFF, feature-flags skill). When OFF this middleware is a pure
 * no-op — `req.portal` stays undefined and next() is called immediately — so
 * existing routes that never read `req.portal` see zero behavior change,
 * matching FF-EPIC-09-S4 AC1 ("pre-epic behavior ... unchanged from today").
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
      ;(req as any).portalsFlagEnabled = enabled
      if (!enabled) {
        // Flag OFF: no-op, preserves pre-epic behavior exactly.
        return next()
      }

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
        // No root portal seeded yet (fresh install mid-bootstrap) — fail
        // closed rather than guessing at a portal identity.
        res.status(404).json({
          error: 'NOT_FOUND',
          message: 'No portal could be resolved for this request.',
        })
        return
      }

      if (row.status === 'suspended') {
        res.status(403).json({
          error: 'PORTAL_SUSPENDED',
          message: `Portal '${row.slug}' is suspended.`,
        })
        return
      }

      (req as any).portal = row
      next()
    } catch (error) {
      console.error('resolvePortalContext error:', error)
      res.status(500).json({ error: 'INTERNAL', message: 'Portal resolution failed.' })
    }
  }
}

export const resolvePortalContext = createResolvePortalContext()
