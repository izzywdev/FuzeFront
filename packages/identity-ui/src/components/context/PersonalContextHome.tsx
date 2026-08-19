import { Badge } from '@fuzefront/design-system'
import { EmptyState } from '../common/EmptyState'
import { OrgContextBadge } from './OrgContextBadge'

export interface PersonalScopeApp {
  id: string
  name: string
  active?: boolean
}

export interface PersonalContextHomeProps {
  userFirstName?: string
  apps: PersonalScopeApp[]
  loading?: boolean
}

/**
 * 01-personal-context.html — operating "as yourself". Personal-scope app
 * installs (keyed to `userId`, not an org) render regardless of which org is
 * active elsewhere, because there is no `type='personal'` org behind this
 * context — the user's identity IS the principal.
 */
export function PersonalContextHome({ userFirstName, apps, loading }: PersonalContextHomeProps) {
  return (
    <div>
      <h1
        style={{
          margin: '0 0 var(--space-2)',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-2xl)',
        }}
      >
        {userFirstName ? `Welcome back, ${userFirstName}` : 'Welcome back'}
      </h1>
      <p style={{ margin: '0 0 var(--space-6)', color: 'var(--text-secondary)' }}>
        Your personal space. Personal-scope app installs are keyed to your user id, so they
        follow you regardless of which organization you're viewing.
      </p>

      <div
        data-panel="personal-home"
        style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          maxWidth: '760px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
            padding: 'var(--space-5) var(--space-5) var(--space-3)',
          }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-lg)',
              fontWeight: 'var(--weight-semibold)',
            }}
          >
            Your apps
          </h2>
          <OrgContextBadge context={{ type: 'personal' }} />
        </div>
        <div style={{ padding: 'var(--space-2) var(--space-5) var(--space-5)' }}>
          {loading ? (
            <EmptyState variant="loading" />
          ) : apps.length === 0 ? (
            <EmptyState variant="empty-members" title="No personal apps yet" message="Apps you install to your personal space show up here." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {apps.map(app => (
                <div
                  key={app.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-4)',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: '34px',
                      height: '34px',
                      flex: 'none',
                      borderRadius: 'var(--radius-sm)',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 'var(--weight-semibold)',
                      color: 'var(--bg-primary)',
                      background: 'var(--seam)',
                    }}
                  >
                    {app.name[0]?.toUpperCase() ?? '?'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)' }}>
                      {app.name}
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
                      Installed to your personal space
                    </div>
                  </div>
                  <Badge tone={app.active ? 'success' : 'neutral'} dot>
                    {app.active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
