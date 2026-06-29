import React, { useEffect, useRef, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useCurrentUser, useAppContext, MenuItem } from './lib/shared'
import { installBridge, bridge } from './platform/bridge'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import AdminPage from './pages/AdminPage'
import OrganizationPage from './pages/OrganizationPage'
import StatusPage from './pages/StatusPage'
import HelpPage from './pages/HelpPage'
import TestPage from './pages/TestPage'
import { FederatedAppLoader } from './components/FederatedAppLoader'
import { getCurrentUser } from './services/api'
import websocketService from './services/websocket'
import { UserProfileManagement } from './components/UserProfileManagement'
import { WorkspaceProvisioningGate } from './components/WorkspaceProvisioningGate'
import CreateOrganizationPage from './pages/CreateOrganizationPage'
import AcceptInvitePage from './pages/AcceptInvitePage'
import BillingPage from './pages/BillingPage'

// Authentication wrapper component
function AuthWrapper({ children }: { children: React.ReactNode }) {
  const { state, dispatch } = useAppContext()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const token = localStorage.getItem('authToken')
        console.log('Initializing auth - token found:', !!token)

        if (token) {
          try {
            console.log('Attempting to get current user...')
            const user = await getCurrentUser()
            console.log('Successfully got user:', user.email)
            dispatch({ type: 'SET_USER', payload: user })
          } catch (userError) {
            // Token is invalid or expired
            console.error('Failed to get current user:', userError)
            localStorage.removeItem('authToken')
          }
        } else {
          console.log('No auth token found')
        }
      } catch (error) {
        console.error('Failed to initialize auth:', error)
        localStorage.removeItem('authToken')
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

  return <>{children}</>
}

function App() {
  return (
    <AuthWrapper>
      <AppContent />
    </AuthWrapper>
  )
}

function AppContent() {
  const { isAuthenticated, user } = useCurrentUser()
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''

  // Public route: invitation accept page — handle before auth check
  if (currentPath.startsWith('/invitations/')) {
    return <AcceptInvitePage />
  }

  console.log('AppContent - Authentication state:', {
    isAuthenticated,
    user: user?.email,
  })

  if (!isAuthenticated) {
    console.log('User not authenticated, showing login page')
    return <LoginPage />
  }

  console.log('User authenticated, showing main app')
  return (
    <WorkspaceProvisioningGate>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/organizations" element={<OrganizationPage />} />
          <Route path="/organizations/new" element={<CreateOrganizationPage />} />
          <Route path="/profile" element={<UserProfileManagement />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/app/:appId" element={<AppRoute />} />
          <Route path="/admin" element={<AdminRoute />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/test" element={<TestPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Layout>
    </WorkspaceProvisioningGate>
  )
}

// Component for loading federated apps
function AppRoute() {
  const appId = window.location.pathname.split('/app/')[1]

  if (!appId) {
    return <Navigate to="/dashboard" replace />
  }

  return <FederatedAppLoader appId={appId} />
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

