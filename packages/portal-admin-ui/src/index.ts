// ---- Flow orchestrators -----------------------------------------------------
export { MasterAdminPortalsFlow } from './flows/MasterAdminPortalsFlow'
export type { MasterAdminPortalsFlowProps } from './flows/MasterAdminPortalsFlow'
export { PortalAdminConsoleFlow } from './flows/PortalAdminConsoleFlow'
export type { PortalAdminConsoleFlowProps } from './flows/PortalAdminConsoleFlow'

// ---- S2 presentational components -------------------------------------------
export { PortalsTable } from './components/master/PortalsTable'
export type { PortalsTableProps } from './components/master/PortalsTable'
export { PlanBadge } from './components/master/PlanBadge'
export type { PlanBadgeProps } from './components/master/PlanBadge'
export { CreatePortalDialog } from './components/master/CreatePortalDialog'
export type { CreatePortalDialogProps } from './components/master/CreatePortalDialog'
export { PortalDetailPanel } from './components/master/PortalDetailPanel'
export type { PortalDetailPanelProps } from './components/master/PortalDetailPanel'
export { SuspendPortalDialog } from './components/master/SuspendPortalDialog'
export type { SuspendPortalDialogProps } from './components/master/SuspendPortalDialog'

// ---- S3 presentational components -------------------------------------------
export { PortalConsoleShell } from './components/console/PortalConsoleShell'
export type { PortalConsoleShellProps, PortalConsoleTab } from './components/console/PortalConsoleShell'
export { OverviewTab } from './components/console/OverviewTab'
export type { OverviewTabProps } from './components/console/OverviewTab'
export { UsersTab } from './components/console/UsersTab'
export type { UsersTabProps } from './components/console/UsersTab'
export { InviteUserDialog } from './components/console/InviteUserDialog'
export type { InviteUserDialogProps } from './components/console/InviteUserDialog'
export { CatalogTab, AddAppDialog } from './components/console/CatalogTab'
export type { CatalogTabProps, AddAppDialogProps, CatalogItem } from './components/console/CatalogTab'

// ---- API clients --------------------------------------------------------------
export { createAdminPortalsClient } from './api/adminPortalsClient'
export type { AdminPortalsClient, AdminPortalsClientOptions } from './api/adminPortalsClient'
export { createPortalConsoleClient } from './api/portalConsoleClient'
export type { PortalConsoleClient, PortalConsoleClientOptions } from './api/portalConsoleClient'
export { HttpClient, HttpError } from './api/http'
export type { HttpClientOptions } from './api/http'

// ---- Types ----------------------------------------------------------------
export type {
  Portal,
  PortalStatus,
  BillingMode,
  PortalDomain,
  CursorPage,
  AdminPortalsPage,
  ListAdminPortalsParams,
  CreatePortalInput,
  UserSummary,
  UsersPage,
  MemberRole,
  MemberStatus,
  OrgMember,
  OrgMembersPage,
  InvitationRole,
  InvitationStatus,
  Invitation,
  InvitationsPage,
  RegistryApp,
  RegistryAppsPage,
  PortalCatalogEntry,
  PortalCatalogPage,
} from './types'
