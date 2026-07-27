import { User } from './shared'

declare global {
  namespace Express {
    interface Request {
      user?: User
      requestId?: string
      // FF-EPIC-10-S1 — set by resolvePortalContext (src/middleware/portalContext.ts)
      // to the raw `portals` DB row for the current request. Only present when the
      // multi-tenant-portals flag is ON and resolution succeeded.
      portal?: any
    }
  }
}

export {} 