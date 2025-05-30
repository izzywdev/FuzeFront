import { useCallback } from 'react'
import { usePlatformContext } from '../context/PlatformProvider'
export function useCurrentUser() {
  var _a
  const { state, dispatch } = usePlatformContext()
  const setUser = useCallback(
    user => {
      dispatch({ type: 'SET_USER', payload: user })
    },
    [dispatch]
  )
  const hasRole = useCallback(
    role => {
      var _a, _b
      return (_b =
        (_a = state.user) === null || _a === void 0
          ? void 0
          : _a.roles.includes(role)) !== null && _b !== void 0
        ? _b
        : false
    },
    [(_a = state.user) === null || _a === void 0 ? void 0 : _a.roles]
  )
  return {
    user: state.user,
    setUser,
    isAuthenticated: !!state.user,
    hasRole,
  }
}
