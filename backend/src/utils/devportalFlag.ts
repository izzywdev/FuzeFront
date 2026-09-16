/**
 * `fuzefront.devportal.enabled` — gates the whole developers.fuzefront.com
 * capability (docs/planning/developers-portal.md): devportal-service routes,
 * devportal-frontend, and the root-org `developer` membership auto-
 * provisioning hook (`ensureDeveloperMembership`).
 *
 * Mirrors `backend/security/src/utils/devportalFlag.ts` — this is the
 * monolith copy of the SAME flag (locked name, same default). Modeled on
 * `rootMembershipFlag.ts`: security-service is the LIVE/authoritative
 * provisioning path; this copy exists so the two backends never disagree.
 *
 * Type: release. Owner: backend-engineer/frontend-engineer/devops-engineer
 * (devportal). Default: OFF. Removal criterion: delete once
 * developers.fuzefront.com is GA at 100% rollout.
 *
 * Read via @fuzefront/feature-flags (OpenFeature) per the `feature-flags`
 * skill. Loaded lazily so a missing/unbuilt package degrades to the
 * fail-safe default (OFF) rather than crashing route/service modules at
 * import time.
 */

export const DEVPORTAL_FLAG = 'fuzefront.devportal.enabled'

export interface DevportalFlagContext {
  userId?: string
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
 * Evaluates the devportal flag for the current request/operation. NEVER
 * throws — any failure (package absent, provider unreachable, evaluation
 * error) degrades to the release-flag fail-safe default: OFF.
 */
export async function isDevportalEnabled(
  ctx: DevportalFlagContext = {}
): Promise<boolean> {
  const client = loadFlagsClient()
  if (!client) return false

  const context = {
    environment:
      ctx.environment ??
      (process.env.NODE_ENV === 'production' ? 'prod' : process.env.FLAG_ENV || 'local'),
    app: 'fuzefront-backend',
    ...(ctx.userId ? { userId: ctx.userId } : {}),
  }

  try {
    return await client.getBooleanValue(DEVPORTAL_FLAG, false, context)
  } catch {
    return false
  }
}
