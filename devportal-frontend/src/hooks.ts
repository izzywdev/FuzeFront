import { useEffect, useState } from 'react'
import { api, ApiError, type MyAccess } from './services/api'

export interface AuthState {
  loading: boolean
  signedIn: boolean
  access: MyAccess | null
}

/** Resolves the current session by calling /v1/me. A 401 means signed-out —
 * NOT an error state; every other failure surfaces as `error`. */
export function useAuth(): AuthState & { error: string | null; refresh: () => void } {
  const [state, setState] = useState<AuthState>({ loading: true, signedIn: false, access: null })
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState(s => ({ ...s, loading: true }))
    api
      .getMyAccess()
      .then(access => {
        if (!cancelled) setState({ loading: false, signedIn: true, access })
      })
      .catch(err => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 401) {
          setState({ loading: false, signedIn: false, access: null })
        } else {
          setState({ loading: false, signedIn: false, access: null })
          setError(err instanceof Error ? err.message : 'Failed to load session.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  return { ...state, error, refresh: () => setTick(t => t + 1) }
}
