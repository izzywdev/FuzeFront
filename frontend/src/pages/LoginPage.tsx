import React, { useState } from 'react'
import { useCurrentUser } from '@apphub/shared'
import { login } from '../services/api'

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
      const { user } = await login(email, password)
      setUser(user)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-form">
      <h2>Welcome to AppHub</h2>
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
        <p>Email: admin@apphub.dev</p>
        <p>Password: admin123</p>
      </div>
    </div>
  )
}

export default LoginPage
