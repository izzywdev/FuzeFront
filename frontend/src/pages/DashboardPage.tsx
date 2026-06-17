import { useEffect, useState } from 'react'
import { useAppContext, useCurrentUser, App } from '../lib/shared'
import { fetchApps } from '../services/api'

function DashboardPage() {
  const { dispatch } = useAppContext()
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

  const integrationIcon = (type: App['integrationType']) =>
    type === 'module-federation'
      ? '🔗'
      : type === 'iframe'
        ? '🖼️'
        : type === 'web-component'
          ? '🧩'
          : '📱'

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>
          Welcome to FuzeFront{user?.firstName ? `, ${user.firstName}` : ''}!
        </h1>
        <p className="dashboard-subtitle">
          Your central hub for accessing all your applications
        </p>
      </div>

      {allApps.length > 0 ? (
        <div>
          <h2 className="section-title">Available Applications</h2>
          <div className="app-grid">
            {allApps.map(app => (
              <div
                key={app.id}
                className={`app-card${app.isHealthy ? '' : ' is-offline'}`}
                onClick={() => handleAppClick(app)}
              >
                <div className="app-card-head">
                  <div className="app-card-icon">
                    {app.iconUrl ? (
                      <img
                        src={app.iconUrl}
                        alt=""
                        className="app-icon-img"
                        onError={e => {
                          (e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    ) : (
                      <div
                        className={`app-icon-fallback type-${app.integrationType || 'other'}`}
                      >
                        {integrationIcon(app.integrationType)}
                      </div>
                    )}

                    {/* Health Status Indicator */}
                    <div
                      className={`health-dot${app.isHealthy ? '' : ' offline'}`}
                    />
                  </div>

                  <div>
                    <h3 className="app-card-title">
                      {app.name}
                      {!app.isHealthy && (
                        <span className="app-offline-tag">(Offline)</span>
                      )}
                    </h3>
                    <span className="app-type-badge mono">
                      {app.integrationType}
                    </span>
                  </div>
                </div>
                {app.description && (
                  <p className="app-card-desc">{app.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="dashboard-empty">
          <h3>No applications available</h3>
          <p>Contact your administrator to get access to applications.</p>
        </div>
      )}

      <div className="quick-actions">
        <h3>Quick Actions</h3>
        <div className="quick-actions-row">
          <button
            className="btn btn-secondary"
            onClick={() => (window.location.href = '/help')}
          >
            📖 View Documentation
          </button>
          {user?.roles.includes('admin') && (
            <button
              className="btn btn-primary"
              onClick={() => (window.location.href = '/admin')}
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
