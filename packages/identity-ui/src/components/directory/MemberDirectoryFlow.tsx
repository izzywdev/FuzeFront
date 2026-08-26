import { useEffect, useRef, useState } from 'react'
import { Button, StatusCallout } from '@fuzefront/design-system'
import { useIdentityI18n } from '../../i18n/IdentityI18nProvider'
import { MemberDirectory } from './MemberDirectory'
import { DirectoryForbiddenNotice } from './DirectoryForbiddenNotice'
import type { DirectoryMember } from '../../api/directoryClient'

const SEARCH_DEBOUNCE_MS = 300

export interface MemberDirectoryFlowProps {
  /** The root/portal org's display name, interpolated into the subtitle. */
  orgName?: string
  members: DirectoryMember[]
  /** 1-based current page, as echoed by `DirectoryPage.page`. */
  page: number
  /** Effective (server-clamped) page size, as echoed by `DirectoryPage.pageSize`. */
  pageSize: number
  total: number
  /** The query the host last fetched with — the source of truth; the search box syncs to it. */
  query: string
  loading?: boolean
  /** A non-2xx from the directory endpoint (never set for a 403 — see `forbidden`). */
  error?: string | null
  /** The caller lacks the org owner/admin (or Employee/ReBAC) capability — 403 FORBIDDEN, rendered in place. */
  forbidden?: boolean
  /** Called (debounced ~300ms) as the search box settles; called immediately on "Clear search". */
  onQueryChange: (query: string) => void
  onPageChange: (page: number) => void
  onRetry?: () => void
}

/**
 * `MemberDirectoryFlow` — the root/portal member directory route
 * (design/frames/member-directory/**, flow `member-directory`, route
 * `/organizations/:id/directory`). Fully controlled: the host owns data
 * fetching against `@fuzefront/security-client`'s `listOrganizationDirectory`
 * (via `createDirectoryClient`) and passes the resolved page down — this
 * component only renders every 01-directory.html / 02-states.html state and
 * calls back on search / page / retry, matching the `ContextSwitcherFlow` /
 * `MyOrganizationsFlow` convention.
 *
 * `query` debouncing is a UI interaction owned here: keystrokes update the
 * visible search box immediately, and `onQueryChange` fires ~300ms after
 * typing settles so the host never issues a request per keystroke
 * (gate-pagination — search is server-side, never fetched-then-filtered).
 */
export function MemberDirectoryFlow({
  orgName,
  members,
  page,
  pageSize,
  total,
  query,
  loading = false,
  error = null,
  forbidden = false,
  onQueryChange,
  onPageChange,
  onRetry,
}: MemberDirectoryFlowProps) {
  const { messages, t } = useIdentityI18n()
  const m = messages.directory
  const common = messages.common

  const [draftQuery, setDraftQuery] = useState(query)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Stay in sync when the host changes `query` out-of-band (e.g. resets it).
  useEffect(() => {
    setDraftQuery(query)
  }, [query])

  useEffect(() => {
    return () => clearTimeout(debounceRef.current)
  }, [])

  // `MemberDirectory` calls this both for keystrokes (debounced) and for the
  // no-results "Clear search" action — an empty value fires immediately
  // (there is nothing to debounce toward) while anything else waits for
  // typing to settle so the host never issues a request per keystroke
  // (gate-pagination — search is server-side, never fetched-then-filtered).
  function handleQueryChange(next: string) {
    setDraftQuery(next)
    clearTimeout(debounceRef.current)
    if (next === '') {
      onQueryChange('')
    } else {
      debounceRef.current = setTimeout(() => onQueryChange(next), SEARCH_DEBOUNCE_MS)
    }
  }

  const dataState = forbidden
    ? 'forbidden'
    : error
      ? 'error'
      : loading
        ? 'loading'
        : total === 0 && query
          ? 'no-results'
          : total === 0
            ? 'empty'
            : 'populated'

  return (
    <div data-panel="member-directory-flow" data-state={dataState} aria-busy={loading ? 'true' : undefined}>
      <h1 style={{ margin: '0 0 var(--space-1)', fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)' }}>
        {m.title}
      </h1>
      {orgName && (
        <p style={{ margin: '0 0 var(--space-6)', color: 'var(--text-secondary)' }}>{t(m.subtitle, { orgName })}</p>
      )}

      {forbidden ? (
        <DirectoryForbiddenNotice />
      ) : error ? (
        <div data-state="error">
          <StatusCallout
            tone="error"
            icon="⚠️"
            title={m.errorTitle}
            actions={
              <Button variant="secondary" size="sm" data-action="retry" onClick={onRetry}>
                {common.retry}
              </Button>
            }
          >
            {error || m.errorBody}
          </StatusCallout>
        </div>
      ) : (
        <MemberDirectory
          members={members}
          page={page}
          pageSize={pageSize}
          total={total}
          query={draftQuery}
          loading={loading}
          onQueryChange={handleQueryChange}
          onPageChange={onPageChange}
        />
      )}
    </div>
  )
}
