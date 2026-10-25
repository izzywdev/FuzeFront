import React, { useEffect, useRef, useState } from 'react'
import { organizationsAPI, securitySessionAPI } from '../services/api'
import {
  useAppContext,
  useCurrentUser,
  getPersistedActiveOrganizationId,
  getPersistedPersonalTenantId,
  ROOT_ORG_ID,
} from '../lib/shared'
import { isEmployeeUser } from '../utils/employee'
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

function hasRestorableWorkspace(): boolean {
  if (
    typeof sessionStorage === 'undefined' ||
    sessionStorage.getItem(READY_SESSION_KEY) !== '1'
  ) {
    return false
  }

  return (
    getPersistedActiveOrganizationId() !== null ||
    getPersistedPersonalTenantId() !== null
  )
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
  const { user } = useCurrentUser()
  const isEmployee = isEmployeeUser(user?.roles)

  const [gateState, setGateState] = useState<
    'checking' | 'provisioning' | 'ready' | 'timeout' | 'error'
  >(() =>
    // Optimistically render the app on reload if we already confirmed the
    // workspace this session — the background check below still runs to populate
    // org context. This is what removes the per-navigation provisioning flash.
    hasRestorableWorkspace()
      ? 'ready'
      : 'checking'
  )

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)
  const requestGenerationRef = useRef(0)
  const mountedRef = useRef(false)

  const stopPolling = () => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const markReady = () => {
    try {
      sessionStorage.setItem(READY_SESSION_KEY, '1')
    } catch {
      // ignore
    }
    stopPolling()
    setGateState('ready')
  }

  const onOrgsLoaded = async (orgs: Organization[]): Promise<boolean> => {
    const requestGeneration = ++requestGenerationRef.current
    dispatch({ type: 'SET_ORGANIZATIONS', payload: orgs })
    // Only orgs the caller actually belongs to are candidates for "active" —
    // never the always-visible platform org they merely have visibility into.
    const memberOrgs = orgs.filter(isProvisionedMembership)
    // Non-employees cannot have ROOT_ORG_ID as their active organization
    const eligibleOrgs = memberOrgs.filter(o => isEmployee || o.id !== ROOT_ORG_ID)

    const personal = eligibleOrgs.find(o => o.type === 'personal')

    // Personal is a Security-owned tenant, independent of organization
    // membership. Resolve it even for organization members so selecting
    // Personal later cannot mount a federated app without tenant context.
    const resolvedPersonalTenantId =
      await securitySessionAPI.resolvePersonalTenant()

    // setInterval callbacks can overlap. An older Security request must never
    // overwrite a workspace selected by a newer poll, nor dispatch after the
    // gate has unmounted.
    if (
      !mountedRef.current ||
      requestGeneration !== requestGenerationRef.current
    ) {
      return false
    }

    const personalTenantId = resolvedPersonalTenantId ?? personal?.id ?? null
    dispatch({ type: 'SET_PERSONAL_TENANT', payload: personalTenantId })

    if (eligibleOrgs.length > 0) {
      // Prefer the org the user previously selected (persisted across reloads)
      // over blindly forcing the personal org — otherwise every reload reset
      // the active org to personal and billed the wrong org. Only fall back to
      // personal — or, absent that, any other org the caller belongs to —
      // when there is no valid persisted selection.
      const persistedId = getPersistedActiveOrganizationId()
      const persisted = persistedId && (isEmployee || persistedId !== ROOT_ORG_ID)
        ? eligibleOrgs.find(o => o.id === persistedId)
        : null
      const active = persisted ?? personal ?? eligibleOrgs[0]
      dispatch({ type: 'SET_ACTIVE_ORGANIZATION', payload: active.id })
      markReady()
      return true
    } else {
      // The portal models Personal as a null active organization, but products
      // still require the Security-owned tenant that persists and authorizes
      // personal data. Discover it and prove membership before mounting any
      // federated application; otherwise the first API calls race with an
      // unresolved tenant and fail as "tenant-scoped identity required".
      if (personalTenantId) {
        dispatch({ type: 'SET_ACTIVE_ORGANIZATION', payload: null })
        markReady()
        return true
      }
      return false
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
        await onOrgsLoaded(orgs)
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
    mountedRef.current = true
    let cancelled = false
    // If we rendered the app optimistically (workspace already confirmed this
    // session), the background check only refreshes org context — it must never
    // downgrade to the provisioning/error card and re-flash on navigation.
    const startedReady = hasRestorableWorkspace()

    const check = async () => {
      try {
        const orgs: Organization[] = await organizationsAPI.getOrganizations()
        if (cancelled) return
        const resolved = await onOrgsLoaded(orgs)
        if (cancelled) return
        if (!resolved && !startedReady) {
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
      mountedRef.current = false
      requestGenerationRef.current += 1
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
