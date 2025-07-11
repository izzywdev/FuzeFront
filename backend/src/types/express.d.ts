import { User } from './shared'

declare global {
  namespace Express {
    interface Request {
      user?: User
      requestId?: string
    }
  }
}

export {} 