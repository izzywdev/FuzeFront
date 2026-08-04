import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppCard, Badge } from '@fuzeone/design-system'
import { useRegisteredApps } from '../platform/appRegistry'
import { useOrganizations, type App as BackendApp } from '../lib/shared'
import {
  appsAPI,
  getInstalledApps,
  uninstallApp,
  type AppScopeLevel,
} from '../services/api'
import InstallAppDialog from '../components/InstallAppDialog'
import {
  iconImageUrl,
  iconGlyph,
  integrationTypeOf,
  appHref,
} from '../platform/appManifest'

/**
 * The application menu (frame 01-app-menu): a launcher grid of registered AND
 * activated apps sourced from the app-registry. Each card's icon + label come
 * from the app's manifest. A dashed "Add application" card opens the
 * register → activate flow.
 */
function ApplicationsPage() {
  const navigate = useNavigate()
  const { apps, loading, error } = useRegisteredApps()

  return (
    <>
      <ApplicationsLauncher
        apps={apps}
        loading={loading}
        error={error}
        navigate={navigate}
      />
      {/* The install surface speaks the backend apps API (which carries the app
          id and its scopeLevel). The launcher above speaks the app-registry
          contract, whose App schema is `additionalProperties: false` and
          therefore carries no backend id — the two are deliberately separate
          reads rather than a fragile slug-matched join. */}
      <InstalledAppsSection />
    </>
  )
}

/**
 * Apps installed into the caller's personal space or the active organization,
 * with the install / uninstall controls.
 *
 * Frames: design/frames/app-scopes-user-menu/03-install-scope.html.
 */
function InstalledAppsSection() {
  const { activeOrganizationId } = useOrganizations()
  const [available, setAvailable] = useState<BackendApp[]>([])
  const [installedAppIds, setInstalledAppIds] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<'loading' | 'idle' | 'error'>('loading')
  const [dialogApp, setDialogApp] = useState<{
    id: string
    name: string
    scopeLevel: AppScopeLevel
  } | null>(null)
  const [installationByApp, setInstallationByApp] = useState<
    Record<string, { id: string; mode: string }>
  >({})

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const [apps, installs] = await Promise.all([
        appsAPI.getApps() as Promise<BackendApp[]>,
        getInstalledApps(activeOrganizationId ?? undefined),
      ])
      setAvailable(Array.isArray(apps) ? apps : [])
      setInstalledAppIds(new Set(installs.map(i => i.appId)))
      setInstallationByApp(
        Object.fromEntries(
          installs.map(i => [i.appId, { id: i.id, mode: i.mode }])
        )
      )
      setStatus('idle')
    } catch (err) {
      console.error('Failed to load app installations:', err)
      setStatus('error')
    }
  }, [activeOrganizationId])

  useEffect(() => {
    void load()
  }, [load])

  if (status === 'error') {
    return (
      <p style={{ color: 'var(--error-color)', fontSize: 'var(--text-sm)' }}>
        Couldn&apos;t load installed applications.
      </p>
    )
  }

  return (
    <section style={{ maxWidth: '900px', marginTop: 'var(--space-10)' }}>
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-xl)',
          margin: '0 0 var(--space-2)',
        }}
      >
        Install applications
      </h2>
      <p style={{ color: 'var(--text-secondary)', margin: '0 0 var(--space-5)' }}>
        Each app declares whether it can live in your personal space, in an
        organization, or either. Installing asks only what the app leaves open.
      </p>

      {status === 'loading' && (
        <p style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
      )}

      {status === 'idle' && available.length === 0 && (
        <p style={{ color: 'var(--text-tertiary)' }}>
          No applications available to install.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {available.map(app => {
          const installed = installedAppIds.has(app.id)
          const installation = installationByApp[app.id]
          const scopeLevel: AppScopeLevel = app.scopeLevel ?? 'both'

          return (
            <div
              key={app.id}
              data-app-row={app.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-4)',
                padding: 'var(--space-4)',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: 'var(--text-primary)',
                    fontWeight: 'var(--weight-medium)',
                  }}
                >
                  {app.name}
                </div>
                {app.description && (
                  <div
                    style={{
                      color: 'var(--text-tertiary)',
                      fontSize: 'var(--text-sm)',
                      marginTop: 'var(--space-1)',
                    }}
                  >
                    {app.description}
                  </div>
                )}
              </div>

              <Badge data-scope-level={scopeLevel}>{scopeLevel}</Badge>

              {installed && installation ? (
                <button
                  className="btn btn-ghost"
                  data-action="uninstall"
                  data-app-id={app.id}
                  onClick={async () => {
                    try {
                      await uninstallApp(app.id, installation.id)
                    } catch (err) {
                      console.error('Uninstall failed:', err)
                    }
                    void load()
                  }}
                >
                  Uninstall
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  data-action="open-install"
                  data-app-id={app.id}
                  onClick={() =>
                    setDialogApp({ id: app.id, name: app.name, scopeLevel })
                  }
                >
                  Install
                </button>
              )}
            </div>
          )
        })}
      </div>

      {dialogApp && (
        <InstallAppDialog
          open
          appId={dialogApp.id}
          appName={dialogApp.name}
          scopeLevel={dialogApp.scopeLevel}
          onClose={() => setDialogApp(null)}
          onChanged={() => void load()}
        />
      )}
    </section>
  )
}

function ApplicationsLauncher({
  apps,
  loading,
  error,
  navigate,
}: {
  apps: ReturnType<typeof useRegisteredApps>['apps']
  loading: boolean
  error: string | null
  navigate: ReturnType<typeof useNavigate>
}) {
  return (
    <div style={{ maxWidth: '900px' }}>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-2xl)',
          letterSpacing: 'var(--tracking-display)',
          margin: '0 0 var(--space-2)',
        }}
      >
        Applications
      </h1>
      <p style={{ color: 'var(--text-secondary)', margin: '0 0 var(--space-6)' }}>
        Federated apps registered to your workspace. The <b>menu label</b> and{' '}
        <b>icon</b> come from each app&apos;s manifest.
      </p>

      {error && (
        <div
          style={{
            marginBottom: 'var(--space-4)',
            color: 'var(--error-color)',
            fontSize: 'var(--text-sm)',
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 'var(--space-5)',
        }}
      >
        {apps.map(app => (
          <div key={app.slug} style={{ position: 'relative' }}>
            <AppCard
              name={app.manifest.menuLabel}
              description={app.manifest.description}
              integrationType={integrationTypeOf(app)}
              iconUrl={iconImageUrl(app.manifest.icon)}
              iconGlyph={iconGlyph(app.manifest.icon) ?? undefined}
              isHealthy={app.isHealthy !== false}
              onClick={() => {
                const href = appHref(app)
                if (href.startsWith('http')) window.location.href = href
                else navigate(href)
              }}
            />
            {/* Status / type meta badges, matching the frame's card meta row. */}
            <div
              style={{
                display: 'flex',
                gap: 'var(--space-2)',
                flexWrap: 'wrap',
                marginTop: 'var(--space-2)',
              }}
            >
              {app.builtin && <Badge tone="accent">built-in</Badge>}
              {app.mode === 'standalone' && <Badge>standalone</Badge>}
              <Badge tone="success" dot>
                {app.status}
              </Badge>
            </div>
          </div>
        ))}

        {/* Add application — dashed CTA card opening the register→activate flow. */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate('/applications/new')}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') navigate('/applications/new')
          }}
          style={{
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            padding: 'var(--space-6)',
            background: 'var(--bg-tertiary)',
            border: '1px dashed var(--border-strong)',
            borderRadius: 'var(--radius-lg)',
            cursor: 'pointer',
            minHeight: '140px',
          }}
        >
          <div>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                display: 'grid',
                placeItems: 'center',
                fontSize: 'var(--text-2xl)',
                background: 'var(--bg-quaternary)',
                margin: '0 auto var(--space-3)',
              }}
            >
              ＋
            </div>
            <h3 style={{ margin: '0 0 var(--space-1)', fontSize: 'var(--text-lg)' }}>
              Add application
            </h3>
            <p
              style={{
                margin: 0,
                color: 'var(--text-tertiary)',
                fontSize: 'var(--text-sm)',
              }}
            >
              Register a federated or standalone app.
            </p>
          </div>
        </div>
      </div>

      {loading && apps.length === 0 && (
        <p style={{ color: 'var(--text-tertiary)', marginTop: 'var(--space-4)' }}>
          Loading applications…
        </p>
      )}
    </div>
  )
}

export default ApplicationsPage
