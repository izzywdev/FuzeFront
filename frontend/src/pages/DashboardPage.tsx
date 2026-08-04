import { useCurrentUser, useOrganizations } from '../lib/shared'
import { useRegisteredApps } from '../platform/appRegistry'
import { iconGlyph, iconImageUrl, integrationTypeOf, appHref } from '../platform/appManifest'
import type { App as RegistryApp } from '@fuzeone/app-registry-client'

/**
 * An app is visible on the dashboard when it is platform-global
 * (`organizationId: null` — owned by no single org, e.g. FuzeSocial/Clock)
 * OR it belongs to the currently active organization. Never drop a
 * platform-global app just because org hydration hasn't finished yet /
 * `activeOrganizationId` is momentarily null — that was the crux of BUG 2.
 */
export function isAppVisibleForOrg(
  app: Pick<RegistryApp, 'organizationId'>,
  activeOrganizationId: string | null
): boolean {
  return (
    app.organizationId === null ||
    app.organizationId === undefined ||
    app.organizationId === activeOrganizationId
  )
}

function integrationIcon(type: string) {
  return type === 'module-federation'
    ? '🔗'
    : type === 'iframe'
      ? '🖼️'
      : type === 'web-component'
        ? '🧩'
        : '📱'
}

function DashboardPage() {
  const { user } = useCurrentUser()
  const { activeOrganizationId } = useOrganizations()
  // BUG 2 root cause: this page previously called the legacy `fetchApps()`
  // (`GET /apps`) instead of the same `@fuzeone/app-registry-client`
  // source (`GET /api/v1/app-registry/apps?status=activated`) the sidebar
  // (SidePanel) already reads via `useRegisteredApps()`. For a Google/social
  // login, the legacy endpoint came back empty even though the registry API
  // itself returned all 3 activated apps (confirmed live: 200 + 3 apps,
  // `organizationId: null`) — the sidebar (registry-backed) showed them, the
  // dashboard (legacy-backed) did not. Reading the SAME registry hook fixes
  // the mismatch; `isAppVisibleForOrg` additionally guarantees
  // platform-global apps always render regardless of which org is active or
  // whether org hydration has completed yet.
  const { apps: registeredApps } = useRegisteredApps()
  const allApps = registeredApps.filter(app =>
    isAppVisibleForOrg(app, activeOrganizationId)
  )

  const handleAppClick = (app: RegistryApp) => {
    if (app.isHealthy === false) {
      alert(
        `${app.manifest.menuLabel} is currently unavailable. Please try again later or contact support.`
      )
      return
    }
    const href = appHref(app)
    if (href.startsWith('http')) window.location.href = href
    else window.location.href = href
  }

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
            {allApps.map(app => {
              const isHealthy = app.isHealthy !== false
              const integrationType = integrationTypeOf(app)
              const imageUrl = iconImageUrl(app.manifest.icon)
              return (
                <div
                  key={app.slug}
                  className={`app-card${isHealthy ? '' : ' is-offline'}`}
                  onClick={() => handleAppClick(app)}
                >
                  <div className="app-card-head">
                    <div className="app-card-icon">
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt=""
                          className="app-icon-img"
                          onError={e => {
                            (e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                      ) : (
                        <div
                          className={`app-icon-fallback type-${integrationType || 'other'}`}
                        >
                          {iconGlyph(app.manifest.icon) ??
                            integrationIcon(integrationType)}
                        </div>
                      )}

                      {/* Health Status Indicator */}
                      <div
                        className={`health-dot${isHealthy ? '' : ' offline'}`}
                      />
                    </div>

                    <div>
                      <h3 className="app-card-title">
                        {app.manifest.menuLabel}
                        {!isHealthy && (
                          <span className="app-offline-tag">(Offline)</span>
                        )}
                      </h3>
                      <span className="app-type-badge mono">
                        {integrationType}
                      </span>
                    </div>
                  </div>
                  {app.manifest.description && (
                    <p className="app-card-desc">{app.manifest.description}</p>
                  )}
                </div>
              )
            })}
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
