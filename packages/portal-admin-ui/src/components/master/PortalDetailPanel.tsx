import { Button, StatCard, StatusPill } from '@fuzefront/design-system'
import { PlanBadge } from './PlanBadge'
import { portalStatusPill } from '../../utils/statusMap'
import type { AdminPortal } from '../../types'

export interface PortalDetailPanelProps {
  portal: AdminPortal
  onBack: () => void
  onSuspend: (portal: AdminPortal) => void
  onResume: (portal: AdminPortal) => void
}

/**
 * Portal detail (frame 03-portal-detail), migrated onto the REAL `Portal`
 * shape (`@fuzefront/security-client` 0.7.0): a single nullable
 * `customDomain` field, not the frame's `portal_domains` verification table
 * (that per-domain add/verify/TLS-status surface is FF-EPIC-16 and has no
 * counterpart in this contract yet). Branding is REAL (`portal.branding`).
 * User/app counts require aggregating the org-members and portal-catalog
 * surfaces separately — kept out of scope for this view (no single endpoint
 * returns them together) and shown honestly as "—" rather than fabricated.
 */
export function PortalDetailPanel({ portal, onBack, onSuspend, onResume }: PortalDetailPanelProps) {
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
        <StatCard label="Custom domain" value={portal.customDomain ?? '—'} data-stat="domain" />
        <StatCard label="Plan" value={<PlanBadge billingMode={portal.billingMode} />} />
      </div>

      <div data-panel="branding-summary" style={{ marginBottom: 'var(--space-6)' }}>
        <h3 style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-md)', color: 'var(--text-primary)' }}>Branding</h3>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 'var(--space-2) var(--space-4)', margin: 0 }}>
          <dt style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>Display name</dt>
          <dd style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>{portal.branding.name}</dd>
          <dt style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>Slug</dt>
          <dd style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{portal.slug}</dd>
          <dt style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>Owner</dt>
          <dd style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>{portal.ownerEmail ?? '—'}</dd>
          <dt style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>Tagline</dt>
          <dd style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>{portal.branding.tagline ?? '—'}</dd>
          <dt style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>Custom domain</dt>
          <dd style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }} data-domain-status={portal.customDomain ? 'active' : 'none'}>
            {portal.customDomain ?? 'no custom domain — using the default subdomain'}
          </dd>
          <dt style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>App catalog</dt>
          <dd style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>
            {portal.appCatalogMode === 'custom' ? 'Custom catalog' : 'Inherits the platform catalog'}
          </dd>
        </dl>
      </div>

      <div data-panel="portal-actions">
        {portal.status === 'suspended' ? (
          <Button variant="primary" data-action="resume-portal" data-target={portal.orgId} onClick={() => onResume(portal)}>
            Resume portal
          </Button>
        ) : (
          <Button variant="danger" data-action="suspend-portal" data-target={portal.orgId} onClick={() => onSuspend(portal)}>
            Suspend portal
          </Button>
        )}
      </div>
    </div>
  )
}
