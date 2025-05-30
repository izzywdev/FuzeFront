import { Session } from '../types'
export declare function useSession(): {
  session: Session | null
  setSession: (session: Session | null) => void
  tenantId: string | null
}
