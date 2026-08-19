import { useCallback } from 'react'
import { usePlatformContext } from '../context/PlatformProvider'
import type { UseSessionResult, Session } from '../types'

export function useSession(): UseSessionResult {
  const { state, dispatch } = usePlatformContext()

  const setSession = useCallback(
    (session: Session | null) => {
      dispatch({ type: 'SET_SESSION', payload: session })
    },
    [dispatch]
  )

  const isExpired = useCallback(() => {
    if (!state.session) return true
    return new Date(state.session.expiresAt) <= new Date()
  }, [state.session])

  return {
    session: state.session,
    setSession,
    tenantId: state.session?.tenantId || null,
    isExpired: isExpired(),
  }
}
