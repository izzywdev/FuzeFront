import React, { useState, useEffect } from 'react'
import { useCurrentUser } from '../lib/shared'
import { authAPI, AuthMethods } from '../services/api'
import FrontFuseLogo from '../assets/FrontFuseLogo.png'

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [authMethods, setAuthMethods] = useState<AuthMethods | null>(null)
  const [diagnostics, setDiagnostics] = useState<any>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const { setUser } = useCurrentUser()

  // Handle OIDC callback on page load
  useEffect(() => {
    const oidcResult = authAPI.handleOIDCCallback()
    
    if (oidcResult.error) {
      setError(`Authentication failed: ${oidcResult.error}`)
      return
    }

    if (oidcResult.token) {
      console.log('🎉 OIDC authentication successful')
      // Get user info and redirect
      authAPI.getCurrentUser()
        .then(user => {
          setUser(user)
          window.location.href = '/dashboard'
        })
        .catch(err => {
          console.error('❌ Failed to get user after OIDC login:', err)
          setError('Failed to get user information')
        })
      return
    }

    // Load authentication methods
    loadAuthMethods()
  }, [setUser])

  const loadAuthMethods = async () => {
    try {
      const methods = await authAPI.getAuthMethods()
      setAuthMethods(methods)
      console.log('🔧 Available authentication methods:', methods)
    } catch (error) {
      console.error('❌ Failed to load auth methods:', error)
      // Fallback to local auth only
      setAuthMethods({
        methods: ['local'],
        oidcConfigured: false,
        defaultMethod: 'local'
      })
    }
  }

  // Log environment information on component mount
  useEffect(() => {
    console.log('🏠 LoginPage mounted - Environment Info:', {
      timestamp: new Date().toISOString(),
      currentURL: window.location.href,
      origin: window.location.origin,
      hostname: window.location.hostname,
      port: window.location.port,
      protocol: window.location.protocol,
      userAgent: navigator.userAgent,
      cookieEnabled: navigator.cookieEnabled,
      onLine: navigator.onLine,
      language: navigator.language,
      platform: navigator.platform,
      localStorage: {
        available: typeof Storage !== 'undefined',
        authToken: !!localStorage.getItem('authToken'),
        tokenPreview:
          localStorage.getItem('authToken')?.substring(0, 20) + '...' || 'none',
      },
      env: {
        NODE_ENV: import.meta.env.NODE_ENV,
        MODE: import.meta.env.MODE,
        VITE_API_URL: import.meta.env.VITE_API_URL,
        BASE_URL: import.meta.env.BASE_URL,
        DEV: import.meta.env.DEV,
        PROD: import.meta.env.PROD,
      },
    })

    // Test network connectivity
    console.log('🌐 Testing network connectivity...')
    fetch('/health')
      .then(response => {
        console.log('✅ Health endpoint accessible:', {
          status: response.status,
          statusText: response.statusText,
          url: response.url,
        })
      })
      .catch(error => {
        console.log('❌ Health endpoint not accessible:', {
          error: error.message,
          type: error.constructor.name,
        })
      })
  }, [])

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log('🎯 Local login form submitted:', {
      email,
      passwordLength: password.length,
      timestamp: new Date().toISOString(),
    })

    setLoading(true)
    setError('')

    try {
      console.log('🔄 Starting local login process...')
      const { token, user } = await authAPI.login({ email, password })

      console.log('🎉 Local login successful:', {
        hasToken: !!token,
        hasUser: !!user,
        userEmail: user?.email,
        userRoles: user?.roles,
      })

      if (token && user) {
        console.log('👤 Setting user in context...')
        setUser(user)
        console.log('🔄 Redirecting to dashboard...')
        window.location.href = '/dashboard'
      } else {
        throw new Error('Invalid response from server')
      }
    } catch (err: any) {
      console.error('❌ Local login error:', err)
      let errorMessage = err.response?.data?.error || err.message || 'Login failed'

      if (err.code === 'NETWORK_ERROR' || !err.response) {
        errorMessage += ' (Network connection failed - check if backend is running)'
      } else if (err.response?.status === 500) {
        errorMessage += ' (Server error - check backend logs)'
      }

      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleOIDCLogin = async () => {
    console.log('🔐 Starting OIDC login...')
    setLoading(true)
    setError('')

    try {
      await authAPI.loginWithOIDC()
      // This will redirect to Authentik, so we won't reach here
    } catch (err: any) {
      console.error('❌ OIDC login error:', err)
      setError('Failed to initiate OIDC login')
      setLoading(false)
    }
  }

  const runNetworkDiagnostics = async () => {
    console.log('🔍 Running network diagnostics...')
    const results: any = {
      timestamp: new Date().toISOString(),
      browser: {
        userAgent: navigator.userAgent,
        onLine: navigator.onLine,
        connection: (navigator as any).connection,
        cookieEnabled: navigator.cookieEnabled,
      },
      location: {
        href: window.location.href,
        origin: window.location.origin,
        hostname: window.location.hostname,
        port: window.location.port,
        protocol: window.location.protocol,
      },
      environment: {
        NODE_ENV: import.meta.env.NODE_ENV,
        MODE: import.meta.env.MODE,
        VITE_API_URL: import.meta.env.VITE_API_URL,
        BASE_URL: import.meta.env.BASE_URL,
      },
      tests: {},
    }

    // Test 1: Frontend health endpoint
    try {
      const response = await fetch('/health')
      results.tests.frontendHealth = {
        success: true,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
      }
    } catch (error: any) {
      results.tests.frontendHealth = {
        success: false,
        error: error.message,
        type: error.constructor.name,
      }
    }

    // Test 2: Backend health endpoint
    try {
      const response = await fetch('/api/health')
      results.tests.backendHealth = {
        success: true,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
      }
    } catch (error: any) {
      results.tests.backendHealth = {
        success: false,
        error: error.message,
        type: error.constructor.name,
      }
    }

    // Test 3: Backend auth endpoint (should return 401)
    try {
      const response = await fetch('/api/auth/user')
      results.tests.authEndpoint = {
        success: true,
        status: response.status,
        statusText: response.statusText,
        expected401: response.status === 401,
      }
    } catch (error: any) {
      results.tests.authEndpoint = {
        success: false,
        error: error.message,
        type: error.constructor.name,
      }
    }

    console.log('🔍 Network diagnostics results:', results)
    setDiagnostics(results)
    setShowDiagnostics(true)
  }

  return (
    <div className="auth-form">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '24px',
        }}
      >
        <img
          src={FrontFuseLogo}
          alt="FrontFuse"
          style={{
            height: '48px',
            width: 'auto',
            marginRight: '12px',
          }}
        />
        <h2 style={{ margin: 0 }}>Welcome to FrontFuse</h2>
      </div>
      <p>Sign in to access your microfrontend platform</p>

      {error && (
        <div
          style={{
            color: 'var(--error-color)',
            marginBottom: '1rem',
            padding: '10px',
            border: '1px solid var(--error-color)',
            borderRadius: '4px',
            backgroundColor: 'rgba(255, 0, 0, 0.1)',
          }}
        >
          <strong>Authentication Error:</strong>
          <br />
          {error}
        </div>
      )}

      {/* OIDC Authentication Option */}
      {authMethods?.oidcConfigured && (
        <div style={{ marginBottom: '2rem' }}>
          <button
            type="button"
            onClick={handleOIDCLogin}
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: 'var(--accent-color)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 'bold',
              marginBottom: '10px',
            }}
          >
            {loading ? '🔄 Redirecting...' : '🔐 Sign in with Authentik'}
          </button>
          <p style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '14px' }}>
            Single Sign-On via Authentik
          </p>
          
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            margin: '20px 0',
            color: 'var(--text-tertiary)'
          }}>
            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border-color)' }} />
            <span style={{ padding: '0 15px', fontSize: '14px' }}>or</span>
            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border-color)' }} />
          </div>
        </div>
      )}

      {/* Local Authentication Form */}
      <form onSubmit={handleLocalLogin}>
        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </div>

        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Signing in...' : authMethods?.oidcConfigured ? 'Sign in with Email' : 'Sign In'}
        </button>
      </form>

      {/* Authentication Methods Info */}
      {authMethods && (
        <div style={{ 
          marginTop: '1rem', 
          padding: '10px',
          backgroundColor: 'var(--bg-tertiary)',
          borderRadius: '4px',
          fontSize: '12px',
          color: 'var(--text-tertiary)'
        }}>
          <strong>Available Methods:</strong> {authMethods.methods.join(', ')}
          {authMethods.oidcConfigured && (
            <div>✅ OIDC configured with Authentik</div>
          )}
        </div>
      )}

      <div style={{ marginTop: '1rem' }}>
        <button
          type="button"
          onClick={runNetworkDiagnostics}
          style={{
            padding: '8px 16px',
            backgroundColor: 'var(--bg-quaternary)',
            color: 'var(--text-primary)',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
          }}
        >
          🔍 Run Network Diagnostics
        </button>
      </div>

      {showDiagnostics && diagnostics && (
        <div
          style={{
            marginTop: '1rem',
            padding: '10px',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            backgroundColor: 'var(--bg-tertiary)',
            fontSize: '12px',
            maxHeight: '300px',
            overflow: 'auto',
          }}
        >
          <h4>Network Diagnostics Results</h4>
          <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
        </div>
      )}

      <div style={{ marginTop: '2rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
        <p>Demo credentials:</p>
        <p>Email: admin@fuzefront.dev</p>
        <p>Password: admin123</p>
      </div>
    </div>
  )
}

export default LoginPage
