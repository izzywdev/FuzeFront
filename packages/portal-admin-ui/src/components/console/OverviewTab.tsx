import { StatCard, StatusPill } from '@fuzefront/design-system'
import { portalStatusPill } from '../../utils/statusMap'
import type { Portal } from '../../types'

export interface OverviewTabProps {
  portal: Portal
  userCount: number | null
  appCount: number | null
}

/** Overview tab (frame 05-overview). Portal identity is REAL (`GET /portal/current`,
 * session-scoped). User/app counts are best-effort from the tabs' own loaded pages. */
export function OverviewTab({ portal, userCount, appCount }: OverviewTabProps) {
  return (
    <div data-panel="overview-stats">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <StatCard label="Users" value={userCount ?? '—'} data-stat="users" />
        <StatCard label="Apps enabled" value={appCount ?? '—'} data-stat="apps" />
        <StatCard label="Plan" value={portal.billingMode} />
      </div>

      <div data-panel="overview-domain">
        <h3 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-md)', color: 'var(--text-primary)' }}>Portal</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
          <StatusPill {...portalStatusPill(portal.status)} data-portal-status={portal.status} />
        </div>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-2) var(--space-4)', margin: 0 }}>
          <dt style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>Slug</dt>
          <dd style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{portal.slug}</dd>
          <dt style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>Owner</dt>
          <dd style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>{portal.ownerEmail ?? '—'}</dd>
        </dl>
      </div>
    </div>
  )
}
