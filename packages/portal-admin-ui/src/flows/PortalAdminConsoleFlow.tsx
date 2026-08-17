import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, EmptyState } from '@fuzefront/design-system'
import { createPortalConsoleClient, type PortalConsoleClient } from '../api/portalConsoleClient'
import { PortalConsoleShell, type PortalConsoleTab } from '../components/console/PortalConsoleShell'
import { OverviewTab } from '../components/console/OverviewTab'
import { UsersTab } from '../components/console/UsersTab'
import { InviteUserDialog } from '../components/console/InviteUserDialog'
import { CatalogTab, AddAppDialog, type CatalogItem } from '../components/console/CatalogTab'
import type { Invitation, InvitationRole, OrgMember, Portal, PortalCatalogEntry, RegistryApp } from '../types'

export interface PortalAdminConsoleFlowProps {
  getToken?: () => string | null | undefined
  baseUrl?: string
  /** The signed-in caller's own user id — drives the Users tab self-lockout guard. */
  currentUserId?: string
  /** `fuzefront.apps.portal-catalog` — gates the App-catalog tab specifically. Default false. */
  catalogEnabled?: boolean
  client?: PortalConsoleClient
}

type PortalState = 'loading' | 'ready' | 'error' | 'suspended' | 'forbidden'
type SectionState = 'loading' | 'ready' | 'error'

const PAGE_LIMIT = 25

function errorCode(err: unknown): string | undefined {
  return (err as { code?: string })?.code
}
function httpStatus(err: unknown): number | undefined {
  return (err as { status?: number })?.status
}

/**
 * S3 orchestrator — `PortalAdminConsoleFlow` (route `/portal/admin`,
 * FF-EPIC-14-S3). Tabbed console: Overview / Users / App catalog. The portal
 * itself is ALWAYS resolved from the session (`GET /portal/current`) — no
 * portalId is ever read from a prop, query string, or URL, so a cross-tenant
 * request against another portal cannot be constructed by this UI.
 */
export function PortalAdminConsoleFlow({ getToken, baseUrl, currentUserId, catalogEnabled, client }: PortalAdminConsoleFlowProps) {
  const api = client ?? createPortalConsoleClient({ getToken, baseUrl })

  const [portalState, setPortalState] = useState<PortalState>('loading')
  const [portal, setPortal] = useState<Portal | null>(null)
  const [activeTab, setActiveTab] = useState<PortalConsoleTab>('overview')

  const [usersState, setUsersState] = useState<SectionState>('loading')
  const [members, setMembers] = useState<OrgMember[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [usersCursor, setUsersCursor] = useState<string | null>(null)
  const [usersHasMore, setUsersHasMore] = useState(false)
  const [usersLoadingMore, setUsersLoadingMore] = useState(false)

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteSubmitting, setInviteSubmitting] = useState(false)
  const [inviteForbidden, setInviteForbidden] = useState(false)

  const [catalogState, setCatalogState] = useState<SectionState>('loading')
  const [catalogEntries, setCatalogEntries] = useState<PortalCatalogEntry[]>([])
  const [registryApps, setRegistryApps] = useState<RegistryApp[]>([])
  const [addAppOpen, setAddAppOpen] = useState(false)

  const loadUsers = useCallback(
    (orgId: string) => {
      setUsersState('loading')
      Promise.all([api.listOrgMembers(orgId, { limit: PAGE_LIMIT }), api.listInvitations(orgId, { limit: PAGE_LIMIT })])
        .then(([membersPage, invitationsPage]) => {
          setMembers(membersPage.items)
          setUsersCursor(membersPage.page.nextCursor)
          setUsersHasMore(Boolean(membersPage.page.hasMore))
          setInvitations(invitationsPage.items.filter(inv => inv.status === 'pending'))
          setUsersState('ready')
        })
        .catch(() => setUsersState('error'))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const loadCatalog = useCallback(
    (portalId: string) => {
      setCatalogState('loading')
      Promise.all([api.listPortalCatalog(portalId, { limit: 100 }), api.listRegistryApps()])
        .then(([catalogPage, apps]) => {
          setCatalogEntries(catalogPage.items)
          setRegistryApps(apps)
          setCatalogState('ready')
        })
        .catch(() => setCatalogState('error'))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const loadPortal = useCallback(() => {
    setPortalState('loading')
    api
      .getCurrentPortal()
      .then(p => {
        setPortal(p)
        setPortalState('ready')
        loadUsers(p.organizationId)
        if (catalogEnabled) loadCatalog(p.id)
      })
      .catch((err: unknown) => {
        const status = httpStatus(err)
        const code = errorCode(err)
        if (status === 403 && code === 'PORTAL_SUSPENDED') {
          setPortalState('suspended')
          return
        }
        if (status === 403) {
          setPortalState('forbidden')
          return
        }
        setPortalState('error')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogEnabled])

  useEffect(() => {
    loadPortal()
  }, [loadPortal])

  const loadMoreUsers = () => {
    if (!portal || !usersCursor || usersLoadingMore) return
    setUsersLoadingMore(true)
    api
      .listOrgMembers(portal.organizationId, { limit: PAGE_LIMIT, cursor: usersCursor })
      .then(page => {
        setMembers(prev => [...prev, ...page.items])
        setUsersCursor(page.page.nextCursor)
        setUsersHasMore(Boolean(page.page.hasMore))
      })
      .catch(() => undefined)
      .finally(() => setUsersLoadingMore(false))
  }

  const handleInviteSubmit = (input: { email: string; role: InvitationRole }) => {
    if (!portal) return
    setInviteSubmitting(true)
    setInviteForbidden(false)
    api
      .createInvitation(portal.organizationId, input.email, input.role)
      .then(created => {
        setInvitations(prev => [...prev, created])
        setInviteOpen(false)
      })
      .catch((err: unknown) => {
        if (httpStatus(err) === 403) {
          setInviteForbidden(true)
          return
        }
      })
      .finally(() => setInviteSubmitting(false))
  }

  const handleResendInvite = (invitation: Invitation) => {
    if (!portal) return
    api.resendInvitation(portal.organizationId, invitation.id).catch(() => undefined)
  }

  const handleRevokeInvite = (invitation: Invitation) => {
    if (!portal) return
    api
      .revokeInvitation(portal.organizationId, invitation.id)
      .then(() => setInvitations(prev => prev.filter(i => i.id !== invitation.id)))
      .catch(() => undefined)
  }

  const handleReorderCatalog = (nextEntries: PortalCatalogEntry[]) => {
    if (!portal) return
    setCatalogEntries(nextEntries.map((entry, index) => ({ ...entry, pinnedOrder: index })))
    nextEntries.forEach((entry, index) => {
      if (entry.pinnedOrder !== index) {
        api.updateCatalogEntry(portal.id, entry.appId, { pinnedOrder: index }).catch(() => undefined)
      }
    })
  }

  const handleEnableApp = (appId: string) => {
    if (!portal) return
    api
      .enableCatalogApp(portal.id, appId, catalogEntries.length)
      .then(entry => {
        setCatalogEntries(prev => [...prev, entry])
        setAddAppOpen(false)
      })
      .catch(() => undefined)
  }

  const handleDisableApp = (appId: string) => {
    if (!portal) return
    api
      .disableCatalogApp(portal.id, appId)
      .then(() => setCatalogEntries(prev => prev.filter(e => e.appId !== appId)))
      .catch(() => undefined)
  }

  if (portalState === 'loading') {
    return (
      <div data-frame="portal-console" data-state="loading" aria-busy="true">
        <div style={{ height: 'var(--space-8)', width: '40%', background: 'var(--bg-quaternary)', borderRadius: 'var(--radius-sm)' }} />
      </div>
    )
  }

  if (portalState === 'suspended') {
    return (
      <div data-frame="portal-console" data-panel="portal-console" data-state="suspended">
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', color: 'var(--text-primary)' }}>Console</h1>
        <EmptyState
          icon="⛔"
          title="This portal is suspended"
          body="A FuzeFront administrator has suspended this portal, so its console is read-blocked. Your data is retained. Contact FuzeFront support to resolve it — you're signed in, this is not a login problem."
        />
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Alert tone="error" data-error-code="PORTAL_SUSPENDED" data-http="403" style={{ display: 'inline-flex', maxWidth: '480px' }}>
            The whole console is read-blocked while this portal is suspended.
          </Alert>
        </div>
      </div>
    )
  }

  if (portalState === 'forbidden') {
    return (
      <div data-frame="portal-console" data-state="forbidden">
        <EmptyState icon="🔒" title="No portal is bound to this session" body="Sign in as a portal admin to reach this console." />
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Alert tone="info" data-error-code="FORBIDDEN_PORTAL" data-http="403" style={{ display: 'inline-flex', maxWidth: '480px' }}>
            This session isn't scoped to a portal you administer.
          </Alert>
        </div>
      </div>
    )
  }

  if (portalState === 'error' || !portal) {
    return (
      <div data-frame="portal-console" data-state="error">
        <Alert tone="error" title="We couldn't load your portal" data-error-code="LOAD_FAILED">
          Something went wrong on our end. Your access hasn't changed — try again.
        </Alert>
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Button variant="secondary" data-action="retry" onClick={loadPortal}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  const catalogItems: CatalogItem[] = catalogEntries
    .filter(e => e.enabled)
    .sort((a, b) => a.pinnedOrder - b.pinnedOrder)
    .map(entry => ({ entry, app: registryApps.find(a => a.id === entry.appId) }))
  const enabledAppIds = new Set(catalogEntries.filter(e => e.enabled).map(e => e.appId))
  const availableApps = registryApps.filter(a => !enabledAppIds.has(a.id))

  const userCount = usersState === 'ready' ? members.length + invitations.length : null
  const appCount = catalogEnabled && catalogState === 'ready' ? catalogItems.length : null

  return (
    <PortalConsoleShell portalName={portal.name} activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'overview' && <OverviewTab portal={portal} userCount={userCount} appCount={appCount} />}

      {activeTab === 'users' && (
        <>
          <UsersTab
            state={usersState}
            members={members}
            invitations={invitations}
            currentUserId={currentUserId}
            hasMore={usersHasMore}
            loadingMore={usersLoadingMore}
            onLoadMore={loadMoreUsers}
            onInvite={() => setInviteOpen(true)}
            onResendInvite={handleResendInvite}
            onRevokeInvite={handleRevokeInvite}
            onRetry={() => loadUsers(portal.organizationId)}
          />
          <InviteUserDialog
            open={inviteOpen}
            submitting={inviteSubmitting}
            forbidden={inviteForbidden}
            onCancel={() => {
              setInviteOpen(false)
              setInviteForbidden(false)
            }}
            onSubmit={handleInviteSubmit}
          />
        </>
      )}

      {activeTab === 'catalog' &&
        (catalogEnabled ? (
          <>
            <CatalogTab
              state={catalogState}
              items={catalogItems}
              onRetry={() => loadCatalog(portal.id)}
              onReorder={handleReorderCatalog}
              onAddApp={() => setAddAppOpen(true)}
              onDisable={handleDisableApp}
            />
            <AddAppDialog open={addAppOpen} available={availableApps} onClose={() => setAddAppOpen(false)} onEnable={handleEnableApp} />
          </>
        ) : (
          <div data-panel="catalog-enabled" data-state="disabled">
            <EmptyState icon="🧩" title="The app catalog isn't available yet" body="This capability is rolling out." />
          </div>
        ))}
    </PortalConsoleShell>
  )
}
