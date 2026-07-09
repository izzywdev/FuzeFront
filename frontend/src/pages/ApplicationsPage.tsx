import { useNavigate } from 'react-router-dom'
import { AppCard, Badge } from '@fuzefront/design-system'
import { useRegisteredApps } from '../platform/appRegistry'
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
