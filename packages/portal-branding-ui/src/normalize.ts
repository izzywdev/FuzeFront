import type { NormalizedPortalContext } from './types'

/**
 * The seeded root portal's slug is `fuzefront` — documented as the stable,
 * canonical identifier across the contract (services/portal-service/openapi.yaml)
 * and every EPIC-09/10 planning doc ("root portal (slug `fuzefront`)"). Used
 * as the isRoot fallback signal when the server doesn't (yet) send `isRoot`.
 */
const ROOT_SLUG = 'fuzefront'

export const ROOT_FALLBACK_CONTEXT: NormalizedPortalContext = {
  id: 'prt_root',
  slug: ROOT_SLUG,
  isRoot: true,
  branding: { name: 'FuzeFront', logo: null, favicon: null, accent: null, tagline: null },
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Normalize whatever `GET /api/v1/portal/context` returned into the shape the
 * UI renders from. Tolerant of two payload shapes on purpose:
 *
 *  1. The frozen `@fuzeone/portal-client` `PortalContext` schema —
 *     `{ id, slug, isRoot, branding, identityPolicy, authEntry }` — the real
 *     contract, once the server ships it.
 *  2. A minimal `{ portalId, slug, status, branding }` shape (e.g. an
 *     ephemeral/mock boundary, or a 404's error body reused as a fallback
 *     source) — every field is read defensively so a partial/legacy payload
 *     never throws.
 *
 * `isRoot` prefers the server's explicit flag; absent that, it falls back to
 * the documented root slug. Unknown/garbage input (e.g. an empty 404 error
 * body) normalizes to the root-fallback context, matching the fail-closed
 * "unknown host -> root portal" contract (FF-EPIC-10-S1 AC3).
 */
export function normalizePortalContext(raw: unknown): NormalizedPortalContext {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const brandingRaw = (r.branding && typeof r.branding === 'object' ? r.branding : {}) as Record<
    string,
    unknown
  >

  const slug = str(r.slug) ?? ROOT_SLUG
  const isRoot = typeof r.isRoot === 'boolean' ? r.isRoot : slug === ROOT_SLUG
  const id = str(r.id) ?? str(r.portalId) ?? (isRoot ? ROOT_FALLBACK_CONTEXT.id : slug)
  const name = str(brandingRaw.name) ?? (isRoot ? 'FuzeFront' : slug)

  return {
    id,
    slug,
    isRoot,
    branding: {
      name,
      logo: str(brandingRaw.logo),
      favicon: str(brandingRaw.favicon),
      accent: str(brandingRaw.accent),
      tagline: str(brandingRaw.tagline),
    },
  }
}
