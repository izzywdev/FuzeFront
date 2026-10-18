/**
 * Public token-based invitation routes.
 * GET  /api/invitations/:token         — resolve (no auth required)
 * POST /api/invitations/:token/accept  — accept (auth optional)
 */
import { currentTenant } from '../providers/authentik/tenants'
import express from 'express'
import { mintId, toUuid } from '@izzywdev/fuzefront-identity'
import { db } from '../config/database'
import { assignOrganizationRole } from '../utils/permit/role-assignment'
import { isPrefixedIdsEnabled } from '../identity/flags'
import { prefixDtoIds } from '../identity/serializer'
import { withReqId } from '../lib/logger'
import { authenticateToken } from '../middleware/auth'
import { isInviteV2Enabled } from '../utils/inviteV2Flag'
import {
  bindInvitation,
  checkIdentityMatch,
  issueBindToken,
  maskEmail as maskEmailV2,
  maskPhone,
  wireIds,
} from '../services/invitationsV2'

const router = express.Router()

/**
 * Mask an email address for safe public exposure.
 * Only the first character before '@' is preserved; the rest is replaced with '***'.
 * Example: 'user@example.com' → 'u***@example.com'
 */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@')
  if (atIndex <= 0) return '***'
  return email[0] + '***' + email.slice(atIndex)
}


/**
 * FFRNT-307 - optional authentication for POST /:token/accept, v2 ONLY.
 *
 * Historically nothing populated `req.user` on this router, so every accept fell
 * into the unauthenticated `202` branch and the post-signup bind never ran. With
 * `fuzefront.identity.invite-v2` ON, a request that PRESENTS a bearer token is
 * authenticated (an invalid/revoked token is a hard 401, never silently
 * downgraded to anonymous); a request with none stays anonymous (-> 202 + bindToken).
 * Flag OFF: untouched (legacy behavior is byte-identical).
 */
async function optionalAuthForAcceptV2(req: any, res: any, next: any) {
  try {
    if (!req.headers['authorization']) return next()
    const inv = await db('organization_invitations').where('token', req.params.token).first()
    if (!inv) return next() // handler answers 404
    req.invitationRow = inv
    if (!(await isInviteV2Enabled({ organizationId: inv.organization_id }))) return next()
    return authenticateToken(req, res, next)
  } catch (error: any) {
    withReqId(req.requestId, req).error({ err: error }, 'optional auth for invitation accept failed')
    return res.status(500).json({ error: 'Failed to accept invitation' })
  }
}

const effectiveInvitationState = (inv: any): 'pending' | 'accepted' | 'gone' =>
  inv.status === 'accepted'
    ? 'accepted'
    : inv.status !== 'pending' || new Date(inv.expires_at).getTime() < Date.now()
      ? 'gone'
      : 'pending'

// v2: public masked resolve (contract `InvitationResolveResult`).
async function resolveV2(req: any, res: any, invitation: any) {
  if (invitation.status !== 'pending' || new Date(invitation.expires_at) < new Date()) {
    return res.status(410).json({ error: 'This invitation has expired or been revoked', code: 'GONE' })
  }
  const organization = await db('organizations').where('id', invitation.organization_id).first()
  const wire = wireIds(await isPrefixedIdsEnabled({ orgId: invitation.organization_id }))
  return res.json({
    invitation: {
      id: wire('invitation', invitation.id),
      maskedContact:
        invitation.channel === 'whatsapp' ? maskPhone(invitation.phone ?? '') : maskEmailV2(invitation.email ?? ''),
      channel: invitation.channel,
      role: invitation.role,
      memberType: invitation.member_type,
      status: invitation.status,
      expiresAt: new Date(invitation.expires_at).toISOString(),
    },
    organization: {
      id: wire('organization', organization?.id),
      name: organization?.name,
      slug: organization?.slug,
    },
  })
}

// v2: accept (contract `acceptInvitation`).
async function acceptV2(req: any, res: any, invitation: any) {
  const rlog = withReqId(req.requestId, req)
  const state = effectiveInvitationState(invitation)
  if (state === 'accepted') {
    return res.status(409).json({ error: 'Invitation has already been accepted', code: 'CONFLICT' })
  }
  if (state === 'gone') {
    return res.status(410).json({ error: 'This invitation has expired or been revoked', code: 'GONE' })
  }

  // Anonymous / no account yet: hand back the single-use bindToken that carries
  // this invite THROUGH signup (SignupRequest.bindToken). Only its digest is stored.
  if (!req.user) {
    const bindToken = await issueBindToken(invitation)
    const enrollUrl = `${currentTenant('invitation enrollment URL').issuerUrl}/if/flow/enrollment/`
    rlog.info({ invitationId: invitation.id, channel: invitation.channel }, 'invitation accept: enroll (bindToken issued)')
    return res.status(202).json({
      action: 'enroll',
      enrollUrl,
      bindToken,
      message: 'Please create an account or sign in to accept this invitation',
    })
  }

  // Authenticated: the accepting identity must BE the invited identity. The
  // token (a lookup key) is never sufficient on its own.
  const match = await checkIdentityMatch(invitation, req.user.id, { requireVerifiedEmail: true })
  if (!match.ok) {
    rlog.warn({ invitationId: invitation.id, userId: req.user.id }, 'invitation accept: identity mismatch (fail-closed)')
    return res.status(403).json({ error: match.message, code: 'IDENTITY_MISMATCH' })
  }

  const result = await bindInvitation(invitation, req.user.id)
  if (result.outcome === 'conflict') {
    return res.status(409).json({ error: 'Invitation has already been accepted', code: 'CONFLICT' })
  }
  if (result.outcome === 'expired') {
    return res.status(410).json({ error: 'This invitation has expired or been revoked', code: 'GONE' })
  }
  if (result.outcome === 'forbidden') {
    rlog.warn({ invitationId: invitation.id, userId: req.user.id, code: result.code }, 'invitation accept: forbidden')
    return res.status(403).json({ error: result.message, code: result.code })
  }

  // Permit role assignment is non-blocking: an outage must not undo the accept.
  try {
    await assignOrganizationRole(
      req.user.id,
      invitation.organization_id,
      invitation.role as 'owner' | 'admin' | 'member' | 'viewer' | 'developer'
    )
  } catch (permitErr) {
    rlog.error(
      { err: permitErr, userId: req.user.id, organizationId: invitation.organization_id },
      'permit role assignment failed after invitation accept (non-fatal)'
    )
  }

  const wire = wireIds(await isPrefixedIdsEnabled({ userId: req.user.id, orgId: invitation.organization_id }))
  return res.json({
    action: 'bound',
    organizationId: wire('organization', result.organizationId),
    userId: wire('user', result.userId),
    role: result.role,
    memberType: result.memberType,
  })
}

// GET /api/invitations/:token — public, no auth
router.get('/:token', async (req: any, res) => {
  try {
    const { token } = req.params

    const invitation = await db('organization_invitations')
      .where('token', token)
      .first()

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' })
    }

    // FFRNT-307: contract-shaped masked resolve behind the release flag (default OFF).
    if (await isInviteV2Enabled({ organizationId: invitation.organization_id })) {
      return resolveV2(req, res, invitation)
    }

    // Expired by status or by time
    if (invitation.status !== 'pending' || new Date(invitation.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This invitation has expired or been revoked' })
    }

    const organization = await db('organizations')
      .where('id', invitation.organization_id)
      .first()

    const prefixed = await isPrefixedIdsEnabled({})
    const invDto = prefixDtoIds(
      { id: invitation.id, email: maskEmail(invitation.email), role: invitation.role, expires_at: invitation.expires_at, status: invitation.status },
      prefixed,
      { id: 'invitation' }
    )
    const orgDto = prefixDtoIds(
      { id: organization?.id, name: organization?.name, slug: organization?.slug },
      prefixed,
      { id: 'organization' }
    )
    res.json({ invitation: invDto, organization: orgDto })
  } catch (error: any) {
    withReqId((req as any).requestId, req).error(
      { err: error },
      'failed to resolve invitation'
    )
    res.status(500).json({ error: 'Failed to resolve invitation' })
  }
})

// POST /api/invitations/:token/accept — accept (auth optional via req.user)
router.post('/:token/accept', optionalAuthForAcceptV2, async (req: any, res) => {
  try {
    const { token } = req.params

    const invitation =
      req.invitationRow ??
      (await db('organization_invitations')
        .where('token', token)
        .first())

    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' })
    }

    // FFRNT-307: Org invitations v2 (bindToken signup flow) behind the release flag, default OFF.
    if (await isInviteV2Enabled({ userId: req.user?.id, organizationId: invitation.organization_id })) {
      return acceptV2(req, res, invitation)
    }

    // Not authenticated: direct to enroll
    if (!req.user) {
      const enrollUrl = `${currentTenant('invitation enrollment URL').issuerUrl}/if/flow/enrollment/`
      return res.status(202).json({
        action: 'enroll',
        enrollUrl,
        message: 'Please create an account or sign in to accept this invitation',
      })
    }

    // Email mismatch
    if (req.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return res.status(403).json({
        error: 'This invitation was sent to a different email address',
      })
    }

    // Revoked or expired (check before CAS so we give an informative 410, not a 409)
    if (invitation.status === 'revoked' || new Date(invitation.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This invitation has expired or been revoked' })
    }

    // Atomic compare-and-swap accept: transition status pending→accepted inside
    // the transaction. If another request raced us, rowCount will be 0 → 409.
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
        .where('user_id', req.user.id)
        .where('organization_id', invitation.organization_id)
        .first()

      if (!existingMembership) {
        await trx('organization_memberships').insert({
          id: toUuid(mintId('membership')),
          user_id: req.user.id,
          organization_id: invitation.organization_id,
          role: invitation.role,
          status: 'active',
          joined_at: new Date(),
          permissions: JSON.stringify({}),
          metadata: JSON.stringify({}),
        })
      }
    })

    if (!casSucceeded) {
      return res.status(409).json({ error: 'Invitation has already been accepted' })
    }

    // Assign Permit role for the accepted member — non-blocking: a Permit outage
    // must not undo an accepted invitation. The role can be reconciled later.
    try {
      await assignOrganizationRole(
        req.user.id,
        invitation.organization_id,
        invitation.role as 'owner' | 'admin' | 'member' | 'viewer' | 'developer'
      )
    } catch (permitErr) {
      withReqId((req as any).requestId, req).error(
        {
          err: permitErr,
          userId: req.user.id,
          organizationId: invitation.organization_id,
        },
        'permit role assignment failed after invitation accept (non-fatal)'
      )
    }

    const flagCtxAccept = { userId: req.user?.id, orgId: invitation.organization_id }
    const prefixedAccept = await isPrefixedIdsEnabled(flagCtxAccept)
    res.json(prefixDtoIds(
      { message: 'Invitation accepted successfully', organizationId: invitation.organization_id, role: invitation.role },
      prefixedAccept,
      { organizationId: 'organization' }
    ))
  } catch (error: any) {
    withReqId((req as any).requestId, req).error(
      { err: error },
      'failed to accept invitation'
    )
    res.status(500).json({ error: 'Failed to accept invitation' })
  }
})

export default router


