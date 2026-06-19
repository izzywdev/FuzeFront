import React, { useState } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { createOrganization } from '../services/api'
import { useAppContext } from '../lib/shared'

/**
 * CreateOrganizationPage — Plan F stub.
 *
 * Provides a minimal form to create a new (non-personal) organization.
 * Full org-account UX (invitations, avatar, billing) is Plan G.
 * The route is /organizations/new.
 */
function CreateOrganizationPage() {
  const { t } = useLanguage()
  const { dispatch } = useAppContext()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const org = await createOrganization({ name: name.trim() })
      // Optimistically append the new org to state so Plan G's org list is current.
      dispatch({ type: 'SET_ACTIVE_ORGANIZATION', payload: org.id })
      setSuccess(true)
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? t('error'))
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="auth-form" style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '2rem', margin: '0 0 1rem' }}>✓</p>
        <h3 style={{ margin: '0 0 0.5rem' }}>{t('success')}</h3>
        <p style={{ color: 'var(--text-secondary)', margin: '0 0 1.5rem' }}>
          {name} {t('createOrganizationDesc')}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => (window.location.href = '/dashboard')}
        >
          {t('dashboard')}
        </button>
      </div>
    )
  }

  return (
    <div className="auth-form">
      <h2 style={{ marginBottom: '0.25rem' }}>{t('createOrganization')}</h2>
      <p style={{ color: 'var(--text-secondary)', marginTop: 0, marginBottom: '1.5rem' }}>
        {t('createOrganizationDesc')}
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
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="org-name">{t('organizationName')}</label>
          <input
            id="org-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('organizationName')}
            required
            autoFocus
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || !name.trim()}
          style={{ width: '100%' }}
        >
          {loading ? t('loading') : t('createOrganization')}
        </button>
      </form>

      <div style={{ marginTop: '1rem', textAlign: 'center' }}>
        <button
          type="button"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent-color)',
            cursor: 'pointer',
            fontSize: '0.9rem',
          }}
          onClick={() => window.history.back()}
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  )
}

export default CreateOrganizationPage
