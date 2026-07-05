import React, { useState, useEffect } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { createOrganization } from '../services/api'
import { useAppContext } from '../lib/shared'

/**
 * CreateOrganizationPage — Plan G.
 *
 * Provides a form to create a new (non-personal) organization.
 * Auto-derives slug from name, dispatches SET_ORGANIZATIONS + SET_ACTIVE_ORGANIZATION on success.
 */

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function CreateOrganizationPage() {
  const { t } = useLanguage()
  const { state, dispatch } = useAppContext()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  // Auto-derive slug from name unless user has manually edited slug
  useEffect(() => {
    if (!slugManuallyEdited) {
      setSlug(deriveSlug(name))
    }
  }, [name, slugManuallyEdited])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const org = await createOrganization({ name: name.trim(), slug: slug || deriveSlug(name.trim()), type: 'organization' })
      // Append org to org list + set active
      dispatch({
        type: 'SET_ORGANIZATIONS',
        payload: [...state.organizations, org],
      })
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

        <div className="form-group">
          <label htmlFor="org-slug">
            Slug
            {!slugManuallyEdited && (
              <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                (auto-derived)
              </span>
            )}
          </label>
          <input
            id="org-slug"
            type="text"
            value={slug}
            onChange={e => {
              setSlug(e.target.value)
              setSlugManuallyEdited(true)
            }}
            placeholder="my-organization"
            pattern="[a-zA-Z0-9_-]+"
            title="Only letters, numbers, hyphens, and underscores"
          />
          {slug && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>
              URL: /organizations/{slug}
            </p>
          )}
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
