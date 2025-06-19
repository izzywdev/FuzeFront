import React, { useState, useEffect } from 'react'
import { useCurrentUser } from '../lib/shared'
import { login } from '../services/api'
import FrontFuseLogo from '../assets/FrontFuseLogo.png'

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [diagnostics, setDiagnostics] = useState<any>(null)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const { setUser } = useCurrentUser()

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log('🎯 Login form submitted:', {
      email,
      passwordLength: password.length,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      currentURL: window.location.href,
    })

    setLoading(true)
    setError('')

    try {
      console.log('🔄 Starting login process...')
      const { token, user } = await login(email, password)

      console.log('🎉 Login successful:', {
        hasToken: !!token,
        hasUser: !!user,
        userEmail: user?.email,
        userRoles: user?.roles,
      })

      // Ensure token is stored and user is set
      if (token && user) {
        console.log('👤 Setting user in context...')
        setUser(user)
        console.log('🔄 Redirecting to dashboard...')
        // Force a page reload to ensure proper app initialization
        window.location.href = '/dashboard'
      } else {
        console.error('❌ Invalid response - missing token or user')
        throw new Error('Invalid response from server')
      }
    } catch (err: any) {
      console.error('❌ Login error in component:', {
        error: err,
        message: err.message,
        code: err.code,
        status: err.response?.status,
        responseData: err.response?.data,
        isAxiosError: err.isAxiosError,
        stack: err.stack,
      })

      let errorMessage =
        err.response?.data?.error || err.message || 'Login failed'

      // Add more context for common errors
      if (err.code === 'NETWORK_ERROR' || !err.response) {
        errorMessage +=
          ' (Network connection failed - check if backend is running)'
      } else if (err.response?.status === 500) {
        errorMessage += ' (Server error - check backend logs)'
      } else if (err.response?.status === 404) {
        errorMessage += ' (Login endpoint not found - check API configuration)'
      }

      console.log('📝 Setting error message:', errorMessage)
      setError(errorMessage)
    } finally {
      console.log('🏁 Login process completed, setting loading to false')
      setLoading(false)
    }
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

      <form onSubmit={handleSubmit}>
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

        {error && (
          <div
            style={{
              color: 'red',
              marginBottom: '1rem',
              padding: '10px',
              border: '1px solid red',
              borderRadius: '4px',
              backgroundColor: 'rgba(255, 0, 0, 0.1)',
            }}
          >
            <strong>Login Error:</strong>
            <br />
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <div style={{ marginTop: '1rem' }}>
        <button
          type="button"
          onClick={runNetworkDiagnostics}
          style={{
            padding: '8px 16px',
            backgroundColor: '#6c757d',
            color: 'white',
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
            border: '1px solid #ccc',
            borderRadius: '4px',
            backgroundColor: '#f8f9fa',
            fontSize: '12px',
            maxHeight: '300px',
            overflow: 'auto',
          }}
        >
          <h4>Network Diagnostics Results</h4>
          <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
        </div>
      )}

      <div style={{ marginTop: '2rem', fontSize: '0.9rem', color: '#ccc' }}>
        <p>Demo credentials:</p>
        <p>Email: admin@fuzefront.dev</p>
        <p>Password: admin123</p>
      </div>
    </div>
  )
}

export default LoginPage
