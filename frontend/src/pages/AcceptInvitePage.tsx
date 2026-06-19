import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useCurrentUser } from '../lib/shared'
import { getInvitation, acceptInvitation } from '../services/api'

interface InvitationDetails {
  id: string
  email: string
  role: string
  expires_at: string
  status: string
}

interface OrgDetails {
  id: string
  name: string
  slug: string
}

/**
 * AcceptInvitePage — handles /invitations/:token
 *
 * Resolves the token server-side, shows org + role info, then:
 * - If authenticated with matching email: lets user accept immediately.
 * - If unauthenticated or wrong email: directs to enroll/login.
 */
function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { isAuthenticated, user } = useCurrentUser()

  const [invitation, setInvitation] = useState<InvitationDetails | null>(null)
  const [organization, setOrganization] = useState<OrgDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gone, setGone] = useState(false)
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    if (!token) {
      setError('Invalid invitation link')
      setLoading(false)
      return
    }

    getInvitation(token)
      .then((data: any) => {
        setInvitation(data.invitation)
        setOrganization(data.organization)
      })
      .catch((err: any) => {
        if (err.response?.status === 410) {
          setGone(true)
        } else if (err.response?.status === 404) {
          setError('Invitation not found')
        } else {
          setError('Failed to load invitation')
        }
      })
      .finally(() => setLoading(false))
  }, [token])

  const handleAccept = async () => {
    if (!token) return
    setAccepting(true)
    setError(null)
    try {
      const result = await acceptInvitation(token)
      if (result.action === 'enroll') {
        window.location.href = result.enrollUrl
        return
      }
      setAccepted(true)
    } catch (err: any) {
      if (err.response?.status === 202) {
        // Non-authenticated path via axios (202 is not an error but some configs throw)
        window.location.href = err.response.data?.enrollUrl || '/login'
        return
      }
      if (err.response?.status === 403) {
        setError('This invitation was sent to a different email address.')
      } else if (err.response?.status === 409) {
        setError('This invitation has already been accepted.')
      } else if (err.response?.status === 410) {
        setGone(true)
      } else {
        setError(err.response?.data?.error ?? 'Failed to accept invitation')
      }
    } finally {
      setAccepting(false)
    }
  }

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    background: 'var(--bg-primary)',
    padding: '2rem',
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    padding: '2rem',
    maxWidth: '440px',
    width: '100%',
    textAlign: 'center' as const,
  }

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p style={{ color: 'var(--text-secondary)' }}>Loading invitation…</p>
        </div>
      </div>
    )
  }

  if (gone) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p style={{ fontSize: '2rem', margin: '0 0 1rem' }}>⚠️</p>
          <h2 style={{ margin: '0 0 0.5rem', color: 'var(--text-primary)' }}>Invitation expired</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            This invitation has expired or been revoked. Please ask to be re-invited.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/login')}
          >
            Go to login
          </button>
        </div>
      </div>
    )
  }

  if (error && !invitation) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p style={{ fontSize: '2rem', margin: '0 0 1rem' }}>❌</p>
          <h2 style={{ margin: '0 0 0.5rem', color: 'var(--text-primary)' }}>Something went wrong</h2>
          <p style={{ color: 'var(--error-color)', marginBottom: '1.5rem' }}>{error}</p>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/login')}
          >
            Go to login
          </button>
        </div>
      </div>
    )
  }

  if (accepted) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p style={{ fontSize: '2rem', margin: '0 0 1rem' }}>✓</p>
          <h2 style={{ margin: '0 0 0.5rem', color: 'var(--text-primary)' }}>
            You have joined {organization?.name}
          </h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            Your role is <strong>{invitation?.role}</strong>.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/organizations')}
          >
            Go to Organizations
          </button>
        </div>
      </div>
    )
  }

  const emailMatches = isAuthenticated && user && invitation &&
    user.email.toLowerCase() === invitation.email.toLowerCase()

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <p style={{ fontSize: '2rem', margin: '0 0 1rem' }}>✉️</p>
        <h2 style={{ margin: '0 0 0.5rem', color: 'var(--text-primary)' }}>
          You are invited to join
        </h2>
        <h3 style={{ margin: '0 0 1rem', color: 'var(--accent-color)' }}>
          {organization?.name}
        </h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
          Role: <strong>{invitation?.role}</strong>
        </p>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          Invited to: {invitation?.email}
        </p>

        {error && (
          <div
            style={{
              color: 'var(--error-color)',
              marginBottom: '1rem',
              padding: '10px',
              border: '1px solid var(--error-color)',
              borderRadius: '4px',
              backgroundColor: 'rgba(255, 0, 0, 0.1)',
              fontSize: '0.9rem',
            }}
          >
            {error}
          </div>
        )}

        {isAuthenticated && emailMatches ? (
          <button
            className="btn btn-primary"
            onClick={handleAccept}
            disabled={accepting}
            style={{ width: '100%' }}
          >
            {accepting ? 'Accepting…' : `Accept invitation`}
          </button>
        ) : isAuthenticated && !emailMatches ? (
          <div>
            <p style={{ color: 'var(--error-color)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              You are signed in as <strong>{user?.email}</strong>, but this invitation is for <strong>{invitation?.email}</strong>.
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Please sign in with the correct account to accept this invitation.
            </p>
          </div>
        ) : (
          <div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Sign in or create an account to accept this invitation.
            </p>
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/login?invite=${token}`)}
              style={{ width: '100%', marginBottom: '0.75rem' }}
            >
              Sign in to accept
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleAccept}
              style={{ width: '100%' }}
            >
              Create an account
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default AcceptInvitePage
