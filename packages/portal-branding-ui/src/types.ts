/**
 * Boot state machine for `GET /api/v1/portal/context`:
 *  - 'disabled' — the feature flag is off; no request is ever issued (today's
 *    shell renders unchanged).
 *  - 'loading'  — the request is in flight (or about to be) — render the
 *    neutral no-flash skeleton, never default branding.
 *  - 'ready'    — a portal (real or root-fallback) resolved successfully.
 *  - 'error'    — the request failed/timed out for a reason other than the
 *    two fail-closed cases below — offer retry, never a silent fallback.
 *  - 'suspended'— resolvePortalContext → 403 PORTAL_SUSPENDED (fail-closed).
 *
 * Unknown-host (404) is intentionally NOT its own status: a real backend
 * unknown-host resolves to the root portal for shell/UI routes (FF-EPIC-10-S1
 * AC3), so it normalizes straight to 'ready' with the root-fallback context —
 * the same shell frame 02 renders, not a distinct visual.
 */
export type PortalBootStatus = 'disabled' | 'loading' | 'ready' | 'error' | 'suspended'

export interface PortalBrandingFields {
  name: string
  logo: string | null
  favicon: string | null
  accent: string | null
  tagline: string | null
}

/**
 * A normalized, UI-facing projection of `GET /api/v1/portal/context`. Built by
 * `normalizePortalContext` from whatever the endpoint returns — the frozen
 * `@fuzeone/portal-client` `PortalContext` shape (`id`/`isRoot`/`branding`/
 * `identityPolicy`/`authEntry`) once the server ships it, tolerant of extra/
 * missing fields so the UI never throws on a partial payload.
 */
export interface NormalizedPortalContext {
  id: string
  slug: string
  isRoot: boolean
  branding: PortalBrandingFields
}
