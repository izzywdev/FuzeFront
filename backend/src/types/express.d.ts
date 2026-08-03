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
      // FF-EPIC-10-S3 — the multi-tenant-portals flag decision resolvePortalContext
      // made for THIS request, reused by authenticateToken so the two middlewares
      // can't disagree on flag state within one request. Undefined only if
      // resolvePortalContext never ran upstream of a given route.
      portalsFlagEnabled?: boolean
      // Round-8 fix (gate-code-review) — set ONLY when resolvePortalContext's
      // outcome was `{ kind: 'degraded' }` (a transient host-lookup/infra
      // error), never for `bootstrap` (no root portal seeded yet — a genuine,
      // expected state) or `flag-off`. `req.portal === undefined &&
      // req.portalsFlagEnabled === true` is otherwise indistinguishable
      // between "degraded" and "bootstrap", and downstream consumers
      // (authenticateToken, routes/portal.ts) need to treat them very
      // differently: bootstrap fails OPEN to generic branding (correct — it's
      // not an error), degraded must fail CLOSED with a retryable 503 (a
      // transient error must never silently serve generic/root branding for a
      // host that may map to a SUSPENDED portal). Always undefined/false on a
      // fresh request unless this exact request's resolution degraded.
      portalResolutionDegraded?: boolean
      // FF-EPIC-11-S6 — the fuzefront.identity.portal-scoped-users flag decision
      // for THIS request, cached by utils/identityFlag.ts's
      // getRequestPortalScopingEnabled so a request that calls scopeToPortal
      // more than once (e.g. a count query + a data query) evaluates the flag
      // exactly once. Undefined until first read.
      portalScopingFlagEnabled?: boolean
    }
  }
}

export {} 