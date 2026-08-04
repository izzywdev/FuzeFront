// FF-EPIC-11-S3 — public token-based invitation routes.
// GET  /api/invitations/:token         — resolve (no auth required)
// POST /api/invitations/:token/accept  — accept (auth optional: an
//   unauthenticated caller is redirected to enroll, matching pre-epic
//   backend/security/src/routes/invitations.ts behavior exactly)
//
// This file's only `db('users')` touches are SELF reads/writes of the
// AUTHENTICATED caller's own row (resolved from a verified JWT, matched by
// id — never another user's row queried by email/listing). That is the SAME
// exemption tests/scope-to-portal-guard.test.ts already grants routes/auth.ts
// (login/signup/OIDC: a caller resolving/mutating their OWN identity, not a
// directory read) — see this file's entry in that test's ALLOWLIST.
import express from 'express'
import rateLimit from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { assignOrganizationRole } from '../utils/permit/role-assignment'
import { getRequestPortalScopingEnabled } from '../utils/identityFlag'
import { normalizePortalId } from '../utils/scopeToPortal'

const router = express.Router()

// FF-EPIC-11-S3 — rate-limit both new public routes (CodeQL
// js/missing-rate-limiting). Same config as adminPortals.ts's
// adminRateLimiter / routes/organizations.ts's invitationsRateLimiter.
const invitationsRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again shortly.' },
})

/**
 * Mask an email address for safe public exposure.
 * Only the first character before '@' is preserved; the rest is replaced with '***'.
 * Example: 'user@example.com' -> 'u***@example.com'
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@')
  if (atIndex <= 0) return '***'
  return email[0] + '***' + email.slice(atIndex)
}

interface OptionalUser {
  id: string
  email: string
  portalId?: string
  homePortalId: string | null
}

/**
 * Resolves the CALLER'S OWN user row from an OPTIONAL bearer token — unlike
 * `middleware/auth.ts`'s `authenticateToken`, a missing/invalid token here is
 * NOT a 401; it leaves `req.user` undefined so the accept route can fall back
 * to the pre-epic "enroll" response. Deliberately does not perform
 * `authenticateToken`'s Host-vs-claimed-portal cross-check (that requires
 * `resolvePortalContext` to have run upstream, which this public router does
 * not require) — the JWT's own `portalId` claim is already
 * cryptographically verified by `jwt.verify` below, which is sufficient for
 * this route's AC4 same-portal-context check (it compares the token's OWN
 * claim against the invitation's bound portal, not against the request Host).
 */
async function resolveOptionalUser(req: { headers: Record<string, any> }): Promise<OptionalUser | undefined> {
  const authHeader = req.headers['authorization']
  const token = typeof authHeader === 'string' ? authHeader.split(' ')[1] : undefined
  if (!token) return undefined

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string
      portalId?: string
    }
    const userRow = await db('users')
      .select('id', 'email', 'home_portal_id')
      .where('id', decoded.userId)
      .first()
    if (!userRow) return undefined

    return {
      id: userRow.id,
      email: userRow.email,
      portalId: decoded.portalId,
      homePortalId: userRow.home_portal_id ?? null,
    }
  } catch {
    // Invalid/expired token -> treat as unauthenticated (enroll path), never
    // a 401 here — matches the pre-epic "auth optional" contract.
    return undefined
  }
}

/**
 * @swagger
 * /api/invitations/{token}:
 *   get:
 *     summary: Resolve an invitation by its token (public, no auth required)
 *     tags: [Invitations]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Invitation + organization summary (email masked)
 *       404:
 *         description: Invitation not found
 *       410:
 *         description: Invitation expired or revoked
 */
router.get('/:token', invitationsRateLimiter, async (req, res) => {
  try {
    const { token } = req.params

    const invitation = await db('organization_invitations').where('token', token).first()
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' })
    }
    if (invitation.status !== 'pending' || new Date(invitation.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This invitation has expired or been revoked' })
    }

    const organization = await db('organizations').where('id', invitation.organization_id).first()

    res.json({
      invitation: {
        id: invitation.id,
        email: maskEmail(invitation.email),
        role: invitation.role,
        expires_at: invitation.expires_at,
        status: invitation.status,
      },
      organization: {
        id: organization?.id,
        name: organization?.name,
        slug: organization?.slug,
      },
    })
  } catch (error: any) {
    console.error('Error resolving invitation:', error)
    res.status(500).json({ error: 'Failed to resolve invitation' })
  }
})

/**
 * @swagger
 * /api/invitations/{token}/accept:
 *   post:
 *     summary: Accept an invitation (portal-aware — see FF-EPIC-11-S3)
 *     description: >-
 *       Auth optional: an unauthenticated caller receives a 202 enroll
 *       redirect. When the `fuzefront.identity.portal-scoped-users` flag is
 *       ON, an invitation accepted from a DIFFERENT portal context than it
 *       was issued for is rejected fail-closed (AC4) and an email already
 *       homed to a different portal than the invitation is rejected (AC2,
 *       defense-in-depth against the same check at invite-creation time).
 *     tags: [Invitations]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Invitation accepted, membership granted
 *       202:
 *         description: Caller is unauthenticated — redirect to enroll
 *       403:
 *         description: Email mismatch, or (portal-scoped) accepted from the wrong portal context (PORTAL_CONTEXT_MISMATCH)
 *       404:
 *         description: Invitation not found
 *       409:
 *         description: Already accepted (race), or (portal-scoped) EMAIL_IN_OTHER_PORTAL
 *       410:
 *         description: Invitation expired or revoked
 */
router.post('/:token/accept', invitationsRateLimiter, async (req: any, res) => {
  try {
    const { token } = req.params

    const invitation = await db('organization_invitations').where('token', token).first()
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' })
    }

    const user = await resolveOptionalUser(req)

    // Not authenticated: direct to enroll (unchanged regardless of the flag).
    if (!user) {
      const enrollUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/enroll`
      return res.status(202).json({
        action: 'enroll',
        enrollUrl,
        message: 'Please create an account or sign in to accept this invitation',
      })
    }
    req.user = user

    // Email mismatch (unchanged regardless of the flag).
    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return res.status(403).json({
        error: 'This invitation was sent to a different email address',
      })
    }

    // FF-EPIC-11-S3 AC4 — fail-closed if the ACCEPTING session's portal
    // context differs from the portal the invitation was ISSUED for.
    // FF-EPIC-11-S3 AC2 — defense-in-depth: reject if the account's own home
    // portal already differs from the invitation's portal (should already be
    // impossible post-create-time-rejection, but the account's home portal
    // could theoretically have changed between invite and accept).
    // Both gated by the SAME identity flag as invite-creation (S2's flag) —
    // flag OFF is BYTE-IDENTICAL pre-epic behavior (neither check runs).
    const portalScopingEnabled = await getRequestPortalScopingEnabled(req)
    if (portalScopingEnabled) {
      const invitationPortalId = invitation.portal_id ?? null // already normalized at creation
      const sessionPortalId = normalizePortalId(user.portalId)
      if (sessionPortalId !== invitationPortalId) {
        return res.status(403).json({
          error: 'PORTAL_CONTEXT_MISMATCH',
          message: 'This invitation was issued for a different portal context.',
        })
      }

      const accountHomePortalId = normalizePortalId(user.homePortalId)
      if (accountHomePortalId !== null && accountHomePortalId !== invitationPortalId) {
        return res.status(409).json({
          error: 'EMAIL_IN_OTHER_PORTAL',
          message: 'This account is already homed to a different portal.',
        })
      }
    }

    // Revoked or expired (check before CAS so we give an informative 410, not a 409)
    if (invitation.status === 'revoked' || new Date(invitation.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This invitation has expired or been revoked' })
    }

    // Atomic compare-and-swap accept: transition status pending->accepted inside
    // the transaction. If another request raced us, rowCount will be 0 -> 409.
    let casSucceeded = false
    await db.transaction(async (trx: any) => {
      const result = await trx.raw(
        `UPDATE organization_invitations SET status='accepted' WHERE id=? AND status='pending' RETURNING *`,
        [invitation.id]
      )
      const rowCount = result.rowCount ?? (result.rows ? result.rows.length : 0)
      if (rowCount === 0) {
        // Another request already accepted this invitation (race condition).
        return
      }
      casSucceeded = true

      // Upsert membership (user may already be a member)
      const existingMembership = await trx('organization_memberships')
        .where('user_id', user.id)
        .where('organization_id', invitation.organization_id)
        .first()

      if (!existingMembership) {
        await trx('organization_memberships').insert({
          id: uuidv4(),
          user_id: user.id,
          organization_id: invitation.organization_id,
          role: invitation.role,
          status: 'active',
          joined_at: new Date(),
          permissions: JSON.stringify({}),
          metadata: JSON.stringify({}),
        })
      }

      // FF-EPIC-11-S3 AC1 — a brand-new account (no home portal yet) accepting
      // a portal-scoped invitation is homed to the INVITING portal. `whereNull`
      // makes this a no-op for an account that already has a home (AC3 — the
      // existing account is attached as-is, never re-homed / duplicated).
      if (portalScopingEnabled && invitation.portal_id) {
        await trx('users')
          .where('id', user.id)
          .whereNull('home_portal_id')
          .update({ home_portal_id: invitation.portal_id })
      }
    })

    if (!casSucceeded) {
      return res.status(409).json({ error: 'Invitation has already been accepted' })
    }

    // Assign Permit role for the accepted member — non-blocking: a Permit outage
    // must not undo an accepted invitation. The role can be reconciled later.
    try {
      await assignOrganizationRole(
        user.id,
        invitation.organization_id,
        invitation.role as 'owner' | 'admin' | 'member' | 'viewer'
      )
    } catch (permitErr) {
      // Constant format string + %s args (Semgrep unsafe-formatstring): a
      // non-literal template as the format string lets an injected specifier
      // forge log output.
      console.error(
        'Permit role assignment failed for user %s in org %s (non-fatal):',
        user.id,
        invitation.organization_id,
        permitErr
      )
    }

    res.json({
      message: 'Invitation accepted successfully',
      organizationId: invitation.organization_id,
      role: invitation.role,
    })
  } catch (error: any) {
    console.error('Error accepting invitation:', error)
    res.status(500).json({ error: 'Failed to accept invitation' })
  }
})

export default router
