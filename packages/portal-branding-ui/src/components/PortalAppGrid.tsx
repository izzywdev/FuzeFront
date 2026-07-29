import type { NormalizedPortalContext } from '../types'

interface AppCardDef {
  id: string
  icon: string
  name: string
  desc: string
}

function appCards(portalName: string): AppCardDef[] {
  return [
    { id: 'crm', icon: '📇', name: `${portalName} CRM`, desc: 'Pipeline, contacts & deals.' },
    { id: 'docs', icon: '📄', name: 'Docs', desc: 'Shared team documents.' },
    { id: 'analytics', icon: '📈', name: 'Analytics', desc: 'Dashboards & metrics.' },
    { id: 'inbox', icon: '✉️', name: 'Inbox', desc: 'Unified messages.' },
    { id: 'billing', icon: '💳', name: 'Billing', desc: 'Invoices & plans.' },
    { id: 'add', icon: '＋', name: 'Add app', desc: 'Browse the catalog.' },
  ]
}

export interface PortalAppGridProps {
  context: NormalizedPortalContext
}

/**
 * The pre-auth portal shell's content region (frame 01, `[data-region="content"]`
 * / `[data-region="app-grid"]`), including the `[data-portal-badge]` naming
 * the resolved portal (`portal · corpabc` / `portal · root`).
 */
export function PortalAppGrid({ context }: PortalAppGridProps) {
  const portalAttr = context.isRoot ? 'root' : context.slug
  return (
    <main data-region="content" style={{ padding: 'var(--space-8)', flex: 1, overflow: 'auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
          marginBottom: 'var(--space-2)',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-2xl)',
            color: 'var(--text-primary)',
          }}
        >
          Welcome back to {context.branding.name}
        </h1>
        <span
          data-portal-badge
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-2xs)',
            color: 'var(--accent-color)',
            background: 'var(--accent-soft)',
            borderRadius: 'var(--radius-pill)',
            padding: 'var(--space-1) var(--space-3)',
          }}
        >
          portal · {portalAttr}
        </span>
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-6)' }}>
        Your team&rsquo;s apps, all in one branded workspace.
      </p>

      <section
        data-region="app-grid"
        aria-label="Portal apps"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        {appCards(context.branding.name).map(card => (
          <div
            key={card.id}
            data-app={card.id}
            style={{
              padding: 'var(--space-4)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-tertiary)',
            }}
          >
            <div style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }} aria-hidden="true">
              {card.icon}
            </div>
            <div style={{ fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-1)', color: 'var(--text-primary)' }}>
              {card.name}
            </div>
            <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)', margin: 0 }}>
              {card.desc}
            </p>
          </div>
        ))}
      </section>
    </main>
  )
}
