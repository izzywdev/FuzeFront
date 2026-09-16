import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type MyAccess } from './services/api'

/**
 * The signed-in developer's own access status, as GET /v1/me actually reports it:
 *   - 401              -> 'anonymous' (not signed in — never an error state)
 *   - 200, no explicit membershipStatus, or membershipStatus: 'active' -> 'active'
 *   - 202 / membershipStatus: 'provisioning' -> 'provisioning' (grant not landed yet)
 *   - 403 / membershipStatus: 'denied' -> 'denied' (fails closed as a whole — frame 09c)
 *   - anything else non-2xx -> 'error' (frame 09d — nothing rendered from a cached/default
 *     assumption)
 */
export type AccessState =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'active'; access: MyAccess }
  | { kind: 'provisioning' }
  | { kind: 'denied'; httpStatus: number }
  | { kind: 'error'; message: string; httpStatus?: number }

/** Convenience booleans layered over AccessState so callers that only care about
 * "is someone signed in" (NavBar, HomePage) don't have to switch on `kind` themselves. */
export interface UseMyAccess {
  state: AccessState
  loading: boolean
  signedIn: boolean
  access: MyAccess | null
  refresh: () => void
}

export function useMyAccess(): UseMyAccess {
  const [state, setState] = useState<AccessState>({ kind: 'loading' })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    api
      .getMyAccessRaw()
      .then(({ status, body }) => {
        if (cancelled) return
        if (status === 202 || body.membershipStatus === 'provisioning') {
          setState({ kind: 'provisioning' })
          return
        }
        // A 200 with a full MyAccess body — 'active' unless the service says otherwise.
        setState({ kind: 'active', access: { membershipStatus: 'active', ...body } as MyAccess })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 401) {
          setState({ kind: 'anonymous' })
        } else if (err instanceof ApiError && err.status === 403) {
          setState({ kind: 'denied', httpStatus: 403 })
        } else if (err instanceof ApiError) {
          setState({ kind: 'error', message: err.message, httpStatus: err.status })
        } else {
          setState({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load your access.' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  const refresh = useCallback(() => setTick(t => t + 1), [])

  return {
    state,
    loading: state.kind === 'loading',
    signedIn: state.kind === 'active' || state.kind === 'provisioning',
    access: state.kind === 'active' ? state.access : null,
    refresh,
  }
}
