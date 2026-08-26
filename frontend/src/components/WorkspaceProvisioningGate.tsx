import React, { useEffect, useRef, useState } from 'react'
import { organizationsAPI } from '../services/api'
import {
  useAppContext,
  getPersistedActiveOrganizationId,
} from '../lib/shared'
import { ProvisioningCard, ProvisioningState } from './ProvisioningCard'
import type { Organization } from '../services/api'

const POLL_INTERVAL_MS = 1750
const TIMEOUT_MS = 30_000
// Once the workspace is confirmed provisioned in this browser session, remember
// it so subsequent full-page-reload navigations (the SidePanel uses real <a>
// navigation) render the app immediately instead of re-flashing the
// "Creating your workspace…" card on every menu click.
const READY_SESSION_KEY = 'ff.workspaceReady'

interface WorkspaceProvisioningGateProps {
  children: React.ReactNode
}

/**
 * Whether `o` is evidence the caller's workspace has actually been
 * provisioned — i.e. the caller holds a real membership in it, not merely
 * that it happens to be visible.
 *
 * `GET /organizations` (both `backend/src/routes/organizations.ts` and its
 * `backend/security/src/routes/organizations.ts` twin) returns every org the
 * caller is an active member of, PLUS any `type: 'platform'` org — the
 * latter is visible to *every* authenticated user regardless of membership
 * (`whereNotNull(organization_memberships.id) OR organizations.type =
 * 'platform'`). A brand-new, genuinely-unprovisioned user therefore is not
 * guaranteed an empty `orgs` array — they may still see the platform org —
 * so "orgs.length > 0" is NOT a safe readiness check on its own.
 *
 * The security-service route projects the caller's own membership role as
 * `user_role` (`null` when the caller merely sees a public platform org —
 * see the `Organization` type doc in `services/api.ts`), which is the
 * precise signal to use when present. A backend response that omits the
 * field entirely falls back to excluding platform orgs, which is exactly
 * equivalent given the same join condition governs both routes: a
 * non-platform org is only ever included because the caller has a
 * membership row.
 *
 * Originally this only recognised `type === 'personal'` — a proxy for
 * "provisioning completed" that breaks the moment an org's `type` column is
 * wrong for any other reason (e.g. the reclassification defect fixed by
 * PR #788) even though the user's membership was never touched.
 */
function isProvisionedMembership(o: Organization): boolean {
  if (o.user_role !== undefined) {
    return o.user_role != null
  }
  return o.type !== 'platform'
}

function hasProvisionedOrg(orgs: Organization[]): boolean {
  return orgs.some(isProvisionedMembership)
}

/**
 * WorkspaceProvisioningGate
 *
 * Wraps the authenticated app shell. On mount it checks whether the caller's
 * workspace has been provisioned — at least one organization they actually
 * belong to (provisioned asynchronously after first OIDC login by Plan B),
 * not merely one they can see (e.g. the always-visible platform org). If
 * one is present it renders children immediately; otherwise it polls every
 * ~1.75 s and shows a fuse-seam ProvisioningCard.
 *
 * Timeout at 30 s → timeout state with a Retry button.
 * Network error    → error state with a Retry button.
 * Unmount          → clears the interval (no dangling timers).
 *
 * On success it dispatches SET_ORGANIZATIONS + SET_ACTIVE_ORGANIZATION so
 * the rest of the shell (and Plan G) can read org context from AppState.
 */
export function WorkspaceProvisioningGate({
  children,
}: WorkspaceProvisioningGateProps) {
  const { dispatch } = useAppContext()

  const [gateState, setGateState] = useState<
    'checking' | 'provisioning' | 'ready' | 'timeout' | 'error'
  >(() =>
    // Optimistically render the app on reload if we already confirmed the
    // workspace this session — the background check below still runs to populate
    // org context. This is what removes the per-navigation provisioning flash.
    typeof sessionStorage !== 'undefined' &&
    sessionStorage.getItem(READY_SESSION_KEY) === '1'
      ? 'ready'
      : 'checking'
  )

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  const stopPolling = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const onOrgsLoaded = (orgs: Organization[]) => {
    dispatch({ type: 'SET_ORGANIZATIONS', payload: orgs })
    // Only orgs the caller actually belongs to are candidates for "active" —
    // never the always-visible platform org they merely have visibility into.
    const memberOrgs = orgs.filter(isProvisionedMembership)
    if (memberOrgs.length > 0) {
      const personal = memberOrgs.find(o => o.type === 'personal')
      // Prefer the org the user previously selected (persisted across reloads)
      // over blindly forcing the personal org — otherwise every reload reset
      // the active org to personal and billed the wrong org. Only fall back to
      // personal — or, absent that, any other org the caller belongs to —
      // when there is no valid persisted selection.
      const persistedId = getPersistedActiveOrganizationId()
      const persisted = persistedId
        ? memberOrgs.find(o => o.id === persistedId)
        : null
      const active = persisted ?? personal ?? memberOrgs[0]
      dispatch({ type: 'SET_ACTIVE_ORGANIZATION', payload: active.id })
      try {
        sessionStorage.setItem(READY_SESSION_KEY, '1')
      } catch {
        // ignore
      }
      stopPolling()
      setGateState('ready')
    }
  }

  const startPolling = () => {
    startTimeRef.current = Date.now()
    setGateState('provisioning')

    intervalRef.current = setInterval(async () => {
      if (Date.now() - startTimeRef.current >= TIMEOUT_MS) {
        stopPolling()
        setGateState('timeout')
        return
      }

      try {
        const orgs: Organization[] = await organizationsAPI.getOrganizations()
        if (hasProvisionedOrg(orgs)) {
          onOrgsLoaded(orgs)
        }
      } catch {
        stopPolling()
        setGateState('error')
      }
    }, POLL_INTERVAL_MS)
  }

  const handleRetry = () => {
    stopPolling()
    startPolling()
  }

  useEffect(() => {
    let cancelled = false
    // If we rendered the app optimistically (workspace already confirmed this
    // session), the background check only refreshes org context — it must never
    // downgrade to the provisioning/error card and re-flash on navigation.
    const startedReady =
      typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem(READY_SESSION_KEY) === '1'

    const check = async () => {
      try {
        const orgs: Organization[] = await organizationsAPI.getOrganizations()
        if (cancelled) return
        if (hasProvisionedOrg(orgs)) {
          onOrgsLoaded(orgs)
        } else if (!startedReady) {
          startPolling()
        }
      } catch {
        if (!cancelled && !startedReady) {
          setGateState('error')
        }
      }
    }

    check()

    return () => {
      cancelled = true
      stopPolling()
    }
  }, [])

  if (gateState === 'ready') {
    return <>{children}</>
  }

  if (gateState === 'checking' || gateState === 'provisioning') {
    // First-timers have their workspace CREATED (provisioning); returning users
    // already have one and we're just LOADING it (checking). Distinct copy so an
    // existing user doesn't see "Creating your workspace".
    const isCreating = gateState === 'provisioning'
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          background: 'var(--bg-primary)',
        }}
      >
        <ProvisioningCard
          state="loading"
          title={isCreating ? undefined : 'Loading your workspace…'}
          description={
            isCreating ? undefined : 'Getting your workspace ready…'
          }
        />
      </div>
    )
  }

  const cardState: ProvisioningState =
    gateState === 'timeout' ? 'timeout' : 'error'

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: 'var(--bg-primary)',
      }}
    >
      <ProvisioningCard state={cardState} onRetry={handleRetry} />
    </div>
  )
}
