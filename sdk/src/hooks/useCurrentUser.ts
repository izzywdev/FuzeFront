import { useCallback } from 'react'
import { usePlatformContext } from '../context/PlatformProvider'
import type { UseCurrentUserResult, User } from '../types'

export function useCurrentUser(): UseCurrentUserResult {
  const { state, dispatch } = usePlatformContext()

  const setUser = useCallback(
    (user: User | null) => {
      dispatch({ type: 'SET_USER', payload: user })
    },
    [dispatch]
  )

  const hasRole = useCallback(
    (role: string) => {
      return state.user?.roles.includes(role) ?? false
    },
    [state.user?.roles]
  )

  return {
    user: state.user,
    setUser,
    isAuthenticated: !!state.user,
    hasRole,
  }
}
