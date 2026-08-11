import api from './api'
import type { Portal, PortalStatus } from '@fuzefront/portal-client'

/**
 * Admin portals directory (Portals Directory, FF-EPIC-09 / design frames
 * `portals-directory`).
 *
 * Calls go through the shared same-origin `api` axios instance (services/api.ts)
 * rather than instantiating `@fuzefront/portal-client`'s own `PortalClient`
 * directly: the shared instance already carries the active-account bearer
 * token per request AND the global 401 interceptor (expires the account,
 * redirects to sign-in) — the exact "only a 401 re-authenticates" contract
 * this flow's states require. A 403 is left to propagate to the caller, which
 * renders the fail-closed permission-denied panel in place (never a redirect).
 *
 * Types are re-exported from `@fuzefront/portal-client` — the generated
 * client for `services/portal-service/openapi.yaml` — so the shape of a
 * portal row stays a compile-time link to the frozen contract.
 *
 * `identity_mode` / `launchUrl` are the S1 backend extension to the
 * `adminPortals` list (design/frames/portals-directory/manifest.json ->
 * dataSource.s1Extension), landing as a SIBLING PR
 * (claude/portals-directory-backend). The generated `Portal` schema type does
 * not carry them yet, so they're added here as an optional local extension —
 * this lets the UI build against the frozen contract now, tolerate S1 not
 * having merged yet (both fields simply come back undefined), and pick them
 * up automatically the moment S1 lands, with zero UI changes required.
 */

export type PortalIdentityMode = 'soft' | 'hard'

export interface AdminPortal extends Portal {
  /** 'soft' = shares the root Authentik; 'hard' = its own Authentik instance. */
  identity_mode?: PortalIdentityMode
  /**
   * Absolute URL of the portal's own host (primary custom domain, or the
   * root host's `/p/{slug}` path route when it has no custom domain).
   * Server-authoritative — the client renders it directly as the launch
   * anchor's `href` and never composes a host from client-held data.
   * Only present when `canOpen: true` (S5) — a read-only viewer must never
   * receive the launch host.
   */
  launchUrl?: string
  /**
   * S5 read-vs-manage refinement (`backend/src/routes/adminPortals.ts`).
   * Authority to MANAGE this portal (Permit ReBAC over its owning
   * organization). Undefined on an older/flag-OFF server response — callers
   * treat `undefined` as `true` (the pre-S5 contract: reaching a 200 at all
   * already implied blanket admin authority).
   */
  canManage?: boolean
  /**
   * Authority to LAUNCH (open) this portal. `false` on a row the caller may
   * only `read` — that row carries no `launchUrl` and the UI renders
   * `[data-action-absent="open-portal"]` instead of a launch anchor/button.
   * Undefined on an older/flag-OFF server response — treated as `true`.
   */
  canOpen?: boolean
}

/**
 * A response page is a READ-ONLY projection when every row in it came back
 * `canOpen: false` — the caller has `read` but not `manage`/`open` authority
 * over any portal this query returned (S5). Drives the
 * `[data-list="portals"][data-readonly="true"]` wrapper hook
 * (design/frames/portals-directory/02-portals-list-states.html, d6b) and the
 * directory header copy. An EMPTY page, or a page mixing manageable and
 * read-only rows, is not "read-only" as a whole — only a page where nothing
 * is openable is.
 */
export function pageIsReadOnly(items: AdminPortal[]): boolean {
  return items.length > 0 && items.every(item => item.canOpen === false)
}

export interface AdminPortalsPage {
  items: AdminPortal[]
  page: {
    nextCursor: string | null
    hasMore?: boolean
    total?: number
  }
}

export interface ListAdminPortalsParams {
  status?: PortalStatus
  q?: string
  limit?: number
  cursor?: string
}

// axios `api` baseURL is `/api`, so this resolves to `/api/v1/admin/portals`.
const ADMIN_PORTALS_PATH = 'v1/admin/portals'

/**
 * GET /api/v1/admin/portals — cursor-paginated fleet list scoped (Permit
 * ReBAC, server-side) to the portals the caller may manage. Throws the raw
 * axios error on failure; callers branch on `error.response?.status`
 * (403 -> fail-closed permission-denied in place; everything else -> retry).
 */
export async function listAdminPortals(
  params: ListAdminPortalsParams = {}
): Promise<AdminPortalsPage> {
  const { data } = await api.get<AdminPortalsPage>(ADMIN_PORTALS_PATH, { params })
  return data
}

/** Whether a further page exists — tolerates a `page.hasMore` omitted by an
 * older/S1-not-yet-landed server response, deriving it from `nextCursor`. */
export function pageHasMore(page: AdminPortalsPage['page']): boolean {
  return page.hasMore ?? Boolean(page.nextCursor)
}
