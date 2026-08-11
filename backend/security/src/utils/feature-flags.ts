// Startup wiring for the family flag client (@fuzefront/feature-flags).
// Mirrors backend/src/utils/feature-flags.ts (monolith) — see that file for
// full context. Copied rather than shared because the two services compile
// independently (separate `dist/`), same as the rest of the
// organizationProvisioning.ts / migrations split.
//
// Without this the OpenFeature provider is never installed, so every flag
// read resolves to its in-code default and the Unleash `developers` segment
// has no effect at runtime. Initialization is best-effort and NEVER fatal: if
// Unleash is unreachable or unconfigured the service still starts and flags
// degrade to their fail-safe defaults (release OFF / kill-switch ON) — see
// `utils/rootMembershipFlag.ts`.
//
// Env:
//   UNLEASH_URL          Unleash CLIENT API base, ending in /api
//                        (default: in-cluster service DNS)
//   UNLEASH_CLIENT_TOKEN Unleash CLIENT token — never a frontend/admin token

const DEFAULT_UNLEASH_URL =
  'http://fuzefront-unleash.fuzefront.svc.cluster.local:4242/api'

export async function initFeatureFlags(appName: string): Promise<void> {
  const clientToken = process.env.UNLEASH_CLIENT_TOKEN
  if (!clientToken) {
    // Constant format string + arguments, never an interpolated one: a variable
    // as the format string lets an injected specifier (%s/%d) forge log output.
    console.log(
      '⚠️  UNLEASH_CLIENT_TOKEN not set — feature flags will use in-code defaults (%s)',
      appName
    )
    return
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const flags = require('@fuzefront/feature-flags')
    if (typeof flags.init !== 'function') {
      console.log('⚠️  @fuzefront/feature-flags has no init() — using defaults')
      return
    }
    await flags.init(
      {
        url: process.env.UNLEASH_URL || DEFAULT_UNLEASH_URL,
        clientToken,
        appName,
      },
      {
        environment:
          process.env.NODE_ENV === 'production'
            ? 'prod'
            : process.env.FLAG_ENV || 'local',
        app: appName,
      }
    )
    console.log('✅ Feature flags initialized (%s)', appName)
  } catch (error) {
    console.error(
      '❌ Feature-flag init failed — continuing with in-code defaults: %s',
      error instanceof Error ? error.message : String(error)
    )
  }
}
