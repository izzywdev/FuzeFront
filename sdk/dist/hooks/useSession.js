import { useCallback } from 'react'
import { usePlatformContext } from '../context/PlatformProvider'
export function useSession() {
  var _a
  const { state, dispatch } = usePlatformContext()
  const setSession = useCallback(
    session => {
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
    tenantId:
      ((_a = state.session) === null || _a === void 0 ? void 0 : _a.tenantId) ||
      null,
    isExpired: isExpired(),
  }
}
