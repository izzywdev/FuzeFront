// ---- Page-level -----------------------------------------------------------
export { IdentityPage } from './components/page/IdentityPage'
export type { IdentityPageProps } from './components/page/IdentityPage'

// ---- Composable atoms -----------------------------------------------------
export { MembersTable } from './components/members/MembersTable'
export type { MembersTableProps } from './components/members/MembersTable'
export { RoleSelect } from './components/members/RoleSelect'
export type { RoleSelectProps } from './components/members/RoleSelect'
export { InviteModal } from './components/invites/InviteModal'
export type { InviteModalProps } from './components/invites/InviteModal'
export { PendingInvitesList } from './components/invites/PendingInvitesList'
export type { PendingInvitesListProps } from './components/invites/PendingInvitesList'
export { EmptyState } from './components/common/EmptyState'
export type { EmptyStateProps, EmptyStateVariant } from './components/common/EmptyState'
export { RolesPermissionsPanel } from './components/permissions/RolesPermissionsPanel'
export type { RolesPermissionsPanelProps } from './components/permissions/RolesPermissionsPanel'

// ---- Identity context switcher (FF-EPIC-17-S4) -----------------------------
// design/frames/identity-context-switcher/** — flows: context-switch (route
// `/`, orchestrator ContextSwitcherFlow) and my-orgs (route `/organizations`,
// orchestrator MyOrganizationsFlow).
export { ContextSwitcherFlow } from './components/context/ContextSwitcherFlow'
export type { ContextSwitcherFlowProps } from './components/context/ContextSwitcherFlow'
export { ContextSwitcher } from './components/context/ContextSwitcher'
export type { ContextSwitcherProps } from './components/context/ContextSwitcher'
export { ContextPill } from './components/context/ContextPill'
export type { ContextPillProps } from './components/context/ContextPill'
export { PersonalContextHome } from './components/context/PersonalContextHome'
export type { PersonalContextHomeProps, PersonalScopeApp } from './components/context/PersonalContextHome'
export { OrgContextBadge } from './components/context/OrgContextBadge'
export type { OrgContextBadgeProps, OrgContext } from './components/context/OrgContextBadge'
export { MembershipRoleBadge } from './components/context/MembershipRoleBadge'
export type { MembershipRoleBadgeProps } from './components/context/MembershipRoleBadge'
export { ProvisioningGate } from './components/context/ProvisioningGate'
export type { ProvisioningGateProps } from './components/context/ProvisioningGate'
export { ContextSwitchErrorNotice } from './components/context/ContextSwitchErrorNotice'
export type { ContextSwitchErrorNoticeProps } from './components/context/ContextSwitchErrorNotice'
export { AccessLostNotice } from './components/context/AccessLostNotice'
export type { AccessLostNoticeProps } from './components/context/AccessLostNotice'

export { MyOrganizationsFlow } from './components/organizations/MyOrganizationsFlow'
export type { MyOrganizationsFlowProps } from './components/organizations/MyOrganizationsFlow'
export { MyOrganizationsList } from './components/organizations/MyOrganizationsList'
export type { MyOrganizationsListProps } from './components/organizations/MyOrganizationsList'
export { OrgCard } from './components/organizations/OrgCard'
export type { OrgCardProps } from './components/organizations/OrgCard'
export { SubOrgTree } from './components/organizations/SubOrgTree'
export type { SubOrgTreeProps } from './components/organizations/SubOrgTree'
export { CreateOrganizationDialog } from './components/organizations/CreateOrganizationDialog'
export type {
  CreateOrganizationDialogProps,
  CreateOrganizationInput,
  CreatedOrganization,
} from './components/organizations/CreateOrganizationDialog'
export { buildOrgForest, flattenForest } from './components/organizations/orgTree'
export type { OrgTreeNode } from './components/organizations/orgTree'

// ---- API tokens -----------------------------------------------------------
export { TokenList } from './components/tokens/TokenList'
export type { TokenListProps } from './components/tokens/TokenList'
export { TokenCreateModal } from './components/tokens/TokenCreateModal'
export type { TokenCreateModalProps } from './components/tokens/TokenCreateModal'
export { ScopeSelector } from './components/tokens/ScopeSelector'
export type { ScopeSelectorProps } from './components/tokens/ScopeSelector'
export { RevokeConfirmDialog } from './components/tokens/RevokeConfirmDialog'
export type { RevokeConfirmDialogProps } from './components/tokens/RevokeConfirmDialog'
export { SCOPE_GROUPS, ALL_SCOPES } from './components/tokens/scopes'
export type { ScopeGroup, ScopeGroupKey } from './components/tokens/scopes'

// ---- API clients ----------------------------------------------------------
export { createIdentityClient } from './api/identityClient'
export { createTokensClient } from './api/tokens'
export type { CreateTokenInput, TokensClient } from './api/tokens'
export { HttpClient, HttpError } from './api/http'
export type { HttpClientOptions } from './api/http'

// ---- i18n -----------------------------------------------------------------
export { IdentityI18nProvider, useIdentityI18n } from './i18n/IdentityI18nProvider'
export type { IdentityLocale, IdentityI18nContextValue, IdentityI18nProviderProps } from './i18n/IdentityI18nProvider'
export type { IdentityMessages } from './i18n/messages'

// ---- Types ----------------------------------------------------------------
export type {
  OrgRole,
  Member,
  Invitation,
  TokenOwnerType,
  ApiTokenSummary,
  CreatedApiToken,
  IdentityApiClient,
  OrgRoleDefinition,
  ResourceDef,
  ResourceActionDef,
  RolesCatalog,
  PaginationMeta,
  MembersPage,
  ListMembersOptions,
  ContextTarget,
  OrgContextItem,
} from './types'
