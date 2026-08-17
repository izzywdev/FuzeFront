import { Button } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'

export interface NoResultsStateProps {
  query: string
  onClear: () => void
}

/**
 * No-search-results (02-states.html b3) — DISTINCT from the real empty
 * directory: the directory has members, the query matched none. Offers
 * `data-action="clear-search"` to reset instantly (no debounce wait).
 */
export function NoResultsState({ query, onClear }: NoResultsStateProps) {
  const { messages, t } = useIdentityI18n()
  const m = messages.directory

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-8) var(--space-6)',
      }}
    >
      <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--text-md)', color: 'var(--text-primary)' }}>
        {t(m.noResultsTitle, { query })}
      </h3>
      <p style={{ margin: 0, maxWidth: '32em', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        {m.noResultsBody}
      </p>
      <Button variant="secondary" size="sm" data-action="clear-search" onClick={onClear}>
        {m.clearSearch}
      </Button>
    </div>
  )
}
