import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useCurrentUser, useAppContext } from './lib/shared'
import { ChatProvider } from './contexts/ChatContext'
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
    <ChatProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/organizations" element={<OrganizationPage />} />
          <Route path="/profile" element={<UserProfileManagement />} />
          <Route path="/app/:appId" element={<AppRoute />} />
          <Route path="/admin" element={<AdminRoute />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/test" element={<TestPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Layout>
    </ChatProvider>
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
          color: '#ff6b6b',
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
        color: '#888',
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
