import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'
import { DirectorySearchBar } from './DirectorySearchBar'
import { DirectoryTable } from './DirectoryTable'
import { Pagination } from './Pagination'
import { DirectoryEmptyState } from './DirectoryEmptyState'
import { NoResultsState } from './NoResultsState'
import type { DirectoryMember } from '../../api/directoryClient'

export interface MemberDirectoryProps {
  members: DirectoryMember[]
  page: number
  pageSize: number
  total: number
  query: string
  loading?: boolean
  onQueryChange: (query: string) => void
  onPageChange: (page: number) => void
}

/**
 * The directory body — search toolbar, count, grid, and pager
 * (01-directory.html). Loading/empty/no-results are all delegated to
 * {@link DirectoryTable}'s `emptyState` slot so a single element instance
 * carries the live `data-state` transition rather than mounting/unmounting
 * distinct trees per state.
 */
export function MemberDirectory({
  members,
  page,
  pageSize,
  total,
  query,
  loading = false,
  onQueryChange,
  onPageChange,
}: MemberDirectoryProps) {
  const { messages, t } = useIdentityI18n()
  const m = messages.directory

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div
        data-panel="directory-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <DirectorySearchBar value={query} onChange={onQueryChange} />
        </div>
        <span
          data-count="total"
          style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}
        >
          {t(m.countLabel, { total })}
        </span>
      </div>

      <DirectoryTable
        members={members}
        loading={loading}
        emptyState={query ? <NoResultsState query={query} onClear={() => onQueryChange('')} /> : <DirectoryEmptyState />}
      />

      <Pagination page={page} pageSize={pageSize} total={total} onPageChange={onPageChange} />
    </div>
  )
}
