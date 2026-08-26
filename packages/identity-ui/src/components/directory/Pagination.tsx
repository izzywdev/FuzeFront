import { Button } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'

export interface PaginationProps {
  /** 1-based current page, as echoed by `DirectoryPage.page`. */
  page: number
  /** Effective (server-clamped) page size, as echoed by `DirectoryPage.pageSize`. */
  pageSize: number
  /** Total directory members matching the current query. */
  total: number
  onPageChange: (page: number) => void
}

/**
 * Page-based directory pager — `data-panel="pagination"` (01-directory.html).
 * Prev is disabled on page 1, Next on the last page (02-states.html b5);
 * page count derives from `total / pageSize`, matching the frozen
 * `DirectoryPage` envelope rather than a client-side guess.
 */
export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const { messages, t } = useIdentityI18n()
  const pg = messages.pagination
  const dir = messages.directory

  if (total <= 0) return null

  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)

  return (
    <nav
      aria-label={dir.title}
      data-panel="pagination"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        flexWrap: 'wrap',
      }}
    >
      <span
        data-pager-info
        style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}
      >
        {t(dir.pagerInfo, { from, to, total })}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          aria-label={pg.previous}
          data-action="prev-page"
          onClick={() => onPageChange(page - 1)}
        >
          {pg.previous}
        </Button>
        <span
          data-page={page}
          aria-live="polite"
          style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}
        >
          {t(pg.pageInfo, { page, pages: totalPages })}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= totalPages}
          aria-label={pg.next}
          data-action="next-page"
          onClick={() => onPageChange(page + 1)}
        >
          {pg.next}
        </Button>
      </span>
    </nav>
  )
}
