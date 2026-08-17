import { Button, StatCard, StatusPill } from '@fuzefront/design-system'
import { PlanBadge } from './PlanBadge'
import { domainStatusPill, portalStatusPill } from '../../utils/statusMap'
import type { Portal } from '../../types'

export interface PortalDetailPanelProps {
  portal: Portal
  onBack: () => void
  onSuspend: (portal: Portal) => void
  onResume: (portal: Portal) => void
}

/**
 * Portal detail (frame 03-portal-detail). Domain status is REAL
 * (`Portal.domains`, read-only per the frame). User/app counts require
 * aggregating the org-members and portal-catalog surfaces separately — kept
 * out of scope for this view (no single endpoint returns them together) and
 * shown honestly as "—" rather than fabricated; see PR notes.
 */
export function PortalDetailPanel({ portal, onBack, onSuspend, onResume }: PortalDetailPanelProps) {
  const domains = portal.domains ?? []

  return (
    <div data-frame="03-portal-detail">
      <Button variant="ghost" size="sm" data-action="back-to-portals" onClick={onBack}>
        ← Portals
      </Button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: 'var(--space-4) 0' }}>
        <div>
          <h2 style={{ margin: '0 0 var(--space-1)', fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', color: 'var(--text-primary)' }}>
            {portal.name}
          </h2>
          <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            {portal.slug}
          </p>
        </div>
        <StatusPill {...portalStatusPill(portal.status)} data-portal-status={portal.status} />
      </div>

      <div data-panel="portal-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        <StatCard label="Users" value="—" data-stat="users" />
        <StatCard label="Apps enabled" value="—" data-stat="apps" />
        <StatCard label="Domains" value={domains.length} data-stat="domains" />
        <StatCard label="Plan" value={<PlanBadge billingMode={portal.billingMode} />} />
      </div>

      <div data-panel="branding-summary" style={{ marginBottom: 'var(--space-6)' }}>
        <h3 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-md)', color: 'var(--text-primary)' }}>Branding</h3>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-2) var(--space-4)', margin: 0 }}>
          <dt style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>Display name</dt>
          <dd style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>{portal.name}</dd>
          <dt style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>Slug</dt>
          <dd style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{portal.slug}</dd>
          <dt style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>Owner</dt>
          <dd style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>{portal.ownerEmail ?? '—'}</dd>
        </dl>
      </div>

      <div data-panel="domain-status" style={{ marginBottom: 'var(--space-6)' }}>
        <h3 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-md)', color: 'var(--text-primary)' }}>Domains</h3>
        {domains.length === 0 ? (
          <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>No domains configured.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'start', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Domain</th>
                <th style={{ textAlign: 'start', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Kind</th>
                <th style={{ textAlign: 'start', padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {domains.map(domain => (
                <tr key={domain.id} data-domain={domain.domain} data-domain-status={domain.verificationStatus}>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)' }}>
                    {domain.domain}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', borderTop: '1px solid var(--border-color)' }}>
                    {domain.kind}
                  </td>
                  <td style={{ padding: 'var(--space-2) var(--space-3)', borderTop: '1px solid var(--border-color)' }}>
                    <StatusPill {...domainStatusPill(domain.verificationStatus)} data-domain-status={domain.verificationStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div data-panel="portal-actions">
        {portal.status === 'suspended' ? (
          <Button variant="primary" data-action="resume-portal" data-target={portal.id} onClick={() => onResume(portal)}>
            Resume portal
          </Button>
        ) : (
          <Button
            variant="danger"
            data-action="suspend-portal"
            data-target={portal.id}
            disabled={portal.isRoot}
            title={portal.isRoot ? 'The root portal cannot be suspended' : undefined}
            onClick={() => onSuspend(portal)}
          >
            Suspend portal
          </Button>
        )}
      </div>
    </div>
  )
}
