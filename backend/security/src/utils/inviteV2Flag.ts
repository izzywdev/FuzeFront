/**
 * FFRNT-307 / FFRNT-304 — the `fuzefront.identity.invite-v2` flag: gates the
 * Org-invitations-v2 server behavior —
 *   - the contract-shaped invitation endpoints (`InviteeRef` + `memberType` +
 *     `channel`, cursor-paginated list, 204 revoke) on
 *     `/api/organizations/:id/invitations*` and `POST /:id/members`,
 *   - the `bindToken` external-signup bind (`202` accept + `POST /signup`), and
 *   - the `identity.invitation.{created,accepted}` outbox events.
 *
 * Type: release. Owner: backend-engineer (identity). Default: OFF — with the
 * flag OFF the legacy `{ email, role }` invitation behavior is byte-identical to
 * before this change (zero regression). Removal criterion: delete this flag and
 * the legacy branch once org-invitations v2 is rolled out to 100%, the invitation
 * UI no longer sends the legacy `{ email }` body, and the flag-OFF path is no
 * longer exercised in prod.
 *
 * NOTE: this flag is rollout convenience only — it NEVER replaces real
 * authorization. Who may invite (org owner/admin; root-org owner for `customer`)
 * and who may accept (identity must match the invited channel) are enforced in
 * the handlers on every request. An id (or a token) is never a capability.
 *
 * Read via @fuzefront/feature-flags (OpenFeature) per the `feature-flags` skill
 * — never a hand-wired Unleash/OpenFeature call. Loaded lazily (mirrors
 * utils/memberDirectoryFlag.ts) so a missing/unbuilt package degrades to the
 * fail-safe default (OFF) rather than crashing route modules at import time.
 */

export const INVITE_V2_FLAG = 'fuzefront.identity.invite-v2'

export interface InviteV2FlagContext {
  userId?: string
  organizationId?: string
  environment?: string
}

interface FlagsClient {
  getBooleanValue(
    key: string,
    def: boolean,
    ctx?: Record<string, unknown>
  ): Promise<boolean>
}

function loadFlagsClient(): FlagsClient | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@fuzefront/feature-flags')
    return typeof mod.getClient === 'function' ? mod.getClient() : null
  } catch {
    return null
  }
}

/**
 * Evaluates the invite-v2 flag for the current request. NEVER throws — any
 * failure (package absent, provider unreachable, evaluation error) degrades to
 * the release-flag fail-safe default: OFF (legacy behavior).
 */
export async function isInviteV2Enabled(
  ctx: InviteV2FlagContext = {}
): Promise<boolean> {
  const client = loadFlagsClient()
  if (!client) return false

  const context = {
    environment:
      ctx.environment ??
      (process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local'),
    app: 'fuzefront-security',
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    ...(ctx.organizationId ? { organizationId: ctx.organizationId } : {}),
  }

  try {
    return await client.getBooleanValue(INVITE_V2_FLAG, false, context)
  } catch {
    return false
  }
}
