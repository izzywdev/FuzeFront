import { useCallback, useEffect, useRef, useState } from 'react'
import { isAxiosError } from 'axios'
import { Button } from '@fuzefront/design-system'
import '../components/portalsDirectory/portalsDirectory.css'
import {
  PortalsDirectoryShell,
  PortalsList,
  PortalsListLoading,
  PortalsListEmpty,
  PortalsListError,
  PermissionDeniedNotice,
} from '../components/portalsDirectory'
import {
  listAdminPortals,
  pageHasMore,
  pageIsReadOnly,
  type AdminPortal,
} from '../services/adminPortalsService'
import { useFlag } from '../platform/featureFlags'

const PAGE_LIMIT = 25
// Debounce keystrokes before re-querying the server (`q` param) — avoids a
// request per keystroke while still using real, server-side filtering (the
// list is Permit-scoped server-side; there is no full collection to filter
// client-side in the first place).
const SEARCH_DEBOUNCE_MS = 300

type ListState = 'loading' | 'ready' | 'error' | 'forbidden'

/**
 * Feature-flag gate for the Portals Directory
 * (`fuzefront.platform.portals-directory`, release flag, default OFF).
 *
 * Reads the per-user evaluation served by the backend (`GET /api/flags`),
 * which resolves the flag through Unleash against the authenticated session
 * (so the `developers` segment applies) — the same mechanism
 * AccountSecurityPage/BillingPage/Layout already use for their flags.
 */
function usePortalsDirectoryFlag(): boolean {
  return useFlag('fuzefront.platform.portals-directory', false)
}

/**
 * `/portals` — the Portals Directory (design/frames/portals-directory).
 *
 * Flag OFF (default): the route stays registered (so linking never 404s
 * mid-rollout) but renders nothing of the surface — ships dark until the
 * flag flips, matching AccountSecurityPage's convention.
 */
function PortalsDirectory() {
  const enabled = usePortalsDirectoryFlag()
  if (!enabled) {
    return (
      <div style={{ padding: 'var(--space-8)', color: 'var(--text-secondary)' }}>
        This area isn’t available yet.
      </div>
    )
  }
  return <PortalsDirectoryContent />
}

/**
 * The Portals Directory itself (flag-ON path).
 * A LAUNCHER, not a switcher: the master-admin sees the portals they can
 * manage and opens one in a new tab at its own host; there is no in-app
 * portal-context switch here. Cursor-paginated ("Load more" advances the
 * server cursor); all six contract states are wired: loading, empty, error
 * + retry, an explicit new-tab launch affordance, a suspended row with no
 * launch, and the fail-closed permission-denied case (403 -> zero launch
 * affordances, never a sign-in redirect — only 401 re-authenticates, handled
 * globally by the shared api client's interceptor).
 */
export function PortalsDirectoryContent() {
  const [portals, setPortals] = useState<AdminPortal[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [state, setState] = useState<ListState>('loading')
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchInput, setSearchInput] = useState('')

  // The query actually sent to the server, debounced off `searchInput`.
  const [query, setQuery] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [searchInput])

  // Guards a fetch whose response arrives after a newer one was already
  // kicked off (e.g. the user kept typing) from clobbering fresher state.
  const requestIdRef = useRef(0)

  const load = useCallback((q: string) => {
    const requestId = ++requestIdRef.current
    setState('loading')
    listAdminPortals({ limit: PAGE_LIMIT, q: q || undefined })
      .then(res => {
        if (requestIdRef.current !== requestId) return
        setPortals(res.items)
        setNextCursor(res.page.nextCursor)
        setHasMore(pageHasMore(res.page))
        setTotal(res.page.total)
        setState('ready')
      })
      .catch((err: unknown) => {
        if (requestIdRef.current !== requestId) return
        if (isAxiosError(err) && err.response?.status === 401) {
          // The shared api client's interceptor already redirects to /login;
          // don't flash our own error banner underneath that navigation.
          return
        }
        if (isAxiosError(err) && err.response?.status === 403) {
          setState('forbidden')
          setPortals([])
          setNextCursor(null)
          setHasMore(false)
          return
        }
        setState('error')
      })
  }, [])

  useEffect(() => {
    load(query)
  }, [load, query])

  const loadMore = () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    listAdminPortals({ limit: PAGE_LIMIT, cursor: nextCursor, q: query || undefined })
      .then(res => {
        setPortals(prev => [...prev, ...res.items])
        setNextCursor(res.page.nextCursor)
        setHasMore(pageHasMore(res.page))
      })
      .catch(() => {
        // A failed "load more" leaves the already-loaded page intact; the
        // user can just try the button again (no full-panel error state).
      })
      .finally(() => setLoadingMore(false))
  }

  const activeCount = portals.filter(p => p.status === 'active').length
  // S5: a 200 whose every row came back `canOpen: false` is the read-only
  // projection (caller has `read` but not `manage`/`open` authority over any
  // returned portal) — distinct from the fail-closed 403 no-access state
  // (`state === 'forbidden'`, no rows at all). Both get "Read-only" header
  // copy; only the 403 case renders zero rows.
  const readOnlyPage = state === 'ready' && pageIsReadOnly(portals)
  const subtitle =
    state === 'ready'
      ? readOnlyPage
        ? 'Read-only'
        : `${total ?? portals.length} portal${portals.length === 1 ? '' : 's'} · ${activeCount} active`
      : undefined

  return (
    <div className="page">
      <div className="page-header">
        <p className="pd-eyebrow">Portal directory</p>
        <h1>Portals</h1>
        <p>
          Open a portal you manage in its own tab. Management continues on that portal's own host
          — there is no in-app portal switch here.
        </p>
      </div>

      <PortalsDirectoryShell
        title={state === 'forbidden' || readOnlyPage ? 'Portals' : 'Portals you manage'}
        subtitle={state === 'forbidden' ? 'Read-only' : subtitle}
        showSearch={state !== 'forbidden' && state !== 'error'}
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        footer={
          state === 'ready' && hasMore ? (
            <Button variant="ghost" onClick={loadMore} disabled={loadingMore} data-action="load-more">
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          ) : undefined
        }
      >
        {state === 'loading' && <PortalsListLoading />}
        {state === 'error' && <PortalsListError onRetry={() => load(query)} />}
        {state === 'forbidden' && <PermissionDeniedNotice />}
        {state === 'ready' && portals.length === 0 && <PortalsListEmpty />}
        {state === 'ready' && portals.length > 0 && <PortalsList portals={portals} />}
      </PortalsDirectoryShell>
    </div>
  )
}

export default PortalsDirectory
