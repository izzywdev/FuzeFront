/**
 * Feature-flag access for the security-service slice.
 *
 * (The `fuzefront.identity.prefixed-ids` flag was retired under FFRNT-185 once
 * it reached 100 % in production; the TypeID wire form is now unconditional —
 * see ./serializer.ts.)
 *
 * Reads flags via the family OpenFeature client (@fuzefront/feature-flags) per
 * the feature-flags skill — we CONSUME flags here; the flag platform/taxonomy
 * is owned by feature-flags-engineer.
 *
 * Flags consumed by this slice:
 *   - fuzefront.auth.experience
 *       type: release | default: OFF
 *       owner: backend-engineer (security) for the server half; the flag itself
 *       is registered by feature-flags-engineer (packages/feature-flags/
 *       flag-registry.yaml) and shared with the frontend half.
 *       When ON the signup surface switches to the auth-experience contract
 *       (1.0.0): single `name`, server-side password-policy enforcement (422
 *       PASSWORD_POLICY), Turnstile verification when configured, the
 *       `GET /signup/email-available` alias, and `passwordPolicy`/`captcha` on
 *       `GET /methods`. OFF = the pre-1.0.0 behaviour, byte-for-byte (legacy
 *       firstName/lastName honoured, no policy/captcha gate, alias 404s).
 *       This is rollout convenience only — real authz stays in Permit; the
 *       signup/availability endpoints are rate-limited/validated regardless.
 *       removal criterion: delete with the frontend half once the
 *       auth-experience flows are GA in 100% of environments; drop the OFF
 *       branches (legacy firstName/lastName shim in routes/security.ts) in the
 *       same PR.
 *
 * In-code defaults are the fail-safe values (OFF for release) so an
 * Unleash/client outage fails safe. Any error from the client → the default.
 */

export const FLAGS = {
  AUTH_EXPERIENCE: 'fuzefront.auth.experience',
} as const

export interface FlagContext {
  environment?: string
  orgId?: string
  userId?: string
  app?: string
}

export interface FlagClientLike {
  getBooleanValue(
    key: string,
    defaultValue: boolean,
    context?: Record<string, unknown>
  ): Promise<boolean>
}

let injected: FlagClientLike | null = null

/** Test/DI seam — pin flag values with an in-memory client. */
export function setIdentityFlagClient(c: FlagClientLike | null): void {
  injected = c
}

function resolveClient(): FlagClientLike | null {
  if (injected) return injected
  try {
    // Lazy require so the service never hard-fails if the client is absent.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@fuzefront/feature-flags')
    return typeof mod.getClient === 'function' ? mod.getClient() : null
  } catch {
    return null
  }
}

function buildContext(ctx?: Partial<FlagContext>): Record<string, unknown> {
  const { orgId, ...rest } = ctx ?? {}
  return {
    environment: process.env.NODE_ENV === 'production' ? 'prod' : (process.env.FLAG_ENV ?? 'local'),
    app: 'security-service',
    ...(orgId ? { orgId } : {}),
    ...rest,
  }
}

/**
 * Release flag (default OFF): serve/enforce the auth-experience signup contract?
 *
 * Evaluated PRE-AUTH — there is no user or org yet — so the context is just
 * `app` + `environment` (the documented "no principal" case in the
 * feature-flags skill). Rollout is therefore per-environment, not per-user.
 */
export async function isAuthExperienceEnabled(ctx?: Partial<FlagContext>): Promise<boolean> {
  const client = resolveClient()
  if (!client) return false // fail-safe: release default OFF
  try {
    return await client.getBooleanValue(FLAGS.AUTH_EXPERIENCE, false, buildContext(ctx))
  } catch {
    return false
  }
}
