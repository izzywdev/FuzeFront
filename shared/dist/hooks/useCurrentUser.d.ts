import { User } from '../types'
export declare function useCurrentUser(): {
  user: User | null
  setUser: (user: User | null) => void
  isAuthenticated: boolean
}
