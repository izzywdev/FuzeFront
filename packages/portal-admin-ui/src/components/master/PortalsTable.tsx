import { Button, DataTable, StatusPill } from '@fuzefront/design-system'
import { PlanBadge } from './PlanBadge'
import { portalStatusPill } from '../../utils/statusMap'
import type { Portal, PortalDomain } from '../../types'

export interface PortalsTableProps {
  portals: Portal[]
  onOpen: (portal: Portal) => void
  onSuspend: (portal: Portal) => void
  onResume: (portal: Portal) => void
}

function primaryDomain(portal: Portal): string | null {
  const domains: PortalDomain[] = portal.domains ?? []
  const primary = domains.find((d: PortalDomain) => d.isPrimary) ?? domains[0]
  return primary?.domain ?? null
}

const COLUMNS = [
  { key: 'portal', header: 'Portal' },
  { key: 'status', header: 'Status' },
  { key: 'domain', header: 'Primary domain' },
  { key: 'plan', header: 'Plan' },
  { key: 'actions', header: 'Actions', align: 'right' as const },
]

/** The master-admin fleet table (frame 01-portals-list). */
export function PortalsTable({ portals, onOpen, onSuspend, onResume }: PortalsTableProps) {
  return (
    <DataTable columns={COLUMNS}>
      <tbody>
        {portals.map(portal => (
          <tr key={portal.id} data-portal={portal.id} data-root={portal.isRoot ? 'true' : 'false'}>
            <td style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 'var(--weight-medium)' }}>
                  {portal.name}
                  {portal.isRoot && (
                    <span
                      style={{
                        marginInlineStart: 'var(--space-2)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-2xs)',
                        color: 'var(--text-tertiary)',
                        textTransform: 'uppercase',
                      }}
                    >
                      root
                    </span>
                  )}
                </span>
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
                color: primaryDomain(portal) ? 'var(--text-secondary)' : 'var(--text-tertiary)',
              }}
            >
              {primaryDomain(portal) ?? 'no custom domain'}
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
                <Button variant="ghost" size="sm" data-action="view-portal" data-target={portal.id} onClick={() => onOpen(portal)}>
                  Open
                </Button>
                {portal.status === 'suspended' ? (
                  <Button variant="ghost" size="sm" data-action="resume-portal" data-target={portal.id} onClick={() => onResume(portal)}>
                    Resume
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    data-action="suspend-portal"
                    data-target={portal.id}
                    disabled={portal.isRoot}
                    title={portal.isRoot ? 'The root portal cannot be suspended' : undefined}
                    onClick={() => onSuspend(portal)}
                  >
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
