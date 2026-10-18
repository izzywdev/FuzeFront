/**
 * FFRNT-307 / FFRNT-304 — Org invitations v2 handlers for
 * `/api/organizations/:id/invitations*` and `POST /api/organizations/:id/members`.
 *
 * These are mounted from `routes/organizations.ts` BEHIND the
 * `fuzefront.identity.invite-v2` flag (default OFF): each legacy handler asks
 * `isInviteV2Enabled(...)` first and delegates here when ON, so flag-OFF
 * behavior is byte-identical to before. Shapes follow the frozen contract
 * (`packages/security/openapi.yaml` 0.10.2): `InviteeRef` + `memberType`, the
 * `Invitation` response (no `{ invitation }` wrapper), cursor-paginated list
 * (`{ items, page }`), `204` revoke.
 *
 * All real authorization lives in `services/invitationsV2.ts` (membership /
 * ownership); the flag decides only WHICH implementation serves the request.
 */
import { Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../config/database'
import { withReqId } from '../lib/logger'
import { isPrefixedIdsEnabled } from '../identity/flags'
import { defaultEventPublisher } from '../services/eventPublisher'
import {
  InviteError,
  authorizeInviter,
  authorizeOrgAdmin,
  createInvitation,
  emitInvitationCreated,
  INVITE_TTL_MS,
  listInvitations,
  parseBulkBody,
  parseCreateBody,
  parseListLimit,
  refToUuid,
  toInvitationDto,
  wireIds,
  type InviterContext,
  type ParsedCreate,
  type InvitationStatus,
} from '../services/invitationsV2'

const STATUSES: InvitationStatus[] = ['pending', 'accepted', 'revoked', 'expired']

function log(req: Request) {
  return withReqId((req as any).requestId, req as any)
}

function sendError(req: Request, res: Response, err: unknown, fallback: string) {
  if (err instanceof InviteError) {
    return res.status(err.status).json({ error: err.message, code: err.code })
  }
  log(req).error({ err }, fallback)
  return res.status(500).json({ error: fallback, code: 'INTERNAL_ERROR' })
}

/** Path ids are wire-validated (assertRef) and stored as uuid. Malformed -> 404. */
function pathUuid(type: 'organization' | 'invitation', raw: unknown): string {
  try {
    return refToUuid(type, raw)
  } catch {
    throw new InviteError(404, 'NOT_FOUND', `${type} not found`)
  }
}

async function wireFor(req: any, orgId: string) {
  return wireIds(await isPrefixedIdsEnabled({ orgId, userId: req.user?.id }))
}

/** Best-effort email dispatch (an email outage never un-creates the invite). */
async function dispatchInviteEmail(
  req: Request,
  ctx: InviterContext,
  row: { email: string | null; role: string; member_type: string },
  token: string
): Promise<void> {
  if (!row.email) return
  try {
    const inviter = await db('users').where('id', ctx.userId).first()
    const inviterName = inviter
      ? `${inviter.first_name || ''} ${inviter.last_name || ''}`.trim() || inviter.email
      : (req as any).user?.email
    const acceptUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/invitations/${token}`
    const correlationId = uuidv4()
    await defaultEventPublisher.publishNotifyEmailRequested(
      {
        to: row.email,
        template: 'org-invite',
        vars: { orgName: ctx.org.name ?? '', inviterName, role: row.role, acceptUrl },
        orgId: ctx.org.id,
        correlationId,
      },
      correlationId
    )
  } catch (err) {
    log(req).error({ err, organizationId: ctx.org.id }, 'invite email dispatch failed (non-fatal)')
  }
}

// GET /api/organizations/:id/invitations
export async function listHandler(req: any, res: Response) {
  try {
    const orgId = pathUuid('organization', req.params.id)
    await authorizeOrgAdmin(req.user.id, orgId)
    const limit = parseListLimit(req.query.limit)
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : undefined
    let status: InvitationStatus | undefined
    if (req.query.status !== undefined) {
      if (!STATUSES.includes(req.query.status)) {
        throw new InviteError(400, 'BAD_REQUEST', `status must be one of ${STATUSES.join(', ')}`)
      }
      status = req.query.status
    }
    const page = await listInvitations(orgId, { limit, cursor, status })
    const wire = await wireFor(req, orgId)
    res.json({
      items: page.rows.map(r => toInvitationDto(r, wire)),
      page: { nextCursor: page.nextCursor, hasMore: page.hasMore },
    })
  } catch (err) {
    sendError(req, res, err, 'Failed to list invitations')
  }
}

function conflictBody(reason: string | undefined) {
  return reason === 'already-member'
    ? { error: 'That person is already a member of this organization', code: 'CONFLICT', reason }
    : { error: 'A pending invitation already exists for this invitee', code: 'CONFLICT', reason }
}

async function createOne(req: any, res: Response, parsed: ParsedCreate, orgId: string) {
  const ctx = await authorizeInviter(req.user.id, orgId, parsed.memberType, parsed.role)
  const outcome = await createInvitation(ctx, parsed, parsed.invitees[0])
  if (outcome.status === 'skipped') {
    return res.status(409).json(conflictBody(outcome.reason))
  }
  await dispatchInviteEmail(req, ctx, outcome.row, outcome.token!)
  const wire = await wireFor(req, orgId)
  return res.status(201).json(toInvitationDto(outcome.row, wire))
}

// POST /api/organizations/:id/invitations
export async function createHandler(req: any, res: Response) {
  try {
    const orgId = pathUuid('organization', req.params.id)
    const parsed = parseCreateBody(req.body)
    await createOne(req, res, parsed, orgId)
  } catch (err) {
    sendError(req, res, err, 'Failed to create invitation')
  }
}

// POST /api/organizations/:id/members  (legacy path, v2 behavior)
// Accepts the contract body, or the legacy `{ email, role }` (adapted to an
// external email invitee, memberType defaulting to `employee`).
export async function addMemberHandler(req: any, res: Response) {
  try {
    const orgId = pathUuid('organization', req.params.id)
    const body = req.body ?? {}
    const adapted =
      body && typeof body === 'object' && typeof body.email === 'string' && body.invitee === undefined
        ? {
            invitee: { kind: 'external', channel: 'email', email: body.email },
            role: body.role,
            memberType: body.memberType ?? 'employee',
          }
        : body
    const parsed = parseCreateBody(adapted)
    await createOne(req, res, parsed, orgId)
  } catch (err) {
    sendError(req, res, err, 'Failed to create invitation')
  }
}

// POST /api/organizations/:id/invitations/bulk
export async function bulkHandler(req: any, res: Response) {
  try {
    const orgId = pathUuid('organization', req.params.id)
    const parsed = parseBulkBody(req.body)
    const ctx = await authorizeInviter(req.user.id, orgId, parsed.memberType, parsed.role)
    const wire = await wireFor(req, orgId)

    const results: any[] = []
    let created = 0
    let skipped = 0
    let failed = 0
    for (const invitee of parsed.invitees) {
      const echo =
        invitee.kind === 'account' ? { kind: 'account', userId: wire('user', invitee.userId) } : invitee
      try {
        const outcome = await createInvitation(ctx, parsed, invitee)
        if (outcome.status === 'skipped') {
          skipped++
          results.push({ invitee: echo, status: 'skipped', reason: outcome.reason })
          continue
        }
        created++
        results.push({ invitee: echo, status: 'created', invitationId: wire('invitation', outcome.row.id) })
        await dispatchInviteEmail(req, ctx, outcome.row, outcome.token!)
      } catch (err) {
        failed++
        const reason = err instanceof InviteError ? err.code.toLowerCase() : 'internal-error'
        if (!(err instanceof InviteError)) log(req).error({ err }, 'bulk invite item failed')
        results.push({ invitee: echo, status: 'failed', reason })
      }
    }
    res.json({ created, skipped, failed, results })
  } catch (err) {
    sendError(req, res, err, 'Failed to process bulk invitations')
  }
}

async function loadInvitation(orgId: string, invitationRaw: unknown) {
  const invitationId = pathUuid('invitation', invitationRaw)
  const inv = await db('organization_invitations')
    .where('id', invitationId)
    .where('organization_id', orgId)
    .first()
  if (!inv) throw new InviteError(404, 'NOT_FOUND', 'Invitation not found')
  return inv
}

// POST /api/organizations/:id/invitations/:invitationId/resend
export async function resendHandler(req: any, res: Response) {
  try {
    const orgId = pathUuid('organization', req.params.id)
    const ctx = await authorizeOrgAdmin(req.user.id, orgId)
    const inv = await loadInvitation(orgId, req.params.invitationId)
    if (inv.status !== 'pending') {
      throw new InviteError(409, 'CONFLICT', `Cannot resend a ${inv.status} invitation`)
    }
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
    const next = { ...inv, expires_at: expiresAt }
    await db.transaction(async (trx: any) => {
      await trx('organization_invitations').where('id', inv.id).update({ expires_at: expiresAt })
      // WhatsApp has no direct dispatch here (telephony is sms-service): re-emit
      // the created event so the notification worker re-sends over the channel.
      if (inv.channel === 'whatsapp') await emitInvitationCreated(trx, next)
    })
    if (inv.channel === 'email') await dispatchInviteEmail(req, ctx, inv, inv.token)
    res.json(toInvitationDto(next, await wireFor(req, orgId)))
  } catch (err) {
    sendError(req, res, err, 'Failed to resend invitation')
  }
}

// DELETE /api/organizations/:id/invitations/:invitationId
export async function revokeHandler(req: any, res: Response) {
  try {
    const orgId = pathUuid('organization', req.params.id)
    await authorizeOrgAdmin(req.user.id, orgId)
    const inv = await loadInvitation(orgId, req.params.invitationId)
    if (inv.status === 'accepted') {
      // An accepted invitation has already produced a membership; revoking the
      // invite would not remove access, so say so instead of lying with a 204.
      throw new InviteError(409, 'CONFLICT', 'Invitation was already accepted')
    }
    if (inv.status === 'pending') {
      // CAS on status so a concurrent accept is never silently overwritten.
      const updated = await db('organization_invitations')
        .where('id', inv.id)
        .where('status', 'pending')
        .update({ status: 'revoked', bind_token: null, bind_token_expires_at: null })
      if (updated === 0) {
        const now = await db('organization_invitations').where('id', inv.id).first()
        if (now?.status === 'accepted') {
          throw new InviteError(409, 'CONFLICT', 'Invitation was already accepted')
        }
      }
    }
    res.status(204).end()
  } catch (err) {
    sendError(req, res, err, 'Failed to revoke invitation')
  }
}
