import type { Portal, PortalStatus, BillingMode, PortalDomain, VerificationStatus } from '@fuzefront/portal-client'
import type { components as SecurityComponents } from '@fuzefront/security-client'

// Re-export the frozen portal-client shapes this package renders directly.
// NOTE — these back the S3/S4 PORTAL-CONSOLE flow only (`PortalAdminConsoleFlow`,
// `OverviewTab`, `portalConsoleClient`), which still targets the anticipated
// standalone `@fuzefront/portal-client` model (`portal.id` / `.organizationId`).
// The MASTER-ADMIN flow below (FF-EPIC-17-S7) has since migrated onto the real,
// merged org-tree contract and deliberately does NOT share these names — see
// `AdminPortal` below.
export type { Portal, PortalStatus, BillingMode, PortalDomain, VerificationStatus }

export interface CursorPage {
  nextCursor: string | null
  hasMore?: boolean
  total?: number
}

export interface AdminPortalsPage {
  items: Portal[]
  page: CursorPage
}

export interface ListAdminPortalsParams {
  status?: PortalStatus
  q?: string
  limit?: number
  cursor?: string
}

export interface CreatePortalInput {
  name: string
  slug: string
  ownerEmail: string
  billingMode: BillingMode
}

// ---- Master-admin portal fleet — REAL org-tree contract ---------------------
// FF-EPIC-17-S7 (`@fuzefront/security-client` 0.7.0, PR #704). A portal is an
// `organizations` row whose `parentOrgId` is the platform root, carrying
// `isPortalRoot: true` + tenant attributes — NOT a `portals`-table entity.
// `services/portal-service/openapi.yaml` / `@fuzefront/portal-client` is
// marked superseded for this surface (see the security-client CHANGELOG's
// "Supersedes" note); this package migrates ONLY the master-admin-portals
// flow onto it here. Types are taken straight from the generated contract
// (`components['schemas']`), never hand-restated, so contract drift is a
// compile error. Deliberately named distinctly from `Portal`/`PortalStatus`/
// `BillingMode` above (which the OTHER, still-anticipated portal-console flow
// keeps using) so the two genuinely different shapes — `orgId` vs `id`/
// `organizationId`, a single `customDomain` vs a `domains[]` list — are never
// silently conflated by a shared name.
export type AdminPortal = SecurityComponents['schemas']['Portal']
export type AdminPortalCreate = SecurityComponents['schemas']['PortalCreate']
export type AdminPortalPageEnvelope = SecurityComponents['schemas']['PortalPage']
export type AdminPortalStatus = SecurityComponents['schemas']['PortalStatus']
export type AdminPortalBranding = SecurityComponents['schemas']['PortalBranding']
export type AdminPortalBillingMode = SecurityComponents['schemas']['PortalBillingMode']
export type AdminPortalAppCatalogMode = SecurityComponents['schemas']['PortalAppCatalogMode']

export interface ListAdminPortalFleetParams {
  status?: AdminPortalStatus
  limit?: number
  cursor?: string
}

// ---- Users tab (GET /api/users, GET /api/users/search) --------------------

export interface UserSummary {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  homePortalId: string | null
  createdAt: string | null
}

export interface UsersPage {
  items: UserSummary[]
  page: CursorPage
}

// ---- Portal-scoped org members (GET /organizations/:id/members) -----------
// Richer than the bare directory row above — carries role + membership status.
// This is the SAME `resolvePortalScopeDecision` scoping utility as
// backend/src/routes/users.ts, just wired through the organizations router.

export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer'
export type MemberStatus = 'active' | 'inactive'

export interface OrgMember {
  membershipId: string
  role: MemberRole
  status: MemberStatus
  joinedAt: string | null
  user: {
    id: string
    email: string
    firstName: string | null
    lastName: string | null
    homePortalId: string | null
  }
}

export interface OrgMembersPage {
  items: OrgMember[]
  page: CursorPage
}

// ---- Invitations (GET/POST /organizations/:id/invitations) ----------------

export type InvitationRole = 'admin' | 'member' | 'viewer'
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface Invitation {
  id: string
  organizationId: string
  email: string
  role: InvitationRole
  status: InvitationStatus
  expiresAt: string | null
  createdAt: string | null
}

export interface InvitationsPage {
  items: Invitation[]
  page: CursorPage
}

// ---- App registry (GET /api/apps — host backend's `apps` table; the SAME
// physical table `backend/applications`'s app-registry/portal-catalog write
// against, so `id` here IS `portal_apps.app_id`'s FK target. Preferred over
// GET /api/v1/app-registry/apps, whose FROZEN contract shape is keyed by
// `slug` and does not expose this `id` at all — see portalConsoleClient.ts's
// module doc.) ----------------------------------------------------------

export interface RegistryApp {
  /** `apps.id` — the SAME id the portal-catalog admin API's `appId` expects. */
  id: string
  name: string
  integrationType: string
  iconUrl: string | null
  isHealthy: boolean | null
}

export type RegistryAppsPage = RegistryApp[]

// ---- Portal app catalog (GET/POST/PATCH/DELETE /api/v1/app-registry/portals/:portalId/catalog) --

export interface PortalCatalogEntry {
  portalId: string
  appId: string
  enabled: boolean
  pinnedOrder: number
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface PortalCatalogPage {
  items: PortalCatalogEntry[]
  page: CursorPage
}
