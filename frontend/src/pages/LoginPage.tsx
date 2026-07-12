import React, { useState, useEffect } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { useCurrentUser } from '../lib/shared'
import { authAPI, AuthMethods } from '../services/api'
import FrontFuseLogo from '../assets/FrontFuseLogo.png'

// Official Google "G" mark palette — these exact values are mandated by
// Google's brand identity guidelines for third-party sign-in buttons and must
// NOT be themed or tokenized (they are a trademark asset, not UI styling).
const GOOGLE_BRAND = {
  red: '#EA4335', // ds-conformance-allow: third-party brand mark (Google identity guidelines)
  blue: '#4285F4', // ds-conformance-allow: third-party brand mark (Google identity guidelines)
  yellow: '#FBBC05', // ds-conformance-allow: third-party brand mark (Google identity guidelines)
  green: '#34A853', // ds-conformance-allow: third-party brand mark (Google identity guidelines)
}

function LoginPage() {
  const { t } = useLanguage()
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
    authAPI.handleOIDCCallback().then(oidcResult => {
      if (oidcResult.error) {
        setError(`Authentication failed: ${oidcResult.error}`)
        // Leave the login form usable so the user can retry
        loadAuthMethods()
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
    }).catch(err => {
      // Backstop: a rejected promise must never freeze the page
      console.error('❌ Unexpected error in OIDC callback handler:', err)
      setError('Authentication encountered an unexpected error. Please try again.')
      loadAuthMethods()
    })
    // Runs ONCE on mount — this is a page-load handler (OIDC-callback exchange
    // + auth-method fetch). Depending on setUser here previously re-fired the
    // effect on every render and flooded /api/auth/method; setUser is now a
    // stable ref, but a mount-only effect is the correct shape regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Log environment information on component mount (dev-only: this block also
  // fired a /health probe and dumped env/localStorage details into the prod
  // console on every login-page visit).
  useEffect(() => {
    if (!import.meta.env.DEV) return
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

  // Credentials form submit. When Authentik/OIDC is configured the credentials
  // are verified AGAINST AUTHENTIK (server-side flow-executor — no redirect);
  // the local users-table login is only the fallback for stacks without
  // Authentik (local dev, CI ephemeral environments).
  const handleCredentialsLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { token, user } = authMethods?.oidcConfigured
        ? await authAPI.loginWithAuthentikPassword({ email, password })
        : await authAPI.login({ email, password })

      if (token && user) {
        setUser(user)
        window.location.href = '/dashboard'
      } else {
        throw new Error('Invalid response from server')
      }
    } catch (err: any) {
      console.error('❌ Login error:', err)
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

      {/* Credentials form — the DEFAULT sign-in UI. When Authentik/OIDC is
          configured, submitting verifies the credentials against AUTHENTIK
          server-side (no redirect); Authentik stays the sole identity
          authority. Without Authentik (local dev / CI stacks) the same form
          falls back to the local users-table login. */}
      {authMethods && (
        <form onSubmit={handleCredentialsLogin}>
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
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      )}

      {/* Google sign-in — federated through Authentik (the platform never
          contacts Google directly), so the button starts the Authentik OIDC
          redirect flow where Google is offered as the identity provider. */}
      {authMethods?.oidcConfigured && (
        <div style={{ marginTop: '1rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              margin: '16px 0',
              color: 'var(--text-tertiary)',
            }}
          >
            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border-color)' }} />
            <span style={{ padding: '0 15px', fontSize: '14px' }}>or</span>
            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border-color)' }} />
          </div>
          <button
            type="button"
            onClick={handleOIDCLogin}
            disabled={loading}
            aria-label="Sign in with Google"
            style={{
              width: '100%',
              padding: '12px',
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
            }}
          >
            {/* Official Google "G" mark — see GOOGLE_BRAND above. */}
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill={GOOGLE_BRAND.red} d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill={GOOGLE_BRAND.blue} d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill={GOOGLE_BRAND.yellow} d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill={GOOGLE_BRAND.green} d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>
            {loading ? 'Redirecting...' : 'Sign in with Google'}
          </button>
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

      {/* Sign-up affordance — redirects into Authentik enrollment (the OIDC path) */}
      <div
        style={{
          marginTop: '1.5rem',
          paddingTop: '1.5rem',
          borderTop: '1px solid var(--border-color)',
          textAlign: 'center',
        }}
      >
        <p style={{ margin: '0 0 0.75rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {t('signUpMessage')}
        </p>
        <button
          type="button"
          onClick={handleOIDCLogin}
          disabled={loading}
          className="btn btn-secondary"
          style={{ width: '100%' }}
        >
          {loading ? 'Redirecting…' : t('signUp')}
        </button>
      </div>
    </div>
  )
}

export default LoginPage


