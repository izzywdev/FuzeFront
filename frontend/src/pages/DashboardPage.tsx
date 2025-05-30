import React, { useEffect, useState } from 'react'
import { useAppContext, useCurrentUser, App } from '@apphub/shared'
import { fetchApps } from '../services/api'

function DashboardPage() {
  const { state, dispatch } = useAppContext()
  const { user } = useCurrentUser()
  const [allApps, setAllApps] = useState<App[]>([])

  useEffect(() => {
    const loadApps = async () => {
      try {
        const apps = await fetchApps() // Now returns apps with health status
        setAllApps(apps)
        dispatch({ type: 'SET_APPS', payload: apps })
      } catch (error) {
        console.error('Failed to load apps:', error)
      }
    }
    loadApps()
  }, [dispatch])

  const handleAppClick = (app: App) => {
    if (!app.isHealthy) {
      alert(
        `${app.name} is currently unavailable. Please try again later or contact support.`
      )
      return
    }
    window.location.href = `/app/${app.id}`
  }

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1>
          Welcome to AppHub{user?.firstName ? `, ${user.firstName}` : ''}!
        </h1>
        <p style={{ color: '#888', fontSize: '1.1rem' }}>
          Your central hub for accessing all your applications
        </p>
      </div>

      {allApps.length > 0 ? (
        <div>
          <h2 style={{ marginBottom: '1.5rem' }}>Available Applications</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '1.5rem',
            }}
          >
            {allApps.map(app => (
              <div
                key={app.id}
                style={{
                  padding: '1.5rem',
                  border: '1px solid #333',
                  borderRadius: '8px',
                  backgroundColor: '#1a1a1a',
                  cursor: app.isHealthy ? 'pointer' : 'not-allowed',
                  transition: 'all 0.2s ease',
                  opacity: app.isHealthy ? 1 : 0.6,
                  filter: app.isHealthy ? 'none' : 'grayscale(0.5)',
                }}
                onClick={() => handleAppClick(app)}
                onMouseEnter={e => {
                  if (app.isHealthy) {
                    e.currentTarget.style.borderColor = '#646cff'
                    e.currentTarget.style.transform = 'translateY(-2px)'
                  }
                }}
                onMouseLeave={e => {
                  if (app.isHealthy) {
                    e.currentTarget.style.borderColor = '#333'
                    e.currentTarget.style.transform = 'translateY(0)'
                  }
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    marginBottom: '1rem',
                  }}
                >
                  <div style={{ position: 'relative' }}>
                    {app.iconUrl ? (
                      <img
                        src={app.iconUrl}
                        alt=""
                        style={{ width: '40px', height: '40px' }}
                        onError={e => {
                          ;(e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          backgroundColor: 'var(--bg-tertiary)',
                          borderRadius: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1.5rem',
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

                    {/* Health Status Indicator */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '-2px',
                        right: '-2px',
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        backgroundColor: app.isHealthy ? '#6bcf7f' : '#ff6b6b',
                        border: '2px solid #1a1a1a',
                      }}
                    />
                  </div>

                  <div>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: '1.2rem',
                        color: app.isHealthy ? '#fff' : '#888',
                      }}
                    >
                      {app.name}
                      {!app.isHealthy && (
                        <span
                          style={{
                            color: '#ff6b6b',
                            fontSize: '0.9rem',
                            marginLeft: '8px',
                          }}
                        >
                          (Offline)
                        </span>
                      )}
                    </h3>
                    <span
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.2rem 0.5rem',
                        borderRadius: '4px',
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
                  </div>
                </div>
                {app.description && (
                  <p
                    style={{
                      margin: 0,
                      color: app.isHealthy ? '#888' : '#666',
                      fontSize: '0.9rem',
                      lineHeight: '1.4',
                    }}
                  >
                    {app.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          style={{
            textAlign: 'center',
            padding: '3rem',
            color: '#888',
          }}
        >
          <h3>No applications available</h3>
          <p>Contact your administrator to get access to applications.</p>
        </div>
      )}

      <div
        style={{
          marginTop: '3rem',
          padding: '1.5rem',
          border: '1px solid #333',
          borderRadius: '8px',
          backgroundColor: '#1a1a1a',
        }}
      >
        <h3>Quick Actions</h3>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button
            className="btn"
            onClick={() => (window.location.href = '/help')}
            style={{
              backgroundColor: '#333',
              border: 'none',
              color: 'white',
            }}
          >
            📖 View Documentation
          </button>
          {user?.roles.includes('admin') && (
            <button
              className="btn"
              onClick={() => (window.location.href = '/admin')}
              style={{
                backgroundColor: '#f39c12',
                border: 'none',
                color: 'white',
              }}
            >
              ⚙️ Admin Panel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default DashboardPage
