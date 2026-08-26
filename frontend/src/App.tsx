import React, { useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom'
import {
  useCurrentUser,
  useAppContext,
  MenuItem,
  resetWorkspaceSessionIfUserChanged,
} from './lib/shared'
import {
  MAX_PARALLEL_ACCOUNTS,
  adoptProvisionalAccount,
  cancelAddAccount,
  getActiveAuthToken,
  setActiveValue,
} from './lib/accounts'
import { AccountsProvider } from './contexts/AccountsContext'
import { useT } from '@fuzefront/i18n'
import { installBridge, bridge } from './platform/bridge'
import { AppRegistryProvider } from './platform/appRegistry'
import { FeatureFlagProvider, useFlag } from './platform/featureFlags'
import StandaloneAppSurface from './components/StandaloneAppSurface'
import ApplicationsPage from './pages/ApplicationsPage'
import AddApplicationPage from './pages/AddApplicationPage'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import AdminPage from './pages/AdminPage'
import OrganizationPage from './pages/OrganizationPage'
import StatusPage from './pages/StatusPage'
import HelpPage from './pages/HelpPage'
import TestPage from './pages/TestPage'
import { FederatedAppLoader } from './components/FederatedAppLoader'
import { FederatedAppErrorBoundary } from './components/FederatedAppErrorBoundary'
import { getCurrentUser } from './services/api'
import websocketService from './services/websocket'
import { UserProfileManagement } from './components/UserProfileManagement'
import { WorkspaceProvisioningGate } from './components/WorkspaceProvisioningGate'
import CreateOrganizationPage from './pages/CreateOrganizationPage'
import AcceptInvitePage from './pages/AcceptInvitePage'
import BillingPage from './pages/BillingPage'
import AccountSecurityPage from './pages/AccountSecurityPage'
import AccountConnectionsPage from './pages/AccountConnectionsPage'
import PortalsDirectory from './pages/PortalsDirectory'
import PortalBillingPage from './pages/PortalBillingPage'
import MyOrganizationsPage from './pages/MyOrganizationsPage'
import OrganizationDetailPage from './pages/OrganizationDetailPage'
import EmployeeConsolePage from './pages/EmployeeConsolePage'
import EmployeeOrgDrilldownPage from './pages/EmployeeOrgDrilldownPage'
import MasterAdminPortalsPage from './pages/MasterAdminPortalsPage'
import PortalAdminConsolePage from './pages/PortalAdminConsolePage'
import MemberDirectoryPage from './pages/MemberDirectoryPage'
import ConfigPage from './pages/ConfigPage'
import ConfigCatalogPage from './pages/ConfigCatalogPage'
import ConfigKeyDefinitionPage from './pages/ConfigKeyDefinitionPage'
import ConfigAuditHistoryPage from './pages/ConfigAuditHistoryPage'
import { PortalShell, PortalLoginFlow, isMultiTenantPortalsEnabled } from '@fuzefront/portal-branding-ui'
import {
  SelectionListManagementFlow,
  TranslationWorkbenchFlow,
  SelectionListAccessFlow,
  SelectionListPickerHarness,
} from '@fuzeone/selection-lists-ui'

// Authentication wrapper component
function AuthWrapper({ children }: { children: React.ReactNode }) {
  const { state, dispatch } = useAppContext()
  const { t } = useT()
  const [isLoading, setIsLoading] = useState(true)
  // Set when an "add account" sign-in succeeded but the roster was already at
  // MAX_PARALLEL_ACCOUNTS. The session is discarded and the user is told why,
  // rather than an existing account being silently evicted.
  const [accountLimitReached, setAccountLimitReached] = useState(false)

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Read through the account vault's single resolver: this tab's ACTIVE
        // account, which may differ from another tab's (lib/accounts.ts).
        const token = getActiveAuthToken()
        console.log('Initializing auth - token found:', !!token)

        if (token) {
          try {
            console.log('Attempting to get current user...')
            const user = await getCurrentUser()
            console.log('Successfully got user:', user.email)

            // Bind the session to its account. A session parked in the
            // provisional namespace — a migrated single-account session, or the
            // just-completed "add account" sign-in — is re-keyed onto the real
            // account id here, now that /session has named it.
            const adopted = adoptProvisionalAccount({
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
            })
            if (!adopted) {
              // Roster full and this is a new account. Refusing beats evicting
              // one of the accounts the user is already signed in to.
              console.warn(
                `Cannot add a ${MAX_PARALLEL_ACCOUNTS + 1}th account; sign out of one first.`
              )
              cancelAddAccount()
              setAccountLimitReached(true)
              return
            }

            resetWorkspaceSessionIfUserChanged(user.id)
            dispatch({ type: 'SET_USER', payload: user })
          } catch (userError) {
            // Token is invalid or expired — clear only THIS account's session.
            console.error('Failed to get current user:', userError)
            setActiveValue('authToken', null)
          }
        } else {
          console.log('No auth token found')
        }
      } catch (error) {
        console.error('Failed to initialize auth:', error)
        setActiveValue('authToken', null)
      } finally {
        setIsLoading(false)
      }
    }

    initializeAuth()
  }, [dispatch])

  // Connect to WebSocket and listen for app status changes
  useEffect(() => {
    if (state.user) {
      // Connect to WebSocket when user is authenticated
      websocketService.connect()

      // Listen for app status changes
      const handleAppStatusChange = (data: {
        appId: string
        appName: string
        status: string
        isHealthy: boolean
        timestamp: string
      }) => {
        console.log(`📡 App ${data.appName} is now ${data.status}`)
        dispatch({
          type: 'UPDATE_APP_STATUS',
          payload: {
            appId: data.appId,
            isHealthy: data.isHealthy,
          },
        })
      }

      // Listen for new app registrations
      const handleAppRegistered = (data: { app: any; timestamp: string }) => {
        console.log(`🚀 New app registered: ${data.app.name}`)
        dispatch({
          type: 'ADD_APP',
          payload: data.app,
        })
      }

      websocketService.on('app-status-changed', handleAppStatusChange)
      websocketService.on('app-registered', handleAppRegistered)

      // Cleanup on unmount
      return () => {
        websocketService.off('app-status-changed', handleAppStatusChange)
        websocketService.off('app-registered', handleAppRegistered)
        websocketService.disconnect()
      }
    }
  }, [state.user, dispatch])

  // Install the platform bridge once, and keep its context + menu wiring in
  // sync with host state so runtime-loaded apps can read live context and call
  // shared services (toaster, menu) through window.__FUZEFRONT__.
  const menuRef = useRef<MenuItem[]>([])
  useEffect(() => {
    menuRef.current = state.menuItems
  }, [state.menuItems])

  useEffect(() => {
    installBridge({
      onMenuAdd: (appId, items) => {
        const others = menuRef.current.filter(m => m.appId !== appId)
        const added = items.map(i => ({ ...i, category: 'app' as const, appId }))
        dispatch({ type: 'SET_MENU_ITEMS', payload: [...others, ...added] })
      },
      onMenuRemove: appId => {
        dispatch({
          type: 'SET_MENU_ITEMS',
          payload: menuRef.current.filter(m => m.appId !== appId),
        })
      },
      socket: {
        on: (event, handler) => websocketService.onServer(event, handler),
        off: (event, handler) => websocketService.offServer(event, handler),
        emit: (event, payload) => websocketService.emitServer(event, payload),
        isConnected: () => websocketService.isConnected(),
      },
    })
  }, [dispatch])

  useEffect(() => {
    bridge.setContext({
      user: state.user
        ? {
            id: state.user.id,
            email: state.user.email,
            roles: state.user.roles,
          }
        : null,
      apps: state.apps.map(a => ({ id: a.id, name: a.name })),
      activeApp: state.activeApp
        ? { id: state.activeApp.id, name: state.activeApp.name }
        : null,
      isPlatformMode: true,
    })
  }, [state.user, state.apps, state.activeApp])

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          background: 'var(--bg-primary)',
        }}
      >
        <div style={{ color: 'var(--text-primary)' }}>Loading...</div>
      </div>
    )
  }

  if (accountLimitReached) {
    return (
      <div
        data-guard="max-accounts"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          padding: 'var(--space-6)',
          textAlign: 'center',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
        }}
      >
        <h2 style={{ margin: 0 }}>{t('accounts.limitTitle')}</h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)', maxWidth: '46ch' }}>
          {t('accounts.limitBody', { max: MAX_PARALLEL_ACCOUNTS })}
        </p>
        <button
          className="btn btn-primary"
          onClick={() => (window.location.href = '/')}
        >
          {t('nav.dashboard')}
        </button>
      </div>
    )
  }

  return <>{children}</>
}

function App() {
  return (
    <AuthWrapper>
      {/* Inside AuthWrapper: flags are fetched per authenticated user, so the
          request always carries a session token and the `developers` segment
          resolves against the real user id. */}
      <FeatureFlagProvider>
        {/* The account roster, for the user menu's account switcher. Mounted
            below AuthWrapper so the provisional session has already been
            adopted and the roster reflects real accounts. */}
        <AccountsProvider>
          <AppContent />
        </AccountsProvider>
      </FeatureFlagProvider>
    </AuthWrapper>
  )
}

function AppContent() {
  const { isAuthenticated, user } = useCurrentUser()
  const { pathname: currentPath } = useLocation()

  // Public route: invitation accept page — handle before auth check
  if (currentPath.startsWith('/invitations/')) {
    return <AcceptInvitePage />
  }

  // Public picker harness — embeddable component demo/test surface.
  // Must be accessible without authentication (Playwright tests navigate here directly).
  if (currentPath.startsWith('/embed/selection-list-picker')) {
    return <SelectionListPickerHarness />
  }

  if (import.meta.env.DEV) {
    console.log('AppContent - Authentication state:', {
      isAuthenticated,
      user: user?.email,
    })
  }

  // Bind the app-registry client (same-origin /api/v1/app-registry) once,
  // above all authenticated routes that read or mutate the registry. It is
  // gated on `isAuthenticated` so the /login surface never issues the
  // (auth-required) app-registry request pre-auth — that request could only
  // ever fail, and running it here blocked first paint of the login page for
  // up to its 10s axios timeout while React re-rendered on every retry tick.
  if (!isAuthenticated) {
    // White-label tenant portal shell + login (FF-EPIC-13/FF-EPIC-10), behind
    // fuzefront.platform.multi-tenant-portals (default OFF — see
    // @fuzefront/portal-branding-ui's isMultiTenantPortalsEnabled for why this
    // is a pre-auth-safe resolver rather than the authenticated useFlag()
    // Layout.tsx uses for the post-login shell). Flag OFF falls through to
    // today's LoginPage, completely unchanged — and every other
    // unauthenticated path (not exactly '/' or '/login') is untouched too,
    // scoped strictly to the two approved frames/flows (portal-shell,
    // portal-login).
    if (isMultiTenantPortalsEnabled()) {
      if (currentPath === '/login') {
        return <PortalLoginFlow />
      }
      if (currentPath === '/') {
        return <PortalShell />
      }
    }
    return (
      <AppRegistryProvider enabled={false}>
        <LoginPage />
      </AppRegistryProvider>
    )
  }

  // An authenticated user hitting the pre-auth /login or /signup routes must
  // be redirected to /dashboard (replace, not push, so Back doesn't bounce
  // them into the auth surface). Without this, those paths simply aren't
  // registered in the authenticated route tree below and fall through to the
  // catch-all 404 — this was BUG 1: a signed-in user visiting /login saw a
  // "404 - Page Not Found" app-shell page instead of being routed home.
  if (currentPath === '/login' || currentPath === '/signup') {
    return <Navigate to="/dashboard" replace />
  }

  // Standalone apps (mode = "standalone") render WITHOUT any portal chrome —
  // no side menu, no topbar — on their own surface (frame 04). Short-circuit
  // before the portal Layout so the standalone canvas is edge-to-edge.
  if (currentPath.startsWith('/standalone/')) {
    const slug = decodeURIComponent(currentPath.replace('/standalone/', '').split('/')[0])
    return (
      <AppRegistryProvider>
        <WorkspaceProvisioningGate>
          <StandaloneAppSurface slug={slug} />
        </WorkspaceProvisioningGate>
      </AppRegistryProvider>
    )
  }

  return (
    <AppRegistryProvider>
      <WorkspaceProvisioningGate>
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="/applications/new" element={<AddApplicationPage />} />
            <Route path="/organizations" element={<OrganizationsRoute />} />
            <Route path="/organizations/new" element={<CreateOrganizationPage />} />
            <Route path="/organizations/:id" element={<OrganizationDetailRoute />} />
            <Route path="/organizations/:id/directory" element={<MemberDirectoryRoute />} />
            <Route path="/profile" element={<UserProfileManagement />} />
            <Route path="/account/security" element={<AccountSecurityPage />} />
            <Route path="/account/security/connections" element={<AccountConnectionsPage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/billing/invoices" element={<BillingPage />} />
            <Route path="/billing/payments" element={<BillingPage />} />
            <Route path="/portals" element={<PortalsDirectory />} />
            <Route path="/staff" element={<EmployeeConsolePage />} />
            <Route path="/staff/orgs/:id" element={<EmployeeOrgDrilldownPage />} />
            <Route path="/admin/portals" element={<MasterAdminPortalsPage />} />
            <Route path="/portal/admin" element={<PortalAdminConsolePage />} />
            <Route path="/portal/admin/billing" element={<PortalBillingPage />} />
            {/* Selection Lists (EPIC-17 / FFRNT-188) */}
            <Route path="/config" element={<ConfigRoute />} />
            <Route path="/admin/config/catalog" element={<ConfigCatalogRoute />} />
            <Route path="/admin/config/catalog/:key" element={<ConfigKeyDefinitionRoute />} />
            <Route path="/admin/config/keys/:key/history" element={<ConfigAuditHistoryRoute />} />
            <Route path="/settings/selection-lists" element={<SelectionListsRoute />} />
            <Route path="/settings/selection-lists/:listId" element={<SelectionListsRoute />} />
            <Route path="/settings/selection-lists/:listId/translations" element={<TranslationWorkbenchRoute />} />
            <Route path="/settings/selection-lists/:listId/translations/:locale" element={<TranslationWorkbenchRoute />} />
            <Route path="/settings/selection-lists/:listId/access" element={<SelectionListAccessRoute />} />
            <Route path="/app/:appId" element={<AppRoute />} />
            <Route path="/admin" element={<AdminRoute />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/status" element={<StatusPage />} />
            <Route path="/test" element={<TestPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Layout>
      </WorkspaceProvisioningGate>
    </AppRegistryProvider>
  )
}

// Portal-mode federated app mount (/app/:appId), keyed by the manifest slug.
function AppRoute() {
  const { appId } = useParams<{ appId: string }>()

  if (!appId) {
    return <Navigate to="/dashboard" replace />
  }

  return <FederatedAppLoader appId={appId} />
}

/**
 * `/organizations` — FF-EPIC-17-S4, `fuzefront.identity.personal-context`
 * (default OFF). Flag OFF renders today's `OrganizationPage` (local
 * `<select>` + tabs) completely unchanged; flag ON renders the reconciled
 * "My orgs & sub-orgs" list (`MyOrganizationsPage`), which supersedes the
 * local `<select>` and hands off per-org management to `/organizations/:id`.
 */
function OrganizationsRoute() {
  const personalContextEnabled = useFlag('fuzefront.identity.personal-context', false)
  return personalContextEnabled ? <MyOrganizationsPage /> : <OrganizationPage />
}

/**
 * `/organizations/:id` — net-new (design/frames/identity-context-switcher,
 * 02-org-context.html). Only reachable/linked once the reconciled switcher
 * is on; flag OFF redirects to `/organizations` (today's app never linked
 * this route, so there is no legacy behavior to preserve here).
 */
function OrganizationDetailRoute() {
  const personalContextEnabled = useFlag('fuzefront.identity.personal-context', false)
  return personalContextEnabled ? <OrganizationDetailPage /> : <Navigate to="/organizations" replace />
}

/**
 * `/organizations/:id/directory` — the root/portal member directory
 * (design/frames/member-directory/**, FF-EPIC-17-S5), flag
 * `fuzefront.identity.member-directory` (default OFF). Flag OFF redirects to
 * `/organizations/:id` (today's app never linked this route, so there is no
 * legacy behavior to preserve — zero regression, matching
 * `OrganizationDetailRoute`'s convention for a net-new route).
 */
function MemberDirectoryRoute() {
  const { id } = useParams<{ id: string }>()
  const memberDirectoryEnabled = useFlag('fuzefront.identity.member-directory', false)
  return memberDirectoryEnabled ? (
    <MemberDirectoryPage />
  ) : (
    <Navigate to={id ? `/organizations/${id}` : '/organizations'} replace />
  )
}

/**
 * `/config` — the Configuration Management Console's settings editor
 * (FF-EPIC-19-S3, design/frames/config-management flow `settings-editor`),
 * flag `fuzefront.config.management-console` (default OFF). This is a
 * net-new route with nothing to preserve on OFF, matching
 * `OrganizationDetailRoute`'s convention: redirect rather than render
 * nothing, so a stale link (or the nav item briefly outrunning the flag
 * fetch) never dead-ends the user.
 */
function ConfigRoute() {
  const enabled = useFlag('fuzefront.config.management-console', false)
  return enabled ? <ConfigPage /> : <Navigate to="/dashboard" replace />
}

/**
 * `/admin/config/catalog` — the platform-admin key catalog (FF-EPIC-19-S4,
 * flow `key-catalog`), flag `fuzefront.config.key-catalog` (default OFF).
 */
function ConfigCatalogRoute() {
  const enabled = useFlag('fuzefront.config.key-catalog', false)
  return enabled ? <ConfigCatalogPage /> : <Navigate to="/dashboard" replace />
}

/** `/admin/config/catalog/:key` — one key's definition + resolution chain, same flag as the catalog list. */
function ConfigKeyDefinitionRoute() {
  const enabled = useFlag('fuzefront.config.key-catalog', false)
  return enabled ? <ConfigKeyDefinitionPage /> : <Navigate to="/admin/config/catalog" replace />
}

/**
 * `/admin/config/keys/:key/history` — change history + revert (FF-EPIC-19-S4,
 * flow `secret-audit`), flag `fuzefront.config.secrets-audit` (default OFF).
 */
function ConfigAuditHistoryRoute() {
  const enabled = useFlag('fuzefront.config.secrets-audit', false)
  return enabled ? <ConfigAuditHistoryPage /> : <Navigate to="/dashboard" replace />
}

/**
 * `/settings/selection-lists` — Selection List management (EPIC-17 / FFRNT-188),
 * flag `fuzefront.selection-lists.service` (default OFF). The service must be
 * deployed before the API is reachable; redirect to /dashboard when the flag
 * is OFF so a stale link never dead-ends the user. ErrorBoundary prevents a
 * render-time crash from unmounting the whole React tree (which caused the
 * Back button to also show a blank page).
 */
function SelectionListsRoute() {
  const enabled = useFlag('fuzefront.selection-lists.service', false)
  if (!enabled) return <Navigate to="/dashboard" replace />
  return (
    <FederatedAppErrorBoundary appName="Selection Lists">
      <SelectionListManagementFlow />
    </FederatedAppErrorBoundary>
  )
}

function TranslationWorkbenchRoute() {
  const enabled = useFlag('fuzefront.selection-lists.service', false)
  if (!enabled) return <Navigate to="/dashboard" replace />
  return (
    <FederatedAppErrorBoundary appName="Translation Workbench">
      <TranslationWorkbenchFlow />
    </FederatedAppErrorBoundary>
  )
}

function SelectionListAccessRoute() {
  const enabled = useFlag('fuzefront.selection-lists.service', false)
  if (!enabled) return <Navigate to="/dashboard" replace />
  return (
    <FederatedAppErrorBoundary appName="Selection List Access">
      <SelectionListAccessFlow />
    </FederatedAppErrorBoundary>
  )
}

// Protected admin route
function AdminRoute() {
  const { user } = useCurrentUser()

  if (!user?.roles.includes('admin')) {
    return (
      <div
        style={{
          padding: '2rem',
          textAlign: 'center',
          color: 'var(--error-color)',
        }}
      >
        <h3>🔒 Access Denied</h3>
        <p>You need admin privileges to access this page.</p>
        <button
          className="btn btn-primary"
          onClick={() => (window.location.href = '/dashboard')}
        >
          Return to Dashboard
        </button>
      </div>
    )
  }

  return <AdminPage />
}

// 404 page
function NotFoundPage() {
  return (
    <div
      style={{
        padding: '2rem',
        textAlign: 'center',
        color: 'var(--text-tertiary)',
      }}
    >
      <h1>404 - Page Not Found</h1>
      <p>The page you're looking for doesn't exist.</p>
      <button
        className="btn btn-primary"
        onClick={() => (window.location.href = '/dashboard')}
      >
        Go to Dashboard
      </button>
    </div>
  )
}

export default App

