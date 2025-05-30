import { useAppContext } from '../context/AppContext'
import { User } from '../types'

export function useCurrentUser(): {
  user: User | null
  setUser: (user: User | null) => void
  isAuthenticated: boolean
} {
  const { state, dispatch } = useAppContext()

  const setUser = (user: User | null) => {
    dispatch({ type: 'SET_USER', payload: user })
  }

  return {
    user: state.user,
    setUser,
    isAuthenticated: !!state.user,
  }
}
