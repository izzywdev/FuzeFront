import { Button, DataTable, StatusPill } from '@fuzefront/design-system'
import { PlanBadge } from './PlanBadge'
import { portalStatusPill } from '../../utils/statusMap'
import type { AdminPortal } from '../../types'

export interface PortalsTableProps {
  portals: AdminPortal[]
  onOpen: (portal: AdminPortal) => void
  onSuspend: (portal: AdminPortal) => void
  onResume: (portal: AdminPortal) => void
}

const COLUMNS = [
  { key: 'portal', header: 'Portal' },
  { key: 'status', header: 'Status' },
  { key: 'domain', header: 'Primary domain' },
  { key: 'plan', header: 'Plan' },
  { key: 'actions', header: 'Actions', align: 'right' as const },
]

/**
 * The master-admin fleet table (frame 01-portals-list). The platform root
 * org is never returned by `GET /api/v1/security/portals`, so every row
 * here is a real, suspendable tenant portal — no root-row guard is needed
 * (see `MasterAdminPortalsFlow`'s module doc for the frame deviation).
 */
export function PortalsTable({ portals, onOpen, onSuspend, onResume }: PortalsTableProps) {
  return (
    <DataTable columns={COLUMNS}>
      <tbody>
        {portals.map(portal => (
          <tr key={portal.orgId} data-portal={portal.orgId}>
            <td style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 'var(--weight-medium)' }}>{portal.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {portal.slug}
                </span>
              </div>
            </td>
            <td style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-color)' }}>
              <StatusPill {...portalStatusPill(portal.status)} data-portal-status={portal.status} />
            </td>
            <td
              style={{
                padding: 'var(--space-3) var(--space-4)',
                borderBottom: '1px solid var(--border-color)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: portal.customDomain ? 'var(--text-secondary)' : 'var(--text-tertiary)',
              }}
            >
              {portal.customDomain ?? 'no custom domain'}
            </td>
            <td style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-color)' }}>
              <PlanBadge billingMode={portal.billingMode} />
            </td>
            <td
              style={{
                padding: 'var(--space-3) var(--space-4)',
                borderBottom: '1px solid var(--border-color)',
                textAlign: 'right',
              }}
            >
              <div style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                <Button variant="ghost" size="sm" data-action="view-portal" data-target={portal.orgId} onClick={() => onOpen(portal)}>
                  Open
                </Button>
                {portal.status === 'suspended' ? (
                  <Button variant="ghost" size="sm" data-action="resume-portal" data-target={portal.orgId} onClick={() => onResume(portal)}>
                    Resume
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" data-action="suspend-portal" data-target={portal.orgId} onClick={() => onSuspend(portal)}>
                    Suspend
                  </Button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  )
}
