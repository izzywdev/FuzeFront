/**
 * S3 — portal-admin console API. Consumes the REAL, already portal-scoped
 * endpoints named in the task brief:
 *   - GET /api/v1/portal/current           (@fuzefront/portal-client — the
 *     caller's own portal + its `organizationId`, resolved from the session)
 *   - GET /api/users, GET /api/users/search (`resolvePortalScopeDecision` in
 *     backend/src/routes/users.ts — scoped server-side, never re-scoped here)
 *   - GET /organizations/:id/members        (organizations.ts — the SAME
 *     scopeToPortal machinery, richer than /api/users: carries role + status,
 *     used for the Users tab's role pill / self-lockout guard)
 *   - GET/POST /organizations/:id/invitations,
 *     POST .../invitations/:id/resend, DELETE .../invitations/:id
 *     (organizations.ts — real invite/resend/revoke, Permit
 *     `canManageOrganization`-gated, which is exactly the portal-admin
 *     authority boundary: a caller who does not manage this org 403s,
 *     satisfying the cross-portal-invite-denied contract state with ZERO new
 *     code)
 *   - GET /api/apps                         (host backend's `apps` table —
 *     the SAME physical table `backend/applications`'s app-registry/
 *     portal-catalog write against; this is used INSTEAD OF
 *     `GET /api/v1/app-registry/apps` because the latter's FROZEN contract
 *     shape, `services/app-registry-service/openapi.yaml`, is keyed by
 *     `slug` and does not expose the app's internal `apps.id` (a uuid) —
 *     but the portal-catalog admin API's `POST .../catalog` body requires
 *     `appId` = that same uuid, the `portal_apps.app_id` FK target. There is
 *     no slug->id resolver endpoint on the frozen registry contract, so
 *     `GET /api/apps` is the only real source that lets this UI both DISPLAY
 *     and ENABLE an app. TODO (PR notes): its response has no `menuLabel`
 *     field (`name` is used for both); a future registry-contract addition
 *     of `id` to the frozen `App` shape would let this switch back.)
 *   - GET/POST/PATCH/DELETE /api/v1/app-registry/portals/:portalId/catalog
 *     (backend/applications/src/routes/portal-catalog.ts — real, FF-EPIC-12-S3,
 *     flag-gated `fuzefront.apps.portal-catalog` + Permit portal-admin authority)
 */
import { PortalClient } from '@fuzefront/portal-client'
import { HttpClient, type HttpClientOptions } from './http'
import type {
  Invitation,
  InvitationRole,
  InvitationsPage,
  OrgMembersPage,
  Portal,
  PortalCatalogEntry,
  PortalCatalogPage,
  RegistryAppsPage,
  UsersPage,
} from '../types'

export interface PortalConsoleClientOptions extends HttpClientOptions {}

export interface PortalConsoleClient {
  getCurrentPortal(): Promise<Portal>
  listUsers(params?: { limit?: number; cursor?: string }): Promise<UsersPage>
  searchUsers(q: string, params?: { limit?: number; cursor?: string }): Promise<UsersPage>
  listOrgMembers(organizationId: string, params?: { limit?: number; cursor?: string }): Promise<OrgMembersPage>
  listInvitations(organizationId: string, params?: { limit?: number; cursor?: string }): Promise<InvitationsPage>
  createInvitation(organizationId: string, email: string, role: InvitationRole): Promise<Invitation>
  resendInvitation(organizationId: string, invitationId: string): Promise<void>
  revokeInvitation(organizationId: string, invitationId: string): Promise<void>
  listRegistryApps(): Promise<RegistryAppsPage>
  listPortalCatalog(portalId: string, params?: { limit?: number; cursor?: string }): Promise<PortalCatalogPage>
  enableCatalogApp(portalId: string, appId: string, pinnedOrder?: number): Promise<PortalCatalogEntry>
  updateCatalogEntry(
    portalId: string,
    appId: string,
    patch: { enabled?: boolean; pinnedOrder?: number }
  ): Promise<PortalCatalogEntry>
  disableCatalogApp(portalId: string, appId: string): Promise<PortalCatalogEntry>
}

interface RawUsersResponse {
  items: Array<{
    id: string
    email: string
    firstName: string | null
    lastName: string | null
    homePortalId: string | null
    createdAt: string | null
  }>
  page: { nextCursor: string | null; hasMore?: boolean }
}

interface RawMembersResponse {
  items: Array<{
    membershipId: string
    role: string
    status: string
    joinedAt: string | null
    user: { id: string; email: string; firstName: string | null; lastName: string | null; homePortalId: string | null }
  }>
  page: { nextCursor: string | null; hasMore?: boolean }
}

interface RawInvitationsResponse {
  items: Array<{
    id: string
    organizationId: string
    email: string
    role: string
    status: string
    expiresAt: string | null
    createdAt: string | null
  }>
  page: { nextCursor: string | null; hasMore?: boolean }
}

interface RawCreateInvitationResponse {
  invitation: {
    id: string
    organizationId: string
    email: string
    role: string
    status: string
    expiresAt: string | null
  }
}

interface RawLegacyApp {
  id: string
  name: string
  iconUrl: string | null
  isHealthy: boolean | null
  integrationType: string
}

interface RawCatalogResponse {
  items: PortalCatalogEntry[]
  page: { nextCursor: string | null; hasMore?: boolean }
}

export function createPortalConsoleClient(opts: PortalConsoleClientOptions = {}): PortalConsoleClient {
  const http = new HttpClient(opts)
  const portalClient = () => new PortalClient({ baseUrl: opts.baseUrl ?? '', token: opts.getToken?.() ?? undefined })

  return {
    getCurrentPortal() {
      return portalClient().getCurrentPortal()
    },

    async listUsers(params = {}) {
      const res = await http.get<RawUsersResponse>('/api/users', {
        limit: params.limit,
        cursor: params.cursor,
      })
      return { items: res.items, page: res.page }
    },

    async searchUsers(q, params = {}) {
      const res = await http.get<RawUsersResponse>('/api/users/search', {
        q,
        limit: params.limit,
        cursor: params.cursor,
      })
      return { items: res.items, page: res.page }
    },

    async listOrgMembers(organizationId, params = {}) {
      const res = await http.get<RawMembersResponse>(
        `/api/organizations/${encodeURIComponent(organizationId)}/members`,
        { limit: params.limit, cursor: params.cursor }
      )
      return {
        items: res.items.map(row => ({
          membershipId: row.membershipId,
          role: row.role as OrgMembersPage['items'][number]['role'],
          status: row.status as OrgMembersPage['items'][number]['status'],
          joinedAt: row.joinedAt,
          user: row.user,
        })),
        page: res.page,
      }
    },

    async listInvitations(organizationId, params = {}) {
      const res = await http.get<RawInvitationsResponse>(
        `/api/organizations/${encodeURIComponent(organizationId)}/invitations`,
        { limit: params.limit, cursor: params.cursor }
      )
      return {
        items: res.items.map(row => ({
          id: row.id,
          organizationId: row.organizationId,
          email: row.email,
          role: row.role as InvitationRole,
          status: row.status as Invitation['status'],
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
        })),
        page: res.page,
      }
    },

    async createInvitation(organizationId, email, role) {
      const res = await http.post<RawCreateInvitationResponse>(
        `/api/organizations/${encodeURIComponent(organizationId)}/invitations`,
        { email, role }
      )
      return {
        id: res.invitation.id,
        organizationId: res.invitation.organizationId,
        email: res.invitation.email,
        role: res.invitation.role as InvitationRole,
        status: res.invitation.status as Invitation['status'],
        expiresAt: res.invitation.expiresAt,
        createdAt: null,
      }
    },

    async resendInvitation(organizationId, invitationId) {
      await http.post(
        `/api/organizations/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitationId)}/resend`
      )
    },

    async revokeInvitation(organizationId, invitationId) {
      await http.delete(
        `/api/organizations/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitationId)}`
      )
    },

    async listRegistryApps() {
      const res = await http.get<RawLegacyApp[]>('/api/apps')
      return (res ?? []).map(row => ({
        id: row.id,
        name: row.name,
        integrationType: row.integrationType,
        iconUrl: row.iconUrl ?? null,
        isHealthy: row.isHealthy ?? null,
      }))
    },

    async listPortalCatalog(portalId, params = {}) {
      const res = await http.get<RawCatalogResponse>(
        `/api/v1/app-registry/portals/${encodeURIComponent(portalId)}/catalog`,
        { limit: params.limit, cursor: params.cursor }
      )
      return { items: res.items, page: res.page }
    },

    enableCatalogApp(portalId, appId, pinnedOrder) {
      return http.post<PortalCatalogEntry>(
        `/api/v1/app-registry/portals/${encodeURIComponent(portalId)}/catalog`,
        { appId, ...(pinnedOrder !== undefined ? { pinnedOrder } : {}) }
      )
    },

    updateCatalogEntry(portalId, appId, patch) {
      return http.patch<PortalCatalogEntry>(
        `/api/v1/app-registry/portals/${encodeURIComponent(portalId)}/catalog/${encodeURIComponent(appId)}`,
        patch
      )
    },

    disableCatalogApp(portalId, appId) {
      return http.delete<PortalCatalogEntry>(
        `/api/v1/app-registry/portals/${encodeURIComponent(portalId)}/catalog/${encodeURIComponent(appId)}`
      )
    },
  }
}
