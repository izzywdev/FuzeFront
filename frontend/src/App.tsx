import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useCurrentUser, useAppContext } from '@frontfuse/shared'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import AdminPage from './pages/AdminPage'
import StatusPage from './pages/StatusPage'
import { FederatedAppLoader } from './components/FederatedAppLoader'
import { getCurrentUser } from './services/api'
import websocketService from './services/websocket'

// Authentication wrapper component
function AuthWrapper({ children }: { children: React.ReactNode }) {
  const { state, dispatch } = useAppContext()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const token = localStorage.getItem('token')
        if (token) {
          const user = await getCurrentUser()
          dispatch({ type: 'SET_USER', payload: user })
        }
      } catch (error) {
        console.error('Failed to load user:', error)
        localStorage.removeItem('token')
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

      websocketService.on('app-status-changed', handleAppStatusChange)

      // Cleanup on unmount
      return () => {
        websocketService.off('app-status-changed', handleAppStatusChange)
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

  if (!isAuthenticated) {
    return <LoginPage />
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/app/:appId" element={<AppRoute />} />
        <Route path="/admin" element={<AdminRoute />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  )
}

// Component for loading federated apps
function AppRoute() {
  const urlParams = new URLSearchParams(window.location.search)
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

// Help page component
function HelpPage() {
  return (
    <div style={{ padding: '2rem' }}>
      <h1>Help & Documentation</h1>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '2rem',
          marginTop: '2rem',
        }}
      >
        <div
          style={{
            padding: '1.5rem',
            border: '1px solid #333',
            borderRadius: '8px',
            backgroundColor: '#1a1a1a',
          }}
        >
          <h3>Getting Started with FrontFuse</h3>
          <p>
            Learn how to use FrontFuse to access and manage your applications.
          </p>
          <ul style={{ textAlign: 'left', color: '#ccc' }}>
            <li>Navigate using the app selector in the top bar</li>
            <li>Use the side menu for app-specific features</li>
            <li>Contact your admin to request new apps</li>
          </ul>
        </div>

        <div
          style={{
            padding: '1.5rem',
            border: '1px solid #333',
            borderRadius: '8px',
            backgroundColor: '#1a1a1a',
          }}
        >
          <h3>Developer Guide</h3>
          <p>Documentation for building microfrontends for FrontFuse.</p>
          <ul style={{ textAlign: 'left', color: '#ccc' }}>
            <li>Module Federation setup guide</li>
            <li>SDK integration examples</li>
            <li>Platform API reference</li>
          </ul>
        </div>

        <div
          style={{
            padding: '1.5rem',
            border: '1px solid #333',
            borderRadius: '8px',
            backgroundColor: '#1a1a1a',
          }}
        >
          <h3>👥 Support</h3>
          <p>Get help when you need it.</p>
          <ul style={{ textAlign: 'left', color: '#ccc' }}>
            <li>Contact IT support</li>
            <li>Report bugs or issues</li>
            <li>Request new features</li>
          </ul>
        </div>
      </div>
    </div>
  )
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
