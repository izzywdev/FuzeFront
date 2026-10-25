import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Input, Select, Textarea } from '@fuzefront/design-system'
import { useAppContext, App } from '../lib/shared'
import { useFlag } from '../platform/featureFlags'
import { useAppRegistry } from '../platform/appRegistry'
import type { AppManifest } from '@fuzefront/app-registry-client'
import {
  createApp,
  updateApp,
  updateAppStatus,
  deleteApp,
  fetchApps,
} from '../services/api'

interface AppFormData {
  name: string
  url: string
  iconUrl: string
  integrationType: 'iframe' | 'module-federation' | 'web-component'
  remoteUrl: string
  scope: string
  module: string
  description: string
}

type IntegrationType = AppFormData['integrationType']

/**
 * The ONE form <-> manifest mapping, driven by `integration.type` and matching
 * `Integration` in services/app-registry-service/openapi.yaml and what
 * FederatedAppLoader actually reads per type:
 *   - module-federation: remoteEntry, scope, module (all required) -> form
 *     remoteUrl / scope / module. url is optional.
 *   - iframe | spa: url (required) -> form url.
 *   - web-component: url = script URL (required), scope = custom-element tag
 *     (required). The form shows the script URL as "Script URL" (remoteUrl);
 *     url mirrors it.
 */
const URL_SHAPE = /^(https?:\/\/\S+|\/(?![/\\])[^\s?#\\]*)$/

export function seedFormFromManifest(manifest: AppManifest): AppFormData {
  const i = manifest.integration
  const type = (i.type === 'spa' ? 'iframe' : i.type) as IntegrationType
  const url = i.url ?? ''
  return {
    name: manifest.name,
    url,
    iconUrl: manifest.icon?.kind === 'url' ? manifest.icon.value : '',
    integrationType: type,
    remoteUrl:
      i.type === 'module-federation'
        ? (i.remoteEntry ?? '')
        : i.type === 'web-component'
          ? url
          : '',
    scope: i.scope ?? '',
    module: i.module ?? '',
    description: manifest.description ?? '',
  }
}

export interface ManifestBuild {
  manifest: AppManifest
  errors: string[]
}

export function buildManifestFromForm(
  base: AppManifest,
  form: AppFormData
): ManifestBuild {
  const errors: string[] = []
  const t = (v: string) => v.trim()
  const check = (label: string, v: string, required: boolean) => {
    if (!v) {
      if (required) errors.push(`${label} is required`)
    } else if (!URL_SHAPE.test(v)) {
      errors.push(`${label} must be an http(s) URL or a same-origin path`)
    }
  }
  // The form folds spa into iframe; keep an unchanged spa as spa.
  const type: IntegrationType | 'spa' =
    base.integration.type === 'spa' && form.integrationType === 'iframe'
      ? 'spa'
      : form.integrationType
  const integration: Record<string, unknown> = { type }
  const url = t(form.url)
  const remote = t(form.remoteUrl)
  const scope = t(form.scope)
  const mod = t(form.module)

  if (type === 'module-federation') {
    check('Remote URL', remote, true)
    check('App URL', url, false)
    if (!scope) errors.push('Scope is required')
    if (!mod) errors.push('Module is required')
    integration.remoteEntry = remote
    integration.scope = scope
    integration.module = mod
    if (url) integration.url = url
  } else if (type === 'web-component') {
    // Script URL (remoteUrl) wins; fall back to the App URL field.
    const script = remote || url
    check('Script URL', script, true)
    if (!scope) errors.push('Component Name is required')
    integration.url = script
    integration.scope = scope
  } else {
    check('App URL', url, true)
    integration.url = url
  }

  const manifest: AppManifest = {
    ...base,
    name: t(form.name),
    integration: integration as AppManifest['integration'],
  }
  if (!manifest.name) errors.push('Name is required')
  const description = t(form.description)
  if (description) manifest.description = description
  else delete manifest.description
  const icon = t(form.iconUrl)
  if (icon) manifest.icon = { kind: 'url', value: icon }
  else if (base.icon?.kind === 'url') delete manifest.icon
  return { manifest, errors }
}

/** Map an updateApp / getApp failure to a user-facing message by status. */
function describeSaveError(err: unknown): string {
  const e = err as {
    response?: { status?: number; data?: { message?: string; fields?: { path: string; message: string }[] } }
    message?: string
  }
  const status = e?.response?.status
  const data = e?.response?.data
  switch (status) {
    case 400: {
      const detail = data?.fields?.map(f => `${f.path}: ${f.message}`).join('; ')
      return `Invalid app data${detail ? ` (${detail})` : data?.message ? ` (${data.message})` : ''}`
    }
    case 403:
      return 'You do not have permission to edit this app'
    case 404:
      return 'App not found - it may have been removed'
    case 503:
      return 'App editing is not enabled yet'
    default:
      if (status && status >= 500) return 'Failed to save app (server error)'
      return e?.message || 'Failed to save app'
  }
}

// Contract (`Integration.url` / `remoteEntry`): an absolute http(s) URL OR a
// same-origin absolute path such as /apps/clock/. `type="url"` would reject the
// latter, making registry-managed same-origin apps impossible to save.
const URL_OR_SAME_ORIGIN_PATH = '^(https?://\\S+|/(?![/\\\\])[^\\s?#\\\\]*)$'

const initialFormData: AppFormData = {
  name: '',
  url: '',
  iconUrl: '',
  integrationType: 'iframe',
  remoteUrl: '',
  scope: '',
  module: '',
  description: '',
}

export default function AdminPage() {
  const navigate = useNavigate()
  // Key catalog (design/frames/config-management, FF-EPIC-19-S4), default OFF.
  const configCatalogEnabled = useFlag('fuzefront.config.key-catalog', false)
  const { state, dispatch } = useAppContext()
  const [showForm, setShowForm] = useState(false)
  const [editingApp, setEditingApp] = useState<App | null>(null)
  const { client: registryClient, refresh: refreshRegistry } = useAppRegistry()
  const [formData, setFormData] = useState<AppFormData>(initialFormData)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load apps on component mount
  useEffect(() => {
    loadApps()
  }, [])

  const loadApps = async () => {
    try {
      const apps = await fetchApps() // Now returns apps with health status
      dispatch({ type: 'SET_APPS', payload: apps })
    } catch (err) {
      setError('Failed to load apps')
    }
  }

  const handleInputChange = (field: keyof AppFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      if (editingApp) {
        if (editingApp.slug) {
          // Registry-managed app: the manifest is the source of truth, so edit
          // it through the contracted updateApp (PUT /api/v1/app-registry/
          // apps/{slug}) rather than the legacy flat-column route.
          const current = await registryClient.getApp(editingApp.slug)
          const { manifest, errors } = buildManifestFromForm(
            current.manifest,
            formData
          )
          if (errors.length > 0) {
            setError(errors.join('; '))
            return
          }
          await registryClient.updateApp(editingApp.slug, manifest)
          // The provider caches manifests (menu/dashboard); re-fetch so they
          // do not keep serving the pre-edit manifest.
          await refreshRegistry()
        } else {
          // Legacy manifest-less row (created via POST /api/apps).
          await updateApp(editingApp.id, formData)
        }
        await loadApps()
      } else {
        // Create new app
        await createApp(formData)
        await loadApps() // Refresh the list
      }

      // Reset form
      setFormData(initialFormData)
      setShowForm(false)
      setEditingApp(null)
    } catch (err) {
      setError(editingApp ? describeSaveError(err) : err instanceof Error ? err.message : 'Failed to save app')
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = async (app: App) => {
    setError(null)
    let seeded: AppFormData = {
      name: app.name,
      url: app.url,
      iconUrl: app.iconUrl || '',
      integrationType: app.integrationType,
      remoteUrl: app.remoteUrl || '',
      scope: app.scope || '',
      module: app.module || '',
      description: app.description || '',
    }
    if (app.slug) {
      // Registry-managed: seed from the manifest (source of truth), not the
      // legacy flat columns, so the form round-trips losslessly.
      try {
        seeded = seedFormFromManifest(
          (await registryClient.getApp(app.slug)).manifest
        )
      } catch (err) {
        setError(describeSaveError(err))
        return
      }
    }
    setEditingApp(app)
    setFormData(seeded)
    setShowForm(true)
  }

  const handleToggleStatus = async (app: App) => {
    try {
      await updateAppStatus(app.id, !app.isActive)
      await loadApps() // Refresh the list
    } catch (err) {
      setError('Failed to update app status')
    }
  }

  const handleDelete = async (app: App) => {
    if (!window.confirm(`Are you sure you want to delete "${app.name}"?`)) {
      return
    }

    try {
      await deleteApp(app.id)
      await loadApps() // Refresh the list
    } catch (err) {
      setError('Failed to delete app')
    }
  }

  const cancelForm = () => {
    setFormData(initialFormData)
    setShowForm(false)
    setEditingApp(null)
    setError(null)
  }

  return (
    <div style={{ padding: '2rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
        }}
      >
        <h1>🛠️ App Registry Administration</h1>
        <Button variant="primary" onClick={() => setShowForm(true)} disabled={showForm}>
          ➕ Register New App
        </Button>
      </div>

      {configCatalogEnabled && (
        <div style={{ marginBottom: '1.5rem' }} data-nav="config-catalog">
          <Button variant="secondary" onClick={() => navigate('/admin/config/catalog')}>
            🔑 Configuration key catalog
          </Button>
        </div>
      )}

      {error && (
        <Alert tone="error" onDismiss={() => setError(null)} style={{ marginBottom: '1rem' }}>
          {error}
        </Alert>
      )}

      {showForm && (
        <div
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '2rem',
            marginBottom: '2rem',
          }}
        >
          <h3>{editingApp ? 'Edit App' : 'Register New App'}</h3>
          <form onSubmit={handleSubmit}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '1rem',
              }}
            >
              <Input
                label="App Name *"
                type="text"
                value={formData.name}
                onChange={e => handleInputChange('name', e.target.value)}
                required
                placeholder="My Awesome App"
              />

              <Select
                label="Integration Type *"
                value={formData.integrationType}
                onChange={e =>
                  handleInputChange('integrationType', e.target.value)
                }
                options={[
                  { value: 'iframe', label: 'Iframe' },
                  { value: 'module-federation', label: 'Module Federation' },
                  { value: 'web-component', label: 'Web Component' },
                ]}
              />

              <Input
                label="App URL *"
                type="text"
                pattern={URL_OR_SAME_ORIGIN_PATH}
                value={formData.url}
                onChange={e => handleInputChange('url', e.target.value)}
                required={!editingApp?.slug}
                placeholder="https://myapp.example.com"
              />

              <Input
                label="Icon URL"
                type="url"
                value={formData.iconUrl}
                onChange={e => handleInputChange('iconUrl', e.target.value)}
                placeholder="https://cdn.example.com/icon.svg"
              />

              {formData.integrationType === 'module-federation' && (
                <>
                  <Input
                    label="Remote URL *"
                    type="text"
                    pattern={URL_OR_SAME_ORIGIN_PATH}
                    value={formData.remoteUrl}
                    onChange={e =>
                      handleInputChange('remoteUrl', e.target.value)
                    }
                    required
                    placeholder="https://myapp.example.com"
                  />

                  <Input
                    label="Scope *"
                    type="text"
                    value={formData.scope}
                    onChange={e => handleInputChange('scope', e.target.value)}
                    required
                    placeholder="myApp"
                  />

                  <Input
                    label="Module *"
                    type="text"
                    value={formData.module}
                    onChange={e =>
                      handleInputChange('module', e.target.value)
                    }
                    required
                    placeholder="./App"
                  />
                </>
              )}

              {formData.integrationType === 'web-component' && (
                <>
                  <Input
                    label="Script URL"
                    type="text"
                    pattern={URL_OR_SAME_ORIGIN_PATH}
                    value={formData.remoteUrl}
                    onChange={e =>
                      handleInputChange('remoteUrl', e.target.value)
                    }
                    placeholder="https://myapp.example.com/component.js"
                  />

                  <Input
                    label="Component Name"
                    type="text"
                    value={formData.scope}
                    onChange={e => handleInputChange('scope', e.target.value)}
                    placeholder="my-custom-element"
                  />
                </>
              )}

              <div style={{ gridColumn: '1 / -1' }}>
                <Textarea
                  label="Description"
                  value={formData.description}
                  onChange={e =>
                    handleInputChange('description', e.target.value)
                  }
                  placeholder="Brief description of the application"
                />
              </div>
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
              <Button type="submit" variant="primary" disabled={loading}>
                {loading
                  ? 'Saving...'
                  : editingApp
                    ? 'Update App'
                    : 'Register App'}
              </Button>
              <Button type="button" variant="secondary" onClick={cancelForm}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      <div
        style={{
          backgroundColor: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ backgroundColor: 'var(--bg-quaternary)' }}>
            <tr>
              <th
                style={{
                  padding: '1rem',
                  textAlign: 'left',
                  borderBottom: '1px solid var(--border-color)',
                }}
              >
                App
              </th>
              <th
                style={{
                  padding: '1rem',
                  textAlign: 'left',
                  borderBottom: '1px solid var(--border-color)',
                }}
              >
                Type
              </th>
              <th
                style={{
                  padding: '1rem',
                  textAlign: 'left',
                  borderBottom: '1px solid var(--border-color)',
                }}
              >
                Status
              </th>
              <th
                style={{
                  padding: '1rem',
                  textAlign: 'left',
                  borderBottom: '1px solid var(--border-color)',
                }}
              >
                URL
              </th>
              <th
                style={{
                  padding: '1rem',
                  textAlign: 'center',
                  borderBottom: '1px solid var(--border-color)',
                }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {state.apps.map(app => (
              <tr key={app.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                <td style={{ padding: '1rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    {app.iconUrl ? (
                      <img
                        src={app.iconUrl}
                        alt=""
                        style={{ width: '24px', height: '24px' }}
                        onError={e => {
                          (e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '14px',
                          background:
                            app.integrationType === 'module-federation'
                              ? 'linear-gradient(135deg, #1f4f5f, #5fb3d4)'
                              : app.integrationType === 'iframe'
                                ? 'linear-gradient(135deg, #4f3f1f, #d4b35f)'
                                : 'linear-gradient(135deg, #3f1f4f, #b35fd4)',
                        }}
                      >
                        {app.integrationType === 'module-federation'
                          ? '🔗'
                          : app.integrationType === 'iframe'
                            ? '🖼️'
                            : app.integrationType === 'web-component'
                              ? '🧩'
                              : '📱'}
                      </div>
                    )}
                    <div>
                      <div style={{ fontWeight: 'bold' }}>{app.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                        {app.description}
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '1rem' }}>
                  <span
                    style={{
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                      backgroundColor:
                        app.integrationType === 'module-federation'
                          ? '#1f4f5f'
                          : app.integrationType === 'iframe'
                            ? '#4f3f1f'
                            : '#3f1f4f',
                      color:
                        app.integrationType === 'module-federation'
                          ? '#5fb3d4'
                          : app.integrationType === 'iframe'
                            ? '#d4b35f'
                            : '#b35fd4',
                    }}
                  >
                    {app.integrationType}
                  </span>
                </td>
                <td style={{ padding: '1rem' }}>
                  <span
                    style={{
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                      backgroundColor: app.isActive ? '#1f4f1f' : '#4f1f1f',
                      color: app.isActive ? 'var(--success-color)' : 'var(--error-color)',
                    }}
                  >
                    {app.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ padding: '1rem' }}>
                  <a
                    href={app.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: 'var(--accent-color)',
                      textDecoration: 'none',
                      fontSize: '0.9rem',
                    }}
                  >
                    {app.url}
                  </a>
                </td>
                <td style={{ padding: '1rem', textAlign: 'center' }}>
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.5rem',
                      justifyContent: 'center',
                    }}
                  >
                    <button
                      className="btn"
                      onClick={() => handleEdit(app)}
                      style={{
                        backgroundColor: 'var(--accent-color)',
                        border: 'none',
                        color: 'white',
                        padding: '0.5rem',
                        fontSize: '0.8rem',
                      }}
                    >
                      ✏️ Edit
                    </button>
                    <button
                      className="btn"
                      onClick={() => handleToggleStatus(app)}
                      style={{
                        backgroundColor: app.isActive ? 'var(--warning-color)' : 'var(--success-color)',
                        border: 'none',
                        color: 'white',
                        padding: '0.5rem',
                        fontSize: '0.8rem',
                      }}
                    >
                      {app.isActive ? '⏸️ Deactivate' : '▶️ Activate'}
                    </button>
                    <button
                      className="btn"
                      onClick={() => handleDelete(app)}
                      style={{
                        backgroundColor: 'var(--error-color)',
                        border: 'none',
                        color: 'white',
                        padding: '0.5rem',
                        fontSize: '0.8rem',
                      }}
                    >
                      🗑️ Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {state.apps.length === 0 && (
          <div
            style={{
              padding: '3rem',
              textAlign: 'center',
              color: 'var(--text-tertiary)',
            }}
          >
            <h3>No apps registered yet</h3>
            <p>Click "Register New App" to add your first application.</p>
          </div>
        )}
      </div>
    </div>
  )
}
