import React, { useState } from 'react'
import { useCurrentUser } from '@frontfuse/shared'
import { login } from '../services/api'
import FrontFuseLogo from '../assets/FrontFuseLogo.png'

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { setUser } = useCurrentUser()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { token, user } = await login(email, password)

      // Ensure token is stored and user is set
      if (token && user) {
        setUser(user)
        // Force a page reload to ensure proper app initialization
        window.location.href = '/dashboard'
      } else {
        throw new Error('Invalid response from server')
      }
    } catch (err: any) {
      console.error('Login error:', err)
      setError(err.response?.data?.error || err.message || 'Login failed')
    } finally {
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
          <div style={{ color: 'red', marginBottom: '1rem' }}>{error}</div>
        )}

        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <div style={{ marginTop: '2rem', fontSize: '0.9rem', color: '#ccc' }}>
        <p>Demo credentials:</p>
        <p>Email: admin@frontfuse.dev</p>
        <p>Password: admin123</p>
      </div>
    </div>
  )
}

export default LoginPage
