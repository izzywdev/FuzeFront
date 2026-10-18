/**
 * FFRNT-307 / FFRNT-304 — Org invitations v2: domain logic (security-service).
 *
 * Implements the frozen contract (`packages/security/openapi.yaml` 0.10.2,
 * `@fuzefront/security-client`) behind the `fuzefront.identity.invite-v2` flag.
 * Route handlers (`routes/organizations.ts`, `routes/invitations.ts`,
 * `routes/security.ts` POST /signup) stay thin and delegate here.
 *
 * Invariants this module owns:
 *  - the service MINTS every invitation id and every bind token; a create body
 *    never carries one (identifier-standard 1) and unknown keys are rejected
 *    (`additionalProperties: false`),
 *  - every incoming user reference is `assertRef('user', …)`-validated and every
 *    polymorphic invitee is a `kind`-discriminated `InviteeRef` (standard 2),
 *  - an id / a token is NEVER a capability: invite authority comes from the
 *    caller's membership (org owner/admin; root-org OWNER for `customer`), accept
 *    authority from the accepting identity matching the invited identity,
 *  - `owner` can never be invited (ownership is transferred, not invited),
 *  - accept is an atomic compare-and-swap (pending→accepted) and NEVER rewrites
 *    an existing membership — so a last owner can not be demoted by an invite
 *    (FFRNT-300),
 *  - customers are homed to exactly one portal tree (no cross-portal attach,
 *    FFRNT-21 / FFRNT-73),
 *  - events go through the transactional outbox, in the same transaction as the
 *    state change.
 */
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { assertRef, mintId, toUuid, fromUuid } from '@izzywdev/fuzefront-identity'
import { enqueueEvent } from '@fuzefront/core'
import {
  TOPICS,
  identityInvitationCreatedSchemaV1,
  identityInvitationAcceptedSchemaV1,
} from '@fuzefront/shared/kafka'
import { db } from '../config/database'
import { ROOT_ORG_ID } from '../migrations/014_seed_root_platform_organization'
import { emitMembershipAdded } from '../events/membershipEvents'
import { logger } from '../lib/logger'

// ─── constants ───────────────────────────────────────────────────────────────

export const ALLOWED_INVITE_ROLES = ['admin', 'member', 'viewer'] as const
export type InviteRole = (typeof ALLOWED_INVITE_ROLES)[number]
export const MEMBER_TYPES = ['employee', 'customer'] as const
export type MemberType = (typeof MEMBER_TYPES)[number]
export const INVITE_CHANNELS = ['email', 'whatsapp'] as const
export type InviteChannel = (typeof INVITE_CHANNELS)[number]
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** A bind token only needs to survive one signup round-trip. */
export const BIND_TOKEN_TTL_MS = 30 * 60 * 1000
export const BULK_MAX = 50
export const LIST_DEFAULT_LIMIT = 50
export const LIST_MAX_LIMIT = 200

const E164 = /^\+[1-9]\d{1,14}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A request-level problem with a stable HTTP status + machine code. */
export class InviteError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'InviteError'
  }
}

const bad = (message: string) => new InviteError(400, 'BAD_REQUEST', message)

// ─── input parsing / validation ──────────────────────────────────────────────

/** Storage-shaped (uuid) invitee as parsed from the wire `InviteeRef`. */
export type ParsedInvitee =
  | { kind: 'account'; userId: string }
  | { kind: 'external'; channel: 'email'; email: string }
  | { kind: 'external'; channel: 'whatsapp'; phone: string }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function assertOnlyKeys(obj: Record<string, unknown>, allowed: string[], where: string) {
  const extra = Object.keys(obj).filter(k => !allowed.includes(k))
  if (extra.length > 0) {
    // additionalProperties:false — notably rejects a client-chosen `id`/`token`.
    throw bad(`${where}: unknown field(s): ${extra.join(', ')}`)
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function parseInvitee(raw: unknown): ParsedInvitee {
  if (!isPlainObject(raw)) throw bad('invitee must be an object')
  if (raw.kind === 'account') {
    assertOnlyKeys(raw, ['kind', 'userId'], 'invitee')
    let userId: string
    try {
      userId = toUuid(assertRef('user', raw.userId))
    } catch {
      throw bad('invitee.userId must be a valid user id')
    }
    return { kind: 'account', userId }
  }
  if (raw.kind === 'external') {
    assertOnlyKeys(raw, ['kind', 'channel', 'email', 'phone'], 'invitee')
    if (raw.channel === 'email') {
      if (typeof raw.email !== 'string' || !EMAIL.test(raw.email.trim())) {
        throw bad('invitee.email must be a valid email address when channel is "email"')
      }
      return { kind: 'external', channel: 'email', email: normalizeEmail(raw.email) }
    }
    if (raw.channel === 'whatsapp') {
      if (typeof raw.phone !== 'string' || !E164.test(raw.phone.trim())) {
        throw bad('invitee.phone must be an E.164 number when channel is "whatsapp"')
      }
      return { kind: 'external', channel: 'whatsapp', phone: raw.phone.trim() }
    }
    throw bad('invitee.channel must be "email" or "whatsapp"')
  }
  throw bad('invitee.kind must be "account" or "external"')
}

export interface ParsedCreate {
  role: InviteRole
  memberType: MemberType
  invitees: ParsedInvitee[]
}

function parseRoleAndType(body: Record<string, unknown>): { role: InviteRole; memberType: MemberType } {
  const role = body.role === undefined ? 'member' : body.role
  // Owner can never be invited; the allow-list is the only gate.
  if (typeof role !== 'string' || !(ALLOWED_INVITE_ROLES as readonly string[]).includes(role)) {
    throw bad(`Invalid role. Allowed values: ${ALLOWED_INVITE_ROLES.join(', ')}`)
  }
  const memberType = body.memberType
  if (typeof memberType !== 'string' || !(MEMBER_TYPES as readonly string[]).includes(memberType)) {
    throw bad(`memberType is required. Allowed values: ${MEMBER_TYPES.join(', ')}`)
  }
  return { role: role as InviteRole, memberType: memberType as MemberType }
}

/** `InvitationCreate` (single). */
export function parseCreateBody(body: unknown): ParsedCreate {
  if (!isPlainObject(body)) throw bad('request body must be a JSON object')
  assertOnlyKeys(body, ['invitee', 'role', 'memberType'], 'body')
  const { role, memberType } = parseRoleAndType(body)
  return { role, memberType, invitees: [parseInvitee(body.invitee)] }
}

/** `BulkInvitationCreate` — 1..50 invitees sharing one role + memberType. */
export function parseBulkBody(body: unknown): ParsedCreate {
  if (!isPlainObject(body)) throw bad('request body must be a JSON object')
  assertOnlyKeys(body, ['invitees', 'role', 'memberType'], 'body')
  const { role, memberType } = parseRoleAndType(body)
  if (!Array.isArray(body.invitees) || body.invitees.length < 1) {
    throw bad('invitees must be a non-empty array')
  }
  if (body.invitees.length > BULK_MAX) {
    throw bad(`Cannot exceed ${BULK_MAX} invitees in a single bulk invite`)
  }
  return { role, memberType, invitees: body.invitees.map(parseInvitee) }
}

// ─── cursor pagination (list) ────────────────────────────────────────────────

export function parseListLimit(raw: unknown): number {
  if (raw === undefined || raw === '') return LIST_DEFAULT_LIMIT
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) throw bad('limit must be a positive integer')
  return Math.min(n, LIST_MAX_LIMIT) // clamp over-max server-side
}

interface CursorKey {
  c: string // created_at (ISO)
  i: string // id (uuid) — tiebreaker
}

export function encodeCursor(createdAt: Date | string, id: string): string {
  const c = (createdAt instanceof Date ? createdAt : new Date(createdAt)).toISOString()
  return Buffer.from(JSON.stringify({ c, i: id } satisfies CursorKey)).toString('base64url')
}

export function decodeCursor(cursor: string): CursorKey {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (
      !isPlainObject(parsed) ||
      typeof parsed.c !== 'string' ||
      Number.isNaN(Date.parse(parsed.c)) ||
      typeof parsed.i !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(parsed.i)
    ) {
      throw new Error('shape')
    }
    return { c: parsed.c, i: parsed.i }
  } catch {
    throw bad('cursor is invalid')
  }
}

// ─── masking (public resolve) ────────────────────────────────────────────────

/** `u***@example.com` — first char + domain only. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '***'
  return email[0] + '***' + email.slice(at)
}

/** `+1 *** *** 2671` — country lead + last 4 only. */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return '***'
  return `${phone.slice(0, 2)} *** *** ${phone.slice(-4)}`
}

// ─── bind token ──────────────────────────────────────────────────────────────

export function hashBindToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Server-minted, single-use carrier; only its SHA-256 digest is stored. */
export function mintBindToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, hash: hashBindToken(token) }
}

// ─── authorization ───────────────────────────────────────────────────────────

export interface InviterContext {
  userId: string
  org: { id: string; name?: string; owner_id?: string | null; parent_id?: string | null }
  isOwner: boolean
}

/**
 * Real authz (never "knew the id"): the caller must be an ACTIVE owner/admin of
 * the target org. Root-org `customer` invites are narrower still — only the OWNER
 * of ROOT_ORG_ID may invite external customers into the platform root, and a
 * customer is never granted `admin` on the root org.
 */
export async function authorizeInviter(
  userId: string,
  orgId: string,
  memberType: MemberType | null,
  role: InviteRole | null
): Promise<InviterContext> {
  const membership = await db('organization_memberships')
    .where('user_id', userId)
    .where('organization_id', orgId)
    .where('status', 'active')
    .first()
  const org = await db('organizations').where('id', orgId).first()
  const isOwner = !!org && (org.owner_id === userId || membership?.role === 'owner')
  const isAdmin = membership?.role === 'admin'
  if (!org || (!isOwner && !isAdmin)) {
    // Same answer for "no such org" and "not yours": no existence oracle.
    throw new InviteError(403, 'FORBIDDEN', 'Insufficient permissions')
  }
  if (orgId === ROOT_ORG_ID && memberType === 'customer') {
    if (!isOwner) {
      throw new InviteError(
        403,
        'FORBIDDEN',
        'Only the platform root owner may invite customers into the root organization'
      )
    }
    if (role === 'admin') {
      throw bad('A customer can not be invited as admin of the root organization')
    }
  }
  return { userId, org, isOwner }
}

/** Org-admin gate for list/resend/revoke (no memberType in play). */
export async function authorizeOrgAdmin(userId: string, orgId: string): Promise<InviterContext> {
  return authorizeInviter(userId, orgId, null, null)
}

// ─── portal scoping (no cross-portal attach) ────────────────────────────────

/**
 * The "portal tree" an org belongs to: the platform root itself, the portal root
 * (direct child of ROOT_ORG_ID) it descends from, or — for a tree that does not
 * reach the root (e.g. a personal org) — its own topmost org.
 */
export async function portalKeyOf(orgId: string): Promise<string> {
  if (orgId === ROOT_ORG_ID) return ROOT_ORG_ID
  const res: any = await db.raw(
    `WITH RECURSIVE anc AS (
       SELECT id, parent_id, 0 AS depth FROM organizations WHERE id = ?
       UNION ALL
       SELECT o.id, o.parent_id, anc.depth + 1
         FROM organizations o JOIN anc ON o.id = anc.parent_id
        WHERE anc.depth < 16
     )
     SELECT id, parent_id FROM anc ORDER BY depth ASC`,
    [orgId]
  )
  const rows: Array<{ id: string; parent_id: string | null }> = res?.rows ?? []
  let top = orgId
  for (const r of rows) {
    top = r.id
    if (r.parent_id === ROOT_ORG_ID) return r.id
  }
  return top
}

/**
 * A customer is homed to exactly ONE portal tree. Attaching `userId` as a
 * customer of `targetOrgId` is refused (403 PORTAL_CONTEXT_MISMATCH) when they
 * are already an active customer in a DIFFERENT portal tree. Employees are not
 * portal-homed and are unaffected.
 */
export async function assertNoCrossPortalAttach(userId: string, targetOrgId: string): Promise<void> {
  const rows: Array<{ organization_id: string }> = await db('organization_memberships')
    .where('user_id', userId)
    .where('status', 'active')
    .where('member_type', 'customer')
    .select('organization_id')
  if (!rows || rows.length === 0) return
  const targetKey = await portalKeyOf(targetOrgId)
  for (const r of rows) {
    if (r.organization_id === targetOrgId) continue
    if ((await portalKeyOf(r.organization_id)) !== targetKey) {
      throw new InviteError(
        403,
        'PORTAL_CONTEXT_MISMATCH',
        'This account is already a customer of a different portal'
      )
    }
  }
}

// ─── DTO ─────────────────────────────────────────────────────────────────────

type Wire = (type: 'invitation' | 'organization' | 'user', uuid: string | null | undefined) => string | undefined

/** Builds the id-renderer for the request (TypeID wire form when the flag is on). */
export function wireIds(prefixed: boolean): Wire {
  return (type, uuid) => {
    if (!uuid) return undefined
    if (!prefixed) return uuid
    try {
      return fromUuid(type, uuid)
    } catch {
      return uuid
    }
  }
}

function effectiveStatus(row: any): InvitationStatus {
  if (row.status === 'pending' && new Date(row.expires_at).getTime() < Date.now()) return 'expired'
  return row.status
}

/** Admin projection (`Invitation`). Never carries the token or bindToken. */
export function toInvitationDto(row: any, wire: Wire) {
  const invitee = row.invitee_user_id
    ? { kind: 'account', userId: wire('user', row.invitee_user_id) }
    : row.channel === 'whatsapp'
      ? { kind: 'external', channel: 'whatsapp', phone: row.phone }
      : { kind: 'external', channel: 'email', email: row.email }
  return {
    id: wire('invitation', row.id),
    organizationId: wire('organization', row.organization_id),
    invitee,
    channel: row.channel,
    role: row.role,
    memberType: row.member_type,
    status: effectiveStatus(row),
    invitedByUserId: wire('user', row.invited_by),
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
  }
}

// ─── create ──────────────────────────────────────────────────────────────────

interface ResolvedInvitee {
  channel: InviteChannel
  email: string | null
  phone: string | null
  inviteeUserId: string | null
  /** An existing account this invitee already corresponds to (portal/duplicate checks). */
  existingUserId: string | null
}

async function resolveInvitee(invitee: ParsedInvitee): Promise<ResolvedInvitee> {
  if (invitee.kind === 'account') {
    const user = await db('users').where('id', invitee.userId).first()
    if (!user) throw new InviteError(404, 'NOT_FOUND', 'Invitee account not found')
    return {
      channel: 'email',
      email: normalizeEmail(user.email),
      phone: null,
      inviteeUserId: user.id,
      existingUserId: user.id,
    }
  }
  if (invitee.channel === 'email') {
    const existing = await db('users').whereRaw('LOWER(email) = ?', [invitee.email]).first()
    return {
      channel: 'email',
      email: invitee.email,
      phone: null,
      inviteeUserId: null,
      existingUserId: existing?.id ?? null,
    }
  }
  const existing = await db('users').where('phone', invitee.phone).where('phone_verified', true).first()
  return {
    channel: 'whatsapp',
    email: null,
    phone: invitee.phone,
    inviteeUserId: null,
    existingUserId: existing?.id ?? null,
  }
}

export interface CreateOutcome {
  status: 'created' | 'skipped'
  reason?: string
  row?: any
  token?: string
  resolved: ResolvedInvitee
}

/**
 * Persist ONE invitation (+ the `identity.invitation.created` outbox event, in
 * the same transaction). `skipped`/`already-pending` / `already-member` are
 * reported, not thrown, so a bulk batch can report precisely; the single create
 * route turns them into 409.
 */
export async function createInvitation(
  ctx: InviterContext,
  parsed: { role: InviteRole; memberType: MemberType },
  invitee: ParsedInvitee
): Promise<CreateOutcome> {
  const resolved = await resolveInvitee(invitee)
  const orgId = ctx.org.id

  // Already a member? An invite would never change an existing membership.
  if (resolved.existingUserId) {
    const member = await db('organization_memberships')
      .where('user_id', resolved.existingUserId)
      .where('organization_id', orgId)
      .where('status', 'active')
      .first()
    if (member) return { status: 'skipped', reason: 'already-member', resolved }
    if (parsed.memberType === 'customer') {
      await assertNoCrossPortalAttach(resolved.existingUserId, orgId)
    }
  }

  // Pending dedupe by invited identity (live invitations only).
  const pending = db('organization_invitations')
    .where('organization_id', orgId)
    .where('status', 'pending')
    .where('expires_at', '>', new Date())
  const dup = resolved.inviteeUserId
    ? await pending.where('invitee_user_id', resolved.inviteeUserId).first()
    : resolved.channel === 'email'
      ? await pending.where('email', resolved.email).first()
      : await pending.where('phone', resolved.phone).first()
  if (dup) return { status: 'skipped', reason: 'already-pending', resolved }

  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)
  const id = toUuid(mintId('invitation')) // the service mints; the body never carries an id

  const row = {
    id,
    organization_id: orgId,
    email: resolved.email,
    phone: resolved.phone,
    channel: resolved.channel,
    invitee_user_id: resolved.inviteeUserId,
    role: parsed.role,
    member_type: parsed.memberType,
    token,
    expires_at: expiresAt,
    status: 'pending',
    invited_by: ctx.userId,
  }

  await db.transaction(async (trx: any) => {
    await trx('organization_invitations').insert(row)
    await emitInvitationCreated(trx, row)
  })

  return { status: 'created', row: { ...row, created_at: new Date() }, token, resolved }
}

export function invitationCreatedPayload(row: any) {
  return identityInvitationCreatedSchemaV1.parse({
    organizationId: row.organization_id,
    invitationId: row.id,
    invitedByUserId: row.invited_by,
    role: row.role,
    memberType: row.member_type,
    channel: row.channel,
    ...(row.invitee_user_id ? { inviteeUserId: row.invitee_user_id } : {}),
    ...(row.email ? { email: row.email } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    expiresAt: new Date(row.expires_at).toISOString(),
  })
}

export async function emitInvitationCreated(trx: any, row: any): Promise<void> {
  await enqueueEvent(
    trx,
    TOPICS.IDENTITY_INVITATION_CREATED,
    invitationCreatedPayload(row),
    `identity-invitation-created-${uuidv4()}`
  )
}

export async function emitInvitationAccepted(
  trx: any,
  inv: { id: string; organization_id: string; role: string; member_type: string },
  userId: string
): Promise<void> {
  await enqueueEvent(
    trx,
    TOPICS.IDENTITY_INVITATION_ACCEPTED,
    identityInvitationAcceptedSchemaV1.parse({
      organizationId: inv.organization_id,
      invitationId: inv.id,
      userId,
      role: inv.role,
      memberType: inv.member_type,
    }),
    `identity-invitation-accepted-${uuidv4()}`
  )
}

// ─── list ────────────────────────────────────────────────────────────────────

export async function listInvitations(
  orgId: string,
  opts: { limit: number; cursor?: string; status?: InvitationStatus }
): Promise<{ rows: any[]; nextCursor: string | null; hasMore: boolean }> {
  let q = db('organization_invitations').where('organization_id', orgId)
  if (opts.status === 'pending') {
    // A pending row past its expiry is reported (and filtered) as `expired`.
    q = q.where('status', 'pending').where('expires_at', '>', new Date())
  } else if (opts.status === 'expired') {
    q = q.whereRaw(`(status = 'expired' OR (status = 'pending' AND expires_at <= now()))`)
  } else if (opts.status) {
    q = q.where('status', opts.status)
  }
  if (opts.cursor) {
    const k = decodeCursor(opts.cursor)
    // Keyset (created_at DESC, id DESC): gap/dupe-free under concurrent writes.
    q = q.whereRaw('(created_at, id) < (?, ?)', [k.c, k.i])
  }
  const fetched: any[] = await q
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(opts.limit + 1)
  const hasMore = fetched.length > opts.limit
  const rows = hasMore ? fetched.slice(0, opts.limit) : fetched
  const last = rows[rows.length - 1]
  return {
    rows,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  }
}

// ─── accept + bind ───────────────────────────────────────────────────────────

export interface BindOutcome {
  outcome: 'bound' | 'conflict' | 'expired' | 'forbidden'
  // bound
  role?: InviteRole
  memberType?: MemberType
  organizationId?: string
  userId?: string
  // forbidden
  code?: string
  message?: string
}

/** Whether the platform enforces verified emails (mirrors the Authentik provider). */
function emailVerificationEnforced(): boolean {
  return (
    process.env.REQUIRE_EMAIL_VERIFICATION === 'true' &&
    !!(process.env.EMAIL_SERVICE_URL && process.env.EMAIL_SERVICE_URL.trim())
  )
}

/**
 * Does the accepting account correspond to the invited identity? Fail-closed.
 * `requireVerifiedEmail` is relaxed ONLY on the signup-bind path, where the
 * bindToken (handed out only to the holder of the dispatched invite token) is
 * itself the proof of mailbox access and the address is verified moments later.
 */
export async function checkIdentityMatch(
  inv: any,
  userId: string,
  opts: { requireVerifiedEmail: boolean }
): Promise<{ ok: boolean; message?: string }> {
  const user = await db('users').where('id', userId).first()
  if (!user) return { ok: false, message: 'Account not found' }
  if (inv.invitee_user_id) {
    return user.id === inv.invitee_user_id
      ? { ok: true }
      : { ok: false, message: 'This invitation was issued to a different account' }
  }
  if (inv.channel === 'whatsapp') {
    return user.phone_verified === true && user.phone === inv.phone
      ? { ok: true }
      : { ok: false, message: 'This invitation was sent to a different phone number' }
  }
  if (!user.email || !inv.email || String(user.email).toLowerCase() !== String(inv.email).toLowerCase()) {
    return { ok: false, message: 'This invitation was sent to a different email address' }
  }
  if (opts.requireVerifiedEmail && emailVerificationEnforced() && user.email_verified !== true) {
    return { ok: false, message: 'Verify your email address to accept this invitation' }
  }
  return { ok: true }
}

/**
 * Bind `userId` to the invitation's org with its role + memberType. Atomic CAS
 * accept (status pending→accepted, unexpired) + membership insert + outbox
 * events in ONE transaction. An EXISTING membership is never rewritten (no role
 * downgrade — the last owner can not be demoted by an invite, FFRNT-300).
 */
export async function bindInvitation(inv: any, userId: string): Promise<BindOutcome> {
  if (inv.member_type === 'customer') {
    try {
      await assertNoCrossPortalAttach(userId, inv.organization_id)
    } catch (e) {
      if (e instanceof InviteError) return { outcome: 'forbidden', code: e.code, message: e.message }
      throw e
    }
  }

  let cas = false
  await db.transaction(async (trx: any) => {
    const result = await trx.raw(
      `UPDATE organization_invitations
          SET status = 'accepted', bind_token = NULL, bind_token_expires_at = NULL
        WHERE id = ? AND status = 'pending' AND expires_at > now()
        RETURNING id`,
      [inv.id]
    )
    const rowCount = result.rowCount ?? (result.rows ? result.rows.length : 0)
    if (rowCount === 0) return // lost the race (or expired in-flight)
    cas = true

    const existing = await trx('organization_memberships')
      .where('user_id', userId)
      .where('organization_id', inv.organization_id)
      .first()
    if (!existing) {
      await trx('organization_memberships').insert({
        id: toUuid(mintId('membership')),
        user_id: userId,
        organization_id: inv.organization_id,
        role: inv.role,
        member_type: inv.member_type,
        status: 'active',
        invited_by: inv.invited_by ?? null,
        joined_at: new Date(),
        permissions: JSON.stringify({}),
        metadata: JSON.stringify({}),
      })
      await emitMembershipAdded(trx, {
        organizationId: inv.organization_id,
        userId,
        role: inv.role,
      })
    }
    await emitInvitationAccepted(trx, inv, userId)
  })

  if (!cas) {
    // Distinguish "someone else won" from "it expired between read and write".
    return new Date(inv.expires_at).getTime() < Date.now() ? { outcome: 'expired' } : { outcome: 'conflict' }
  }
  return {
    outcome: 'bound',
    role: inv.role,
    memberType: inv.member_type,
    organizationId: inv.organization_id,
    userId,
  }
}

/**
 * `202` path: an unauthenticated accept mints a fresh single-use bindToken,
 * stores only its digest + a short expiry, and returns the plaintext once.
 */
export async function issueBindToken(inv: any): Promise<string> {
  const { token, hash } = mintBindToken()
  await db('organization_invitations')
    .where('id', inv.id)
    .where('status', 'pending')
    .update({ bind_token: hash, bind_token_expires_at: new Date(Date.now() + BIND_TOKEN_TTL_MS) })
  return token
}

// (Not a discriminated union: this package compiles without strictNullChecks,
// where `bound: true|false` would not narrow.)
export interface RedeemOutcome {
  bound: boolean
  organizationId?: string
  role?: InviteRole
  memberType?: MemberType
  reason?: 'invalid-token' | 'expired' | 'identity-mismatch' | 'conflict' | 'forbidden'
}

/**
 * Signup-time redemption of a bindToken: after the account exists, verify the
 * signup identity matches the invited channel identity and auto-bind the
 * membership (role + memberType). Fail-closed: a bad/expired/mismatched token
 * binds nothing (the account itself is unaffected) and is never an oracle — the
 * caller logs the reason, the HTTP signup response is unchanged.
 */
export async function redeemBindToken(
  bindToken: string,
  user: { id: string }
): Promise<RedeemOutcome> {
  const inv = await db('organization_invitations')
    .where('bind_token', hashBindToken(bindToken))
    .first()
  if (!inv) return { bound: false, reason: 'invalid-token' }
  const now = Date.now()
  if (
    inv.status !== 'pending' ||
    !inv.bind_token_expires_at ||
    new Date(inv.bind_token_expires_at).getTime() < now ||
    new Date(inv.expires_at).getTime() < now
  ) {
    return { bound: false, reason: 'expired' }
  }
  const match = await checkIdentityMatch(inv, user.id, { requireVerifiedEmail: false })
  if (!match.ok) {
    logger.warn({ invitationId: inv.id, userId: user.id }, 'bindToken redeem: identity mismatch (fail-closed)')
    return { bound: false, reason: 'identity-mismatch' }
  }
  const result = await bindInvitation(inv, user.id)
  if (result.outcome === 'bound') {
    return { bound: true, organizationId: result.organizationId, role: result.role, memberType: result.memberType }
  }
  return { bound: false, reason: result.outcome === 'forbidden' ? 'forbidden' : result.outcome === 'expired' ? 'expired' : 'conflict' }
}
