// FF-EPIC-12-S2/S5 — resolves the per-request PORTAL CATALOG context that
// gates the org-less/public-app leak fix in `service.ts`'s `list()`.
//
// WHY THIS DOESN'T (AND CAN'T) REUSE backend/src's resolvePortalContext /
// utils/portalFlag.ts / utils/scopeToPortal.ts DIRECTLY: those live in the
// host backend (`backend/src`), a SEPARATE deployable service/package from
// this one (`@fuzefront/applications-service`) — no import path crosses that
// boundary. The applications-service is reached in two ways:
//   1. Same-origin, via `backend/src/routes/app-registry.ts`'s proxy, which
//      forwards ONLY the caller's `Authorization` header (see that file's own
//      module doc) — it does NOT forward `req.portal`/`req.user.portalId`.
//   2. Directly, on `/api/apps` (the legacy surface), which the prod ingress
//      routes straight here, bypassing the host backend/proxy entirely.
// Either way, the ONLY portal signal this service ever receives is embedded
// in the JWT itself: `routes/auth.ts` (host backend) mints EVERY token with a
// `portalId` claim once the multi-tenant-portals flag was ON at login time
// (root-portal sessions get the root portal's OWN id — see that file's "the
// SAME platform-admin authority" module doc — never an absent/null claim).
// This service already re-verifies the same JWT with the same JWT_SECRET
// (see `@fuzefront/core`'s `authenticateToken`, which every route here goes
// through first), so decoding that claim independently, mirrored here, is the
// self-contained, no-new-network-hop way to recover portal context.
//
// FAIL-CLOSED CONTRACT (S2 AC4 / the epic's explicit instruction): with the
// `fuzefront.apps.portal-catalog` flag ON, a MISSING or MALFORMED portal
// context must NEVER fall back to the unscoped global list — mode 'denied'
// below is what `service.ts`'s `list()` turns into an empty result.
import jwt from 'jsonwebtoken'
import { db } from '../config/database'
import { getRequestPortalCatalogEnabled, type CatalogFlagRequest } from './portalCatalogFlag'

export type PortalCatalogMode = 'off' | 'root' | 'scoped' | 'denied'

export interface PortalCatalogContext {
  mode: PortalCatalogMode
  /** Only meaningful when mode is 'root' or 'scoped'. */
  portalId: string | null
}

export interface PortalContextRequest extends CatalogFlagRequest {
  headers: { authorization?: string | string[] }
}

/** Extracts+verifies the bearer token's `portalId` claim, independent of the
 * request's already-populated `req.user` (which `@fuzefront/core`'s
 * `authenticateToken` does not carry portal info on). Never throws.
 *
 * Returns:
 *  - a string  — an explicit, verified portal binding (root or tenant).
 *  - null      — a validly-signed token with NO `portalId` claim (a legacy,
 *                pre-multi-tenant-portals session). Treated as MISSING portal
 *                context (see module doc) — the caller maps this to 'denied'.
 *  - 'invalid' — no/unparseable/unverifiable token. Also MISSING context.
 */
function resolveTokenPortalId(req: PortalContextRequest): string | null | 'invalid' {
  const header = req.headers.authorization
  const raw = Array.isArray(header) ? header[0] : header
  const token = typeof raw === 'string' && raw.startsWith('Bearer ') ? raw.slice(7) : null
  if (!token) return 'invalid'
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as {
      portalId?: string
    }
    return typeof decoded.portalId === 'string' && decoded.portalId ? decoded.portalId : null
  } catch {
    return 'invalid'
  }
}

const ROOT_CACHE_TTL_MS = 30_000
let rootPortalIdCache: { id: string | null; expiresAt: number } | null = null

/**
 * Resolves the ROOT portal's own id (cached briefly — mirrors the TTL cache
 * style in backend/src's resolvePortalContext). A DB error degrades to `null`
 * (uncached, so the very next call retries) rather than throwing — this
 * function sits on the read path of every `GET /apps` call once the flag is
 * ON, so it must never 500 the whole request on a transient blip.
 */
export async function getRootPortalId(): Promise<string | null> {
  const now = Date.now()
  if (rootPortalIdCache && rootPortalIdCache.expiresAt > now) return rootPortalIdCache.id
  try {
    const row = await db('portals').where('is_root', true).first()
    const id = row?.id ?? null
    rootPortalIdCache = { id, expiresAt: now + ROOT_CACHE_TTL_MS }
    return id
  } catch {
    return null
  }
}

/** Test-only: reset the root-portal cache between test cases. */
export function _clearRootPortalCacheForTests(): void {
  rootPortalIdCache = null
}

/**
 * The single, shared way `service.ts`'s `list()` caller (routes/app-registry.ts)
 * resolves portal-catalog context for a request. Never throws.
 */
export async function resolvePortalCatalogContext(
  req: PortalContextRequest
): Promise<PortalCatalogContext> {
  const enabled = await getRequestPortalCatalogEnabled(req)
  if (!enabled) {
    return { mode: 'off', portalId: null }
  }

  const tokenPortalId = resolveTokenPortalId(req)
  if (tokenPortalId === 'invalid' || tokenPortalId === null) {
    // Missing portal context (no claim, or no verifiable token at all) — FAIL
    // CLOSED, never fall back to the unscoped global list (S2 AC4).
    return { mode: 'denied', portalId: null }
  }

  // AC3 — the root portal's catalog behavior must not regress: if the
  // resolved id IS the root portal's own id, keep today's unconditional
  // org-less/public visibility (same SQL as 'off'). If root lookup itself
  // degrades (DB blip), do NOT grant the bypass — fall through to 'scoped',
  // the safe default (never silently widen visibility on an infra hiccup).
  const rootId = await getRootPortalId()
  if (rootId && tokenPortalId === rootId) {
    return { mode: 'root', portalId: tokenPortalId }
  }
  return { mode: 'scoped', portalId: tokenPortalId }
}
