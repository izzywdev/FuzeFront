import React, { useEffect, useRef, useState } from 'react'
import { organizationsAPI } from '../services/api'
import { useAppContext } from '../lib/shared'
import { ProvisioningCard, ProvisioningState } from './ProvisioningCard'
import type { Organization } from '../services/api'

const POLL_INTERVAL_MS = 1750
const TIMEOUT_MS = 30_000

interface WorkspaceProvisioningGateProps {
  children: React.ReactNode
}

function hasPersonalOrg(orgs: Organization[]): boolean {
  return orgs.some(o => o.type === 'personal')
}

/**
 * WorkspaceProvisioningGate
 *
 * Wraps the authenticated app shell. On mount it checks for the user's
 * personal organization (provisioned asynchronously after first OIDC login
 * by Plan B). If the org is present it renders children immediately;
 * otherwise it polls every ~1.75 s and shows a fuse-seam ProvisioningCard.
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
  >('checking')

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
    const personal = orgs.find(o => o.type === 'personal')
    if (personal) {
      dispatch({ type: 'SET_ACTIVE_ORGANIZATION', payload: personal.id })
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
        if (hasPersonalOrg(orgs)) {
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

    const check = async () => {
      try {
        const orgs: Organization[] = await organizationsAPI.getOrganizations()
        if (cancelled) return
        if (hasPersonalOrg(orgs)) {
          onOrgsLoaded(orgs)
        } else {
          startPolling()
        }
      } catch {
        if (!cancelled) {
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
        <ProvisioningCard state="loading" />
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
