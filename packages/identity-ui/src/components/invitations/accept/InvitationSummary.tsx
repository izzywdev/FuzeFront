import type { ReactNode } from 'react'

/** A labelled key/value row used by the accept summary and the bound summary. */
export function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
      <dt style={{ minInlineSize: '7rem', margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
        {label}
      </dt>
      <dd style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{children}</dd>
    </div>
  )
}

/** Inset panel holding {@link SummaryRow}s. */
export function SummaryPanel({ panel, children }: { panel: string; children: ReactNode }) {
  return (
    <dl
      data-panel={panel}
      style={{
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        padding: 'var(--space-4)',
        background: 'var(--bg-quaternary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {children}
    </dl>
  )
}

/** Org initial tile + lead/title heading block shared by the accept cards. */
export function OrgHeading({ orgName, lead, title }: { orgName: string; lead: string; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
      <div
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          inlineSize: 'var(--space-12)',
          blockSize: 'var(--space-12)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--accent-soft)',
          color: 'var(--accent-color)',
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-xl)',
          fontWeight: 'var(--weight-semibold)',
          flex: 'none',
        }}
      >
        {orgName.trim().charAt(0).toUpperCase() || '·'}
      </div>
      <div>
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{lead}</p>
        <h1
          data-value="org-name"
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-xl)',
            color: 'var(--text-primary)',
          }}
        >
          {title}
        </h1>
      </div>
    </div>
  )
}
