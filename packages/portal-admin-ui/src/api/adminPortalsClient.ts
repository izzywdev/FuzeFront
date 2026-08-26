/**
 * FF-EPIC-17-S7 — master-admin portal fleet API, migrated onto the REAL,
 * merged org-tree portal contract (`@fuzefront/security-client` 0.7.0,
 * PR #704): `GET/POST /api/v1/security/portals`,
 * `GET /api/v1/security/portals/{portalOrgId}`,
 * `POST .../{portalOrgId}/suspend` + `/resume`.
 *
 * This SUPERSEDES the earlier build against the anticipated
 * `@fuzefront/portal-client` (`/api/v1/admin/portals`) — see the
 * security-client CHANGELOG's "Supersedes" note and `types.ts`'s
 * `AdminPortal*` doc comment. Every shape below is taken straight from the
 * generated `@fuzefront/security-client` contract types
 * (`components['schemas']`), never hand-restated, so contract drift is a
 * compile error.
 *
 * Uses this package's own `HttpClient` (same convention as every other
 * `@fuzefront/*-ui` API client — see `identity-ui`'s `employeeClient.ts`)
 * rather than a generated runtime client, because `@fuzefront/security-client`
 * ships types + an OpenAPI doc only, no HTTP client class.
 */
import { HttpClient, HttpError, type HttpClientOptions } from './http'
import type { AdminPortal, AdminPortalCreate, AdminPortalPageEnvelope, ListAdminPortalFleetParams } from '../types'

export interface AdminPortalsClientOptions extends HttpClientOptions {}

export interface AdminPortalsClient {
  listPortals(params?: ListAdminPortalFleetParams): Promise<AdminPortalPageEnvelope>
  createPortal(input: AdminPortalCreate): Promise<AdminPortal>
  getPortal(portalOrgId: string): Promise<AdminPortal>
  suspendPortal(portalOrgId: string): Promise<AdminPortal>
  resumePortal(portalOrgId: string): Promise<AdminPortal>
}

export function createAdminPortalsClient(opts: AdminPortalsClientOptions = {}): AdminPortalsClient {
  const http = new HttpClient(opts)

  return {
    listPortals(params = {}) {
      return http.get<AdminPortalPageEnvelope>('/api/v1/security/portals', {
        limit: params.limit,
        cursor: params.cursor,
        status: params.status,
      })
    },
    createPortal(input) {
      return http.post<AdminPortal>('/api/v1/security/portals', input)
    },
    getPortal(portalOrgId) {
      return http.get<AdminPortal>(`/api/v1/security/portals/${encodeURIComponent(portalOrgId)}`)
    },
    suspendPortal(portalOrgId) {
      return http.post<AdminPortal>(`/api/v1/security/portals/${encodeURIComponent(portalOrgId)}/suspend`)
    },
    resumePortal(portalOrgId) {
      return http.post<AdminPortal>(`/api/v1/security/portals/${encodeURIComponent(portalOrgId)}/resume`)
    },
  }
}

/** True when `err` is the fail-closed 403 the fleet endpoints return for a non-platform-admin. */
export function isPortalsForbidden(err: unknown): boolean {
  return err instanceof HttpError && err.status === 403
}

/** True when `err` is the 409 `CONFLICT` `createPortal` returns for a duplicate slug. */
export function isSlugConflict(err: unknown): boolean {
  return err instanceof HttpError && err.status === 409 && err.code === 'CONFLICT'
}
