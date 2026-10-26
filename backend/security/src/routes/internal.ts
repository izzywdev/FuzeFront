import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { db } from '../config/database'
import { mintId, toUuid } from '@izzywdev/fuzefront-identity'
import {
  runInternalProvision,
  deprovisionOrganization,
  ensureDeveloperMembership,
} from '../services/organizationProvisioning'
import {
  syncUserProfile,
  deprovisionUser,
} from '../services/userLifecycle'
import { syncUserToDatabase } from '../services/oidc'
import { isDevportalEnabled } from '../utils/devportalFlag'
import {
  assignOrganizationRole,
  unassignOrganizationRole,
} from '../utils/permit/role-assignment'
import { withReqId } from '../lib/logger'

const router = express.Router()

/**
 * Constant-time check of the shared `x-internal-secret` header against
 * INTERNAL_PROVISION_SECRET. Fails closed when the secret is unconfigured.
 */
function isAuthorized(req: express.Request): boolean {
  const expected = process.env.INTERNAL_PROVISION_SECRET
  const provided = req.header('x-internal-secret')
  const a = Buffer.from(provided || '')
  const b = Buffer.from(expected || '')
  return !(
    !expected ||
    !provided ||
    a.length !== b.length ||
    !crypto.timingSafeEqual(a, b)
  )
}

/**
 * Internal, service-to-service provisioning endpoint.
 *
 * Plan D's provisioning-service calls this so that ALL provisioning logic stays
 * single-sourced in the backend. Authenticated by a shared secret carried in the
 * `x-internal-secret` header and compared against `INTERNAL_PROVISION_SECRET`
 * (from env / a chart Secret). NEVER expose this through the public ingress.
 *
 *   POST /internal/provision
 *   Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
 *   Body:    { "userId": "<uuid>" }
 *   200 { ok: true, personalOrgId, reconciled: [{ orgId, state }] }
 *     `personalOrgId` is `null` when `fuzefront.identity.root-membership` is
 *     ON — no personal org is created in that path (FF-EPIC-17-S1); the user
 *     is instead upserted as a root-org member (see `ensureRootMembership`).
 *   400 { error } missing userId
 *   401 { error } bad/missing secret (or secret not configured)
 *
 * Idempotent; safe to retry.
 */
router.post('/provision', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { userId } = req.body || {}
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId is required' })
  }

  try {
    const result = await runInternalProvision(userId)
    return res.status(200).json({ ok: true, ...result })
  } catch (error: any) {
    console.error('Internal provision failed:', error)
    return res
      .status(500)
      .json({ error: 'Provisioning failed', detail: String(error?.message ?? error) })
  }
})

/**
 * Internal, service-to-service DE-provisioning endpoint — the teardown mirror of
 * /provision, called by provisioning-service on `identity.org.deleted`.
 *
 *   POST /internal/deprovision
 *   Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
 *   Body:    { "organizationId": "<uuid>", "cascade": "soft" | "hard" }
 *   200 { ok: true, organizationId, cascade, rolesRevoked, tenantDeleted }
 *   400 { error } missing organizationId
 *   401 { error } bad/missing secret
 *
 * Idempotent + best-effort; safe to retry.
 */
router.post('/deprovision', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { organizationId, cascade } = req.body || {}
  if (!organizationId || typeof organizationId !== 'string') {
    return res.status(400).json({ error: 'organizationId is required' })
  }
  const mode: 'soft' | 'hard' = cascade === 'hard' ? 'hard' : 'soft'

  try {
    const result = await deprovisionOrganization(organizationId, mode)
    return res.status(200).json({ ok: true, ...result })
  } catch (error: any) {
    console.error('Internal deprovision failed:', error)
    return res
      .status(500)
      .json({ error: 'Deprovisioning failed', detail: String(error?.message ?? error) })
  }
})

/**
 * Internal, service-to-service user profile re-sync endpoint — called by
 * provisioning-service on `identity.user.updated` to mirror the user's profile
 * into Permit.
 *
 *   POST /internal/user-sync
 *   Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
 *   Body:    { "userId": "<uuid>", "email": "<email>", "firstName"?, "lastName"? }
 *   200 { ok: true, userId, permitSynced }
 *   400 { error } missing userId/email
 *   401 { error } bad/missing secret
 *
 * Idempotent + best-effort; safe to retry.
 */
router.post('/user-sync', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { userId, email, firstName, lastName } = req.body || {}
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId is required' })
  }
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' })
  }

  try {
    const result = await syncUserProfile({ userId, email, firstName, lastName })
    return res.status(200).json({ ok: true, ...result })
  } catch (error: any) {
    console.error('Internal user-sync failed:', error)
    return res
      .status(500)
      .json({ error: 'User sync failed', detail: String(error?.message ?? error) })
  }
})

/**
 * Internal, service-to-service user teardown endpoint — the mirror of
 * /user-sync, called by provisioning-service on `identity.user.deleted`. Deletes
 * the Permit principal and revokes the user's sessions.
 *
 *   POST /internal/user-delete
 *   Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
 *   Body:    { "userId": "<uuid>", "cascade": "soft" | "hard" }
 *   200 { ok: true, userId, cascade, permitDeleted, sessionsRevoked }
 *   400 { error } missing userId
 *   401 { error } bad/missing secret
 *
 * Idempotent + best-effort; safe to retry.
 */
router.post('/user-delete', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { userId, cascade } = req.body || {}
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId is required' })
  }
  const mode: 'soft' | 'hard' = cascade === 'hard' ? 'hard' : 'soft'

  try {
    const result = await deprovisionUser(userId, mode)
    return res.status(200).json({ ok: true, ...result })
  } catch (error: any) {
    console.error('Internal user-delete failed:', error)
    return res
      .status(500)
      .json({ error: 'User delete failed', detail: String(error?.message ?? error) })
  }
})

/**
 * Internal, service-to-service OIDC user-sync endpoint.
 *
 * docs/planning/developers-portal.md §5.1/§5.2 — devportal-service performs
 * its OWN Authentik authorization-code exchange (own redirect_uri on the
 * SAME FuzeFront OAuth2 provider) and gets back OIDC `userinfo` claims, but
 * does not own the `users` table. Rather than re-implement account
 * find-or-create, it hands the raw userinfo claims here and gets back the
 * resolved FuzeFront user id — the SAME `syncUserToDatabase` projection the
 * classic `/oidc/callback` and the Google-broker path both use, so a
 * developer who already has a FuzeFront account (by email) links to it
 * instead of getting a duplicate.
 *
 *   POST /internal/oidc-sync
 *   Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
 *   Body:    { "userinfo": { "email": "...", "given_name": "...", ... } }
 *   200 { ok: true, userId, email }
 *   400 { error } missing/invalid userinfo.email
 *   401 { error } bad/missing secret
 *   404 { error } devportal flag is OFF
 */
router.post('/oidc-sync', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { userinfo } = req.body || {}
  if (!userinfo || typeof userinfo !== 'object' || typeof userinfo.email !== 'string') {
    return res.status(400).json({ error: 'userinfo.email is required' })
  }

  if (!(await isDevportalEnabled({}))) {
    return res.status(404).json({ error: 'Not found' })
  }

  try {
    const user = await syncUserToDatabase(userinfo)
    return res.status(200).json({ ok: true, userId: user.id, email: user.email })
  } catch (error: any) {
    console.error('Internal oidc-sync failed:', error)
    return res
      .status(500)
      .json({ error: 'OIDC sync failed', detail: String(error?.message ?? error) })
  }
})

/**
 * Internal, service-to-service session-minting endpoint.
 *
 * governance/architecture-guidelines.md §1 — AuthN is provided by FuzeFront;
 * products VERIFY FuzeFront-issued tokens, they do not issue their own user
 * tokens. devportal-service performs its own Authentik OIDC exchange (its
 * own redirect_uri, §5.1) but must not locally sign a session JWT — this
 * endpoint mints a REAL FuzeFront session the exact same way
 * `POST /oidc/callback` does (same `sessions` table row, same `JWT_SECRET`,
 * same `{userId, sessionId}` claim shape), so devportal-service's own
 * session-verification middleware ends up checking a FuzeFront-issued token
 * like every other service does (see services/selection-list-service/src/
 * middleware/auth.ts) — not a parallel, service-local trust root.
 *
 *   POST /internal/mint-session
 *   Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
 *   Body:    { "userId": "<uuid>" }
 *   200 { ok: true, token, sessionId, expiresAt }
 *   400 { error } missing userId
 *   401 { error } bad/missing secret
 *   404 { error } devportal flag is OFF
 */
router.post('/mint-session', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { userId } = req.body || {}
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId is required' })
  }

  if (!(await isDevportalEnabled({ userId }))) {
    return res.status(404).json({ error: 'Not found' })
  }

  try {
    const sessionId = toUuid(mintId('session'))
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)

    await db('sessions').insert({
      id: sessionId,
      user_id: userId,
      expires_at: expiresAt,
    })

    // This IS FuzeFront's identity service — the issuer of platform tokens
    // (same mint as /login and the OIDC callback in routes/auth.ts), not a
    // product self-minting. devportal-service calls this endpoint instead of
    // signing its own token; see governance/architecture-guidelines.md §1.
    // nosemgrep: fuze-auth-self-minted-user-token, semgrep.fuze-auth-self-minted-user-token
    const token = jwt.sign({ userId, sessionId }, process.env.JWT_SECRET!, {
      expiresIn: '24h',
    })

    return res.status(200).json({ ok: true, token, sessionId, expiresAt })
  } catch (error: any) {
    console.error('Internal mint-session failed:', error)
    return res
      .status(500)
      .json({ error: 'Session mint failed', detail: String(error?.message ?? error) })
  }
})

/**
 * Internal, service-to-service devportal-provisioning endpoint.
 *
 * docs/planning/developers-portal.md §5.2 — devportal-service calls this
 * (never the public ingress) right after a user's FIRST successful OIDC
 * sign-in at developers.fuzefront.com, so root-org `developer` membership is
 * single-sourced here rather than duplicated into devportal-service's own DB.
 * Same shared-secret auth as /provision. Fails closed (404) while
 * `fuzefront.devportal.enabled` is OFF — the whole capability is dark.
 *
 *   POST /internal/devportal-provision
 *   Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
 *   Body:    { "userId": "<uuid>" }
 *   200 { ok: true }
 *   400 { error } missing userId
 *   401 { error } bad/missing secret
 *   404 { error } devportal flag is OFF
 *
 * Idempotent; safe to retry.
 */
router.post('/devportal-provision', async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { userId } = req.body || {}
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId is required' })
  }

  if (!(await isDevportalEnabled({ userId }))) {
    return res.status(404).json({ error: 'Not found' })
  }

  try {
    await ensureDeveloperMembership(userId)
    return res.status(200).json({ ok: true })
  } catch (error: any) {
    console.error('Internal devportal-provision failed:', error)
    return res
      .status(500)
      .json({ error: 'Provisioning failed', detail: String(error?.message ?? error) })
  }
})

/**
 * Body for the membership reconcile endpoints. `.strict()` = additionalProperties
 * false: unknown keys are rejected rather than silently dropped. `role` is the
 * MEMBERSHIP role (mapped to a Permit role inside role-assignment.ts).
 */
const membershipChangeBody = z
  .object({
    organizationId: z.string().uuid(),
    userId: z.string().uuid(),
    role: z.enum(['owner', 'admin', 'member', 'viewer', 'developer']),
  })
  .strict()

type MembershipOp = 'membership-sync' | 'membership-unsync'

async function handleMembershipChange(
  op: MembershipOp,
  apply: typeof assignOrganizationRole,
  req: express.Request,
  res: express.Response
) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const log = withReqId((req as any).requestId, req as any)
  const parsed = membershipChangeBody.safeParse(req.body ?? {})
  if (!parsed.success) {
    const issues = (parsed as z.SafeParseError<unknown>).error.issues
    log.warn({ op, fields: issues.map(i => i.path.join('.')) }, 'invalid membership change body')
    return res.status(400).json({
      error: 'organizationId, userId (uuid) and a valid role are required',
    })
  }
  const { organizationId, userId, role } = parsed.data

  try {
    // assign/unassign swallow Permit errors and return false — a false MUST
    // surface as non-2xx so the consumer retries rather than silently
    // dropping the reconcile.
    const ok = await apply(userId, organizationId, role)
    if (!ok) {
      log.error({ op, organizationId, userId, role }, 'permit role change failed')
      return res.status(500).json({ error: 'Membership sync failed' })
    }
    log.info({ op, organizationId, userId, role }, 'membership role reconciled in permit')
    return res.status(200).json({ ok: true, organizationId, userId, role })
  } catch (error: any) {
    log.error({ err: error, op, organizationId, userId, role }, 'internal membership change failed')
    return res
      .status(500)
      .json({ error: 'Membership sync failed', detail: String(error?.message ?? error) })
  }
}

/**
 * Internal, service-to-service membership reconcile — called by
 * provisioning-service on `identity.membership.added`. Assigns the Permit role
 * that corresponds to the membership role in the org's tenant.
 *
 *   POST /internal/membership-sync
 *   Headers: x-internal-secret: <INTERNAL_PROVISION_SECRET>
 *   Body:    { "organizationId": "<uuid>", "userId": "<uuid>",
 *              "role": "owner|admin|member|viewer|developer" }
 *   200 { ok: true, organizationId, userId, role }
 *   400 { error } invalid body / unknown role
 *   401 { error } bad/missing secret
 *   500 { error } Permit failure (consumer retries)
 *
 * Idempotent; safe to retry.
 */
router.post('/membership-sync', (req, res) =>
  handleMembershipChange('membership-sync', assignOrganizationRole, req, res)
)

/**
 * Teardown mirror of /membership-sync — called by provisioning-service on
 * `identity.membership.removed`. Same body/status contract.
 *
 *   POST /internal/membership-unsync
 */
router.post('/membership-unsync', (req, res) =>
  handleMembershipChange('membership-unsync', unassignOrganizationRole, req, res)
)

export default router
