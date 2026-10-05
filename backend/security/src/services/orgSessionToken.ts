/**
 * Org-scoped session token exchange.
 *
 * FuzeFront's platform session token is `{ userId, sessionId, tid }` and names no
 * organization (`tid` is the IDENTITY-DIRECTORY tenant, i.e. which Authentik
 * instance authenticated the user, see providers/authentik/tenants.ts; it is not
 * an org id). Services that scope their data by organization
 * (selection-list-service, and any other that reads an `orgId` claim) therefore
 * had no verified source for the caller's org, and every org route answered 401.
 *
 * This module is that source. Given a valid session token and an organization id
 * the caller CLAIMS to act in, it checks the caller's ACTIVE membership of that
 * organization in the identity DB (the single writer of
 * `organization_memberships`) and only then signs
 *
 *     { userId, sessionId, tid, orgId, kind: 'fuze-org-session' }
 *
 * so the org in the token is the output of a membership check, never an input a
 * downstream service has to trust from a header or body.
 *
 * Design choices, all fail-closed:
 *  - Only a plain session token can be exchanged. A token that already carries a
 *    `kind` (an org-session, workload or delegation token) is refused, so an
 *    org token cannot be chained into another org's token or into a longer life.
 *  - The token must carry `sessionId` and that session row must still exist and
 *    be unexpired: a logged-out or revoked session cannot mint an org token.
 *  - The token's `tid` must match the tenant serving this request (same rule as
 *    logout), so a session from one directory cannot be exchanged in another.
 *  - Lifetime is short (15 min) and never beyond the session's own expiry.
 *    Consumers such as selection-list-service verify statelessly and cannot see
 *    a later logout, so the short TTL is the revocation bound; the browser
 *    re-exchanges (which re-checks session + membership) when it expires.
 *  - Membership and the org being `is_active` are re-checked on every exchange,
 *    so removing a member or deactivating an org takes effect within one TTL.
 *  - Non-member and nonexistent org are the SAME answer (403), so the endpoint
 *    is not an existence oracle.
 */
import jwt from 'jsonwebtoken'
import type { Knex } from 'knex'
import { isUuid, tryParseId, toUuid } from '@izzywdev/fuzefront-identity'
import { db as defaultDb } from '../config/database'

export const ORG_SESSION_KIND = 'fuze-org-session'
export const ORG_SESSION_MAX_TTL_SECONDS = 15 * 60

export type OrgSessionErrorCode =
  | 'INVALID_ORGANIZATION_ID'
  | 'INVALID_SESSION'
  | 'NOT_A_MEMBER'
  | 'INTERNAL'

export class OrgSessionError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 500,
    readonly code: OrgSessionErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'OrgSessionError'
  }
}

export interface OrgSessionTokenInput {
  /** The raw session bearer token (already authenticated by authenticateToken). */
  sessionToken: string
  /** `req.user.id` from authenticateToken; must equal the token's userId. */
  userId: string
  /** Org the caller wants to act in: bare UUID or `org_…` TypeID. */
  organizationId: unknown
  /** True when the token's `tid` is acceptable for the tenant serving this request. */
  tenantAccepts: (tokenTid: string | undefined) => boolean
  /** The tenant id to stamp into the minted token's `tid`. */
  tenantId: string
  db?: Knex
  now?: () => number
}

export interface OrgSessionToken {
  token: string
  tokenType: 'Bearer'
  expiresIn: number
  /** The org the token is bound to, as a bare UUID (organizations.id). */
  organizationId: string
}

/** Bare UUID (lower-cased) or `org_…` TypeID -> the bare UUID `organizations.id` uses. */
export function normaliseOrganizationId(raw: unknown): string {
  if (typeof raw === 'string') {
    if (isUuid(raw)) return raw.toLowerCase()
    const typed = tryParseId('organization', raw)
    if (typed) return toUuid(typed).toLowerCase()
  }
  throw new OrgSessionError(400, 'INVALID_ORGANIZATION_ID', 'Invalid organization id')
}

function jwtSecret(): string {
  const s = process.env.JWT_SECRET
  if (!s) throw new OrgSessionError(500, 'INTERNAL', 'Server misconfiguration')
  return s
}

export async function mintOrgSessionToken(input: OrgSessionTokenInput): Promise<OrgSessionToken> {
  const db = input.db ?? defaultDb
  const now = input.now ?? Date.now
  const orgUuid = normaliseOrganizationId(input.organizationId)
  const secret = jwtSecret()

  let claims: { userId?: unknown; sessionId?: unknown; tid?: unknown; kind?: unknown }
  try {
    // Algorithm pinned: the verifier must not be steerable by the token header.
    claims = jwt.verify(input.sessionToken, secret, { algorithms: ['HS256'] }) as typeof claims
  } catch {
    throw new OrgSessionError(401, 'INVALID_SESSION', 'Invalid token')
  }

  if (claims.kind !== undefined) {
    throw new OrgSessionError(401, 'INVALID_SESSION', 'Only a session token can be exchanged')
  }
  if (typeof claims.userId !== 'string' || claims.userId !== input.userId) {
    throw new OrgSessionError(401, 'INVALID_SESSION', 'Invalid token')
  }
  if (typeof claims.sessionId !== 'string' || claims.sessionId.length === 0) {
    // Pre-rollout tokens have no sessionId; revocation cannot be proven for them.
    throw new OrgSessionError(401, 'INVALID_SESSION', 'Session token has no session')
  }
  if (!input.tenantAccepts(typeof claims.tid === 'string' ? claims.tid : undefined)) {
    throw new OrgSessionError(401, 'INVALID_SESSION', 'Invalid token')
  }

  const session = await db('sessions').where('id', claims.sessionId).first('expires_at')
  if (!session) throw new OrgSessionError(401, 'INVALID_SESSION', 'Session revoked')
  const sessionExpiresMs = session.expires_at ? new Date(session.expires_at).getTime() : Infinity

  const membership = await db('organization_memberships as m')
    .join('organizations as o', 'o.id', 'm.organization_id')
    .where({ 'm.user_id': input.userId, 'm.organization_id': orgUuid, 'm.status': 'active' })
    .first('o.is_active as org_is_active')
  if (!membership || membership.org_is_active === false) {
    throw new OrgSessionError(403, 'NOT_A_MEMBER', 'Insufficient permissions')
  }

  const remainingSeconds = Math.floor((sessionExpiresMs - now()) / 1000)
  const expiresIn = Math.min(ORG_SESSION_MAX_TTL_SECONDS, remainingSeconds)
  if (!(expiresIn > 0)) throw new OrgSessionError(401, 'INVALID_SESSION', 'Session expired')

  // This IS FuzeFront's identity service minting a platform token, the same
  // issuer as routes/auth.ts /login; not a product self-minting a user token.
  // nosemgrep: fuze-auth-self-minted-user-token, semgrep.fuze-auth-self-minted-user-token
  const token = jwt.sign(
    {
      userId: input.userId,
      sessionId: claims.sessionId,
      tid: input.tenantId,
      orgId: orgUuid,
      kind: ORG_SESSION_KIND,
    },
    secret,
    { algorithm: 'HS256', expiresIn }
  )
  return { token, tokenType: 'Bearer', expiresIn, organizationId: orgUuid }
}
