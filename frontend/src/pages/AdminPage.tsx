import React, { useState, useEffect } from 'react'
import { useAppContext, App } from '../lib/shared'
import {
  createApp,
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
  const { state, dispatch } = useAppContext()
  const [showForm, setShowForm] = useState(false)
  const [editingApp, setEditingApp] = useState<App | null>(null)
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
        // Update existing app (implement PUT endpoint)
        console.log('Update app:', editingApp.id, formData)
        // For now, just refresh the list
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
      setError(err instanceof Error ? err.message : 'Failed to save app')
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (app: App) => {
    setEditingApp(app)
    setFormData({
      name: app.name,
      url: app.url,
      iconUrl: app.iconUrl || '',
      integrationType: app.integrationType,
      remoteUrl: app.remoteUrl || '',
      scope: app.scope || '',
      module: app.module || '',
      description: app.description || '',
    })
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
        <button
          className="btn btn-primary"
          onClick={() => setShowForm(true)}
          disabled={showForm}
        >
          ➕ Register New App
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: '#2a1f1f',
            border: '1px solid #ff6b6b',
            borderRadius: '4px',
            color: '#ff6b6b',
            marginBottom: '1rem',
          }}
        >
          {error}
          <button
            style={{
              background: 'none',
              border: 'none',
              color: '#ff6b6b',
              float: 'right',
              cursor: 'pointer',
            }}
            onClick={() => setError(null)}
          >
            ✕
          </button>
        </div>
      )}

      {showForm && (
        <div
          style={{
            backgroundColor: '#1a1a1a',
            border: '1px solid #333',
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
              <div className="form-group">
                <label>App Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={e => handleInputChange('name', e.target.value)}
                  required
                  placeholder="My Awesome App"
                />
              </div>

              <div className="form-group">
                <label>Integration Type *</label>
                <select
                  value={formData.integrationType}
                  onChange={e =>
                    handleInputChange('integrationType', e.target.value)
                  }
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    backgroundColor: '#2a2a2a',
                    color: 'white',
                  }}
                >
                  <option value="iframe">Iframe</option>
                  <option value="module-federation">Module Federation</option>
                  <option value="web-component">Web Component</option>
                </select>
              </div>

              <div className="form-group">
                <label>App URL *</label>
                <input
                  type="url"
                  value={formData.url}
                  onChange={e => handleInputChange('url', e.target.value)}
                  required
                  placeholder="https://myapp.example.com"
                />
              </div>

              <div className="form-group">
                <label>Icon URL</label>
                <input
                  type="url"
                  value={formData.iconUrl}
                  onChange={e => handleInputChange('iconUrl', e.target.value)}
                  placeholder="https://cdn.example.com/icon.svg"
                />
              </div>

              {formData.integrationType === 'module-federation' && (
                <>
                  <div className="form-group">
                    <label>Remote URL *</label>
                    <input
                      type="url"
                      value={formData.remoteUrl}
                      onChange={e =>
                        handleInputChange('remoteUrl', e.target.value)
                      }
                      required
                      placeholder="https://myapp.example.com"
                    />
                  </div>

                  <div className="form-group">
                    <label>Scope *</label>
                    <input
                      type="text"
                      value={formData.scope}
                      onChange={e => handleInputChange('scope', e.target.value)}
                      required
                      placeholder="myApp"
                    />
                  </div>

                  <div className="form-group">
                    <label>Module *</label>
                    <input
                      type="text"
                      value={formData.module}
                      onChange={e =>
                        handleInputChange('module', e.target.value)
                      }
                      required
                      placeholder="./App"
                    />
                  </div>
                </>
              )}

              {formData.integrationType === 'web-component' && (
                <>
                  <div className="form-group">
                    <label>Script URL</label>
                    <input
                      type="url"
                      value={formData.remoteUrl}
                      onChange={e =>
                        handleInputChange('remoteUrl', e.target.value)
                      }
                      placeholder="https://myapp.example.com/component.js"
                    />
                  </div>

                  <div className="form-group">
                    <label>Component Name</label>
                    <input
                      type="text"
                      value={formData.scope}
                      onChange={e => handleInputChange('scope', e.target.value)}
                      placeholder="my-custom-element"
                    />
                  </div>
                </>
              )}

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Description</label>
                <textarea
                  value={formData.description}
                  onChange={e =>
                    handleInputChange('description', e.target.value)
                  }
                  placeholder="Brief description of the application"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    backgroundColor: '#2a2a2a',
                    color: 'white',
                    minHeight: '80px',
                    resize: 'vertical',
                  }}
                />
              </div>
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                {loading
                  ? 'Saving...'
                  : editingApp
                    ? 'Update App'
                    : 'Register App'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={cancelForm}
                style={{
                  backgroundColor: '#666',
                  border: 'none',
                  color: 'white',
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div
        style={{
          backgroundColor: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ backgroundColor: '#2a2a2a' }}>
            <tr>
              <th
                style={{
                  padding: '1rem',
                  textAlign: 'left',
                  borderBottom: '1px solid #333',
                }}
              >
                App
              </th>
              <th
                style={{
                  padding: '1rem',
                  textAlign: 'left',
                  borderBottom: '1px solid #333',
                }}
              >
                Type
              </th>
              <th
                style={{
                  padding: '1rem',
                  textAlign: 'left',
                  borderBottom: '1px solid #333',
                }}
              >
                Status
              </th>
              <th
                style={{
                  padding: '1rem',
                  textAlign: 'left',
                  borderBottom: '1px solid #333',
                }}
              >
                URL
              </th>
              <th
                style={{
                  padding: '1rem',
                  textAlign: 'center',
                  borderBottom: '1px solid #333',
                }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {state.apps.map(app => (
              <tr key={app.id} style={{ borderBottom: '1px solid #333' }}>
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
                          ;(e.target as HTMLImageElement).style.display = 'none'
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
                      <div style={{ fontSize: '0.8rem', color: '#888' }}>
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
                      color: app.isActive ? '#5fd45f' : '#d45f5f',
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
                      color: '#646cff',
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
                        backgroundColor: '#646cff',
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
                        backgroundColor: app.isActive ? '#f39c12' : '#27ae60',
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
                        backgroundColor: '#e74c3c',
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
              color: '#888',
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
