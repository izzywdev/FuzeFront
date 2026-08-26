import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'

/**
 * The REAL empty directory (02-states.html b2) — a freshly-seeded install
 * has exactly one member (the caller). Distinct from {@link NoResultsState}:
 * this renders only when there is no active search.
 */
export function DirectoryEmptyState() {
  const { messages } = useIdentityI18n()
  const m = messages.directory

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-8) var(--space-6)',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 'var(--text-2xl)' }}>
        👤
      </span>
      <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--text-md)', color: 'var(--text-primary)' }}>
        {m.emptyTitle}
      </h3>
      <p style={{ margin: 0, maxWidth: '32em', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        {m.emptyBody}
      </p>
    </div>
  )
}
