import { useAppContext } from '../context/AppContext'
import { Session } from '../types'

export function useSession(): {
  session: Session | null
  setSession: (session: Session | null) => void
  tenantId: string | null
} {
  const { state, dispatch } = useAppContext()

  const setSession = (session: Session | null) => {
    dispatch({ type: 'SET_SESSION', payload: session })
  }

  return {
    session: state.session,
    setSession,
    tenantId: state.session?.tenantId || null,
  }
}
