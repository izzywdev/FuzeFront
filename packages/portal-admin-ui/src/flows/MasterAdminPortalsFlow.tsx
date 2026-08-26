import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, EmptyState } from '@fuzefront/design-system'
import { createAdminPortalsClient, isPortalsForbidden, isSlugConflict, type AdminPortalsClient } from '../api/adminPortalsClient'
import { PortalsTable } from '../components/master/PortalsTable'
import { CreatePortalDialog } from '../components/master/CreatePortalDialog'
import { PortalDetailPanel } from '../components/master/PortalDetailPanel'
import { SuspendPortalDialog } from '../components/master/SuspendPortalDialog'
import type { AdminPortal, AdminPortalCreate } from '../types'

export interface MasterAdminPortalsFlowProps {
  /** Bearer-token accessor. Defaults to no token (tests/host inject their own). */
  getToken?: () => string | null | undefined
  /** Same-origin base URL override, for tests. Default ''. */
  baseUrl?: string
  /** Injected client (tests). Defaults to a same-origin `@fuzefront/security-client`-backed client. */
  client?: AdminPortalsClient
}

type ListState = 'loading' | 'ready' | 'error' | 'forbidden'
type View = 'list' | 'detail'

const PAGE_LIMIT = 25

/**
 * FF-EPIC-17-S7 orchestrator — `MasterAdminPortalsFlow` (route
 * `/admin/portals`). Wires the REAL, merged org-tree portal contract
 * (`@fuzefront/security-client` 0.7.0, PR #704:
 * `GET/POST /api/v1/security/portals`,
 * `GET/POST(suspend|resume) /api/v1/security/portals/{portalOrgId}`),
 * superseding the earlier build against the anticipated
 * `@fuzefront/portal-client`. Every request that returns 403 renders the
 * fail-closed access-denied state IN PLACE — this component never redirects
 * on a 403 (only a 401, handled by the host's shared interceptor upstream of
 * this package, re-authenticates).
 *
 * DEVIATION from the (unapproved, pre-reconciliation) design frame
 * `04-master-states.html`: the platform root org is NEVER returned by
 * `GET /api/v1/security/portals` (per the contract — "The platform root org
 * itself is NEVER listed"), so there is no seeded "root" row in this table
 * to guard against suspending, and a fresh install's real empty state is
 * simply zero portals — not "only the root portal" as the frame (built
 * against the superseded model, which DID list a root row) shows. See the PR
 * description for the full list of frame/contract deviations this migration
 * required.
 */
export function MasterAdminPortalsFlow({ getToken, baseUrl, client }: MasterAdminPortalsFlowProps) {
  const api = client ?? createAdminPortalsClient({ getToken, baseUrl })

  const [listState, setListState] = useState<ListState>('loading')
  const [portals, setPortals] = useState<AdminPortal[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const [view, setView] = useState<View>('list')
  const [selectedPortal, setSelectedPortal] = useState<AdminPortal | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [slugTaken, setSlugTaken] = useState(false)

  const [suspendTarget, setSuspendTarget] = useState<AdminPortal | null>(null)
  const [suspending, setSuspending] = useState(false)

  const load = useCallback(() => {
    setListState('loading')
    api
      .listPortals({ limit: PAGE_LIMIT })
      .then(res => {
        setPortals(res.items)
        setNextCursor(res.page.nextCursor)
        setHasMore(Boolean(res.page.hasMore))
        setListState('ready')
      })
      .catch((err: unknown) => {
        if (isPortalsForbidden(err)) {
          setListState('forbidden')
          setPortals([])
          return
        }
        setListState('error')
      })
    // `react-hooks/exhaustive-deps` is off repo-wide (frontend/.eslintrc.cjs) —
    // `api` is a stable per-render client (injected in tests, constructed once
    // otherwise), so an empty dep array is intentional, not an omission.
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const loadMore = () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    api
      .listPortals({ limit: PAGE_LIMIT, cursor: nextCursor })
      .then(res => {
        setPortals(prev => [...prev, ...res.items])
        setNextCursor(res.page.nextCursor)
        setHasMore(Boolean(res.page.hasMore))
      })
      .catch(() => {
        // A failed "load more" leaves the already-loaded page intact.
      })
      .finally(() => setLoadingMore(false))
  }

  const openPortal = (portal: AdminPortal) => {
    setSelectedPortal(portal)
    setView('detail')
  }

  const backToList = () => {
    setView('list')
    setSelectedPortal(null)
  }

  const applyUpdatedPortal = (updated: AdminPortal) => {
    setPortals(prev => prev.map(p => (p.orgId === updated.orgId ? updated : p)))
    setSelectedPortal(prev => (prev && prev.orgId === updated.orgId ? updated : prev))
  }

  const handleSuspendRequest = (portal: AdminPortal) => setSuspendTarget(portal)

  const handleSuspendConfirm = (portal: AdminPortal) => {
    setSuspending(true)
    api
      .suspendPortal(portal.orgId)
      .then(updated => {
        applyUpdatedPortal(updated)
        setSuspendTarget(null)
      })
      .catch(() => {
        // Leaves the dialog open so the caller can retry (e.g. a transient
        // failure, or the server's 409 CONFLICT refusal on the platform root
        // — which cannot be reached through this UI, since it is never a row
        // in the fleet table, but the client stays defensive regardless).
      })
      .finally(() => setSuspending(false))
  }

  const handleResume = (portal: AdminPortal) => {
    api.resumePortal(portal.orgId).then(applyUpdatedPortal).catch(() => undefined)
  }

  const handleCreateSubmit = (input: AdminPortalCreate) => {
    setCreating(true)
    setSlugTaken(false)
    api
      .createPortal(input)
      .then(() => {
        setCreateOpen(false)
        load()
      })
      .catch((err: unknown) => {
        if (isSlugConflict(err)) {
          setSlugTaken(true)
        }
      })
      .finally(() => setCreating(false))
  }

  // A fresh install has ZERO portals in this list — the platform root org is
  // never returned by GET /api/v1/security/portals (see module doc).
  const isFreshInstall = portals.length === 0

  if (listState === 'forbidden') {
    return (
      <div data-frame="master-admin-portals">
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', color: 'var(--text-primary)' }}>Portals</h1>
        <div data-panel="portals-list" data-state="forbidden">
          <EmptyState
            icon="🔒"
            title="You don't have access to the master-admin console"
            body="You're signed in, but managing the portal fleet is restricted to FuzeFront platform admins. If you administer your own portal, use your portal console instead."
          />
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Alert tone="info" role="status" data-error-code="FORBIDDEN" data-http="403" style={{ display: 'inline-flex', maxWidth: '480px' }}>
              Platform-admin access is required to manage the portal fleet.
            </Alert>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-frame="master-admin-portals">
      {view === 'detail' && selectedPortal ? (
        <PortalDetailPanel
          portal={selectedPortal}
          onBack={backToList}
          onSuspend={handleSuspendRequest}
          onResume={handleResume}
        />
      ) : (
        <>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', color: 'var(--text-primary)', margin: '0 0 var(--space-4)' }}>
            Portals
          </h1>
          <div data-panel="portals-list" data-state={listState} aria-busy={listState === 'loading' || undefined}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
              <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
                <span data-count="portals">{portals.length}</span> portal{portals.length === 1 ? '' : 's'} ·{' '}
                <span data-count="active">{portals.filter(p => p.status === 'active').length}</span> active
              </p>
              <Button variant="primary" data-action="create-portal" onClick={() => setCreateOpen(true)}>
                Create portal
              </Button>
            </div>

            {listState === 'loading' && (
              <div data-state="loading" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ height: 'var(--space-8)', background: 'var(--bg-quaternary)', borderRadius: 'var(--radius-sm)' }} />
                ))}
              </div>
            )}

            {listState === 'error' && (
              <div data-state="error">
                <Alert tone="error" title="We couldn't load the portals" data-error-code="LOAD_FAILED">
                  Something went wrong on our end. Your access hasn't changed — try again.
                </Alert>
                <div style={{ marginTop: 'var(--space-3)' }}>
                  <Button variant="secondary" data-action="retry" onClick={load}>
                    Try again
                  </Button>
                </div>
              </div>
            )}

            {listState === 'ready' && isFreshInstall && (
              <div data-state="empty">
                <EmptyState
                  icon="🏢"
                  title="No tenant portals yet"
                  body="Create the first tenant portal to onboard a customer — they'll get their own users, catalog, and billing."
                  action={
                    <Button variant="primary" data-action="create-portal" onClick={() => setCreateOpen(true)}>
                      Create the first portal
                    </Button>
                  }
                />
              </div>
            )}

            {listState === 'ready' && !isFreshInstall && (
              <>
                <PortalsTable portals={portals} onOpen={openPortal} onSuspend={handleSuspendRequest} onResume={handleResume} />
                {hasMore && (
                  <div style={{ marginTop: 'var(--space-3)', textAlign: 'center' }}>
                    <Button variant="ghost" data-action="load-more" disabled={loadingMore} onClick={loadMore}>
                      {loadingMore ? 'Loading…' : 'Load more'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      <CreatePortalDialog
        open={createOpen}
        submitting={creating}
        slugTakenError={slugTaken}
        onCancel={() => {
          setCreateOpen(false)
          setSlugTaken(false)
        }}
        onSubmit={handleCreateSubmit}
      />

      <SuspendPortalDialog
        portal={suspendTarget}
        submitting={suspending}
        onCancel={() => setSuspendTarget(null)}
        onConfirm={handleSuspendConfirm}
      />
    </div>
  )
}
