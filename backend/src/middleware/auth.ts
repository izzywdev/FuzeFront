import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { db } from '../config/database'
import { User } from '../types/shared'
import { getRootPortal } from '../repositories/portalRepository'
import { getRequestPortalsEnabled } from '../utils/portalFlag'

// Strips CR/LF before a value reaches a log line (CodeQL js/log-injection —
// an embedded newline could forge additional fake log lines). Applied to
// every value below that ultimately traces back to request-controlled input
// (the JWT `portal_id` claim, resolved from the client-supplied Authorization
// header) even though it's cryptographically verified first — defense in
// depth against CodeQL's conservative taint tracking, same idiom as
// routes/billing.ts's upstream-error logger.
const oneLine = (v: unknown) => String(v).replace(/[\r\n]+/g, ' ')

export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const requestId = req.requestId || 'unknown'
  const authHeader = req.headers['authorization']
  const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

  console.log(`🔐 [${requestId}] Auth middleware - checking token:`, {
    hasAuthHeader: !!authHeader,
    hasToken: !!token,
    tokenPreview: token ? `${token.substring(0, 20)}...` : 'none',
    path: req.path,
    method: req.method,
  })

  if (!token) {
    console.log(`❌ [${requestId}] No token provided`)
    return res.status(401).json({ error: 'Access denied. No token provided.' })
  }

  try {
    console.log(`🔍 [${requestId}] Verifying JWT token...`)
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string
      // FF-EPIC-10-S3 — the portal this token was minted for (routes/auth.ts
      // jwt.sign call sites). Absent on tokens issued before this epic, or
      // whenever the multi-tenant-portals flag was OFF at mint time.
      portalId?: string
    }

    console.log(`✅ [${requestId}] Token verified, fetching user:`, {
      userId: decoded.userId,
    })

    // Fetch user from database
    const userRow = await db('users')
      .select(
        'id',
        'email',
        'first_name',
        'last_name',
        'default_app_id',
        'roles'
      )
      .where('id', decoded.userId)
      .first()

    if (!userRow) {
      console.log(`❌ [${requestId}] User not found in database:`, {
        userId: decoded.userId,
      })
      return res.status(401).json({ error: 'User not found' })
    }

    console.log(`👤 [${requestId}] User authenticated:`, {
      userId: userRow.id,
      email: userRow.email,
      roles: userRow.roles,
    })

    const user: User = {
      id: userRow.id,
      email: userRow.email,
      firstName: userRow.first_name,
      lastName: userRow.last_name,
      defaultAppId: userRow.default_app_id,
      roles: Array.isArray(userRow.roles)
        ? userRow.roles
        : JSON.parse(userRow.roles || '["user"]'),
    }

    // FF-EPIC-10-S3 — token-derived portal binding, NEVER a client-supplied
    // URL/query param. Only active when the master flag is ON, so pre-epic
    // token/session shapes and behavior are unchanged while it's OFF.
    //
    // Root cause A fix (gate-code-review round 4) — getRequestPortalsEnabled
    // reuses resolvePortalContext's flag decision for THIS request (stashed
    // on req.portalsFlagEnabled) instead of evaluating independently. See
    // utils/portalFlag.ts for why every request-path consumer must go
    // through that one shared helper rather than re-implementing this
    // fallback locally.
    const portalsEnabled = await getRequestPortalsEnabled(req)
    if (portalsEnabled) {
      const resolvedPortal = req.portal // set by resolvePortalContext, if mounted upstream

      // Round-9 fix (gate-code-review) — a DEGRADED resolution (a transient
      // host-lookup/infra error in resolvePortalContext) must fail closed for
      // EVERY authenticated request — portal-bound AND legacy — and never fall
      // open to root. We CANNOT distinguish a root-host blip from a tenant-host
      // blip here (the host lookup itself failed), so both a claimed-portal
      // token and a claimless legacy token get a TRANSIENT, retryable 503 —
      // never a 401 (which destroys the session / mass-logs-out every portal-
      // bound user on a brief portal_domains DB blip) and never a silent bind-
      // to-root (the legacy branch's `getRootPortal()` fall-through, which
      // would accept a legacy token presented on a tenant Host and bind it to
      // root — bypassing the AC3 non-root rejection). Only a genuinely RESOLVED
      // portal with a mismatching (portal-bound) or non-root (legacy) binding,
      // handled below, is a real cross-portal violation and a 401. This guard
      // is hoisted ABOVE the decoded.portalId/legacy split precisely so BOTH
      // branches are covered by one check — the earlier round-8 fix guarded
      // only the portal-bound branch, leaving the legacy branch fail-open.
      if (req.portalResolutionDegraded) {
        return res.status(503).json({
          error: 'PORTAL_RESOLUTION_UNAVAILABLE',
          message: 'Portal context is temporarily unavailable, please retry.',
        })
      }

      if (decoded.portalId) {
        // Fix (a) — FAIL CLOSED. Previously `resolvedPortal &&
        // resolvedPortal.id !== decoded.portalId` skipped the reject
        // entirely whenever resolvedPortal was falsy (e.g. resolvePortalContext
        // didn't run, or context disagreement made it see the flag OFF and
        // never set req.portal) — silently ACCEPTING a token minted for a
        // portal we have no way to verify against. A claimed portal_id with
        // no portal context to check it against must never fall through to
        // acceptance. (The DEGRADED case is handled by the hoisted guard
        // above, before this split, so it is not re-checked here.)
        if (!resolvedPortal || resolvedPortal.id !== decoded.portalId) {
          // AC3 — a token minted for portal A presented on portal B's Host
          // (or on a route where portal context is simply missing) is
          // rejected outright; the caller must re-authenticate.
          // Constant format string + arguments, never an interpolated one (a
          // variable as/in the format string lets an injected specifier
          // forge log output) — same convention as utils/feature-flags.ts.
          console.log(
            '❌ [%s] Token portal mismatch or missing portal context: token=%s host=%s',
            oneLine(requestId),
            oneLine(decoded.portalId),
            oneLine(resolvedPortal?.id ?? 'none')
          )
          return res.status(401).json({ error: 'Invalid token.' })
        }
        user.portalId = decoded.portalId
      } else {
        // Root cause B fix (gate-code-review round 4) — FAIL CLOSED for
        // legacy tokens too. A pre-epic token (no portal_id claim) carries
        // NO verifiable portal binding at all. The old code bound it to
        // `resolvedPortal?.id ?? root?.id` — i.e. WHATEVER Host the request
        // happened to resolve to, unverified. A pre-epic session presented
        // on tenant B's Host was silently bound to portal B: fail-open
        // cross-portal, the exact thing AC3 exists to stop, just reached via
        // the one branch AC3 doesn't cover (no claim to compare against).
        //
        // POLICY (flagged to the coordinator/owner for sign-off): a legacy
        // token is valid ONLY on the root portal. Presented on a Host that
        // resolves to a non-root TENANT portal, it is rejected outright
        // (401, re-authentication required) rather than silently bound.
        if (resolvedPortal) {
          if (!resolvedPortal.is_root) {
            console.log(
              '❌ [%s] Legacy token (no portal_id claim) presented on a non-root portal Host: host=%s',
              oneLine(requestId),
              oneLine(resolvedPortal.id)
            )
            return res.status(401).json({ error: 'Invalid token.' })
          }
          user.portalId = resolvedPortal.id
        } else {
          // No portal resolved for this request at all (bootstrap mode, or
          // resolvePortalContext didn't run upstream) — only NOW fetch root,
          // and only here: the OLD code fetched it unconditionally on every
          // legacy-token request (even when resolvedPortal already made the
          // fallback unused), so a portals-table hiccup broke auth (this
          // whole block is inside authenticateToken's try/catch, which turns
          // any thrown error into a blanket 401) for sessions that never
          // touch multi-tenant portals at all. `.catch()` additionally
          // ensures a genuine DB error here degrades to "no portal bound"
          // rather than failing the request.
          const root = await getRootPortal(db).catch(() => undefined)
          user.portalId = root?.id
        }
      }
    }

    req.user = user
    next()
  } catch (error) {
    console.log(`❌ [${requestId}] Token verification failed:`, {
      error: error instanceof Error ? error.message : String(error),
      tokenPreview: token ? `${token.substring(0, 20)}...` : 'none',
    })
    return res.status(401).json({ error: 'Invalid token.' })
  }
}

export const requireRole = (roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const user = req.user as User; const userRoles = user.roles || []
    const hasRole = roles.some(role => userRoles.includes(role))
    if (!hasRole) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }

    next()
  }
}
