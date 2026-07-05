import { User } from './shared'

declare global {
  namespace Express {
    interface Request {
      user?: User
      requestId?: string
      apiToken?: {
        id: string
        scopes: string[]
        ownerType: 'user' | 'org'
        ownerId: string
      }
    }
  }
}

export {}