// Startup wiring for the family flag client (@fuzefront/feature-flags).
//
// Mirrors backend/src/utils/feature-flags.ts — deliberately duplicated rather
// than shared, so a missing/broken flag package can never take a service down:
// the require is lazy and every failure path is non-fatal.
//
// Without this the OpenFeature provider is never installed, so app-registry
// flags resolve to their in-code defaults and the Unleash `developers` segment
// has no runtime effect.
//
// Env:
//   UNLEASH_URL          Unleash CLIENT API base, ending in /api
//   UNLEASH_CLIENT_TOKEN Unleash CLIENT token — never a frontend/admin token

const DEFAULT_UNLEASH_URL =
  'http://fuzefront-unleash.fuzefront.svc.cluster.local:4242/api'

export async function initFeatureFlags(appName: string): Promise<void> {
  const clientToken = process.env.UNLEASH_CLIENT_TOKEN
  if (!clientToken) {
    // Constant format string + arguments, never an interpolated one: a variable
    // as the format string lets an injected specifier (%s/%d) forge log output.
    console.log(
      '⚠️  [%s] UNLEASH_CLIENT_TOKEN not set — feature flags use in-code defaults',
      appName
    )
    return
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const flags = require('@fuzefront/feature-flags')
    if (typeof flags.init !== 'function') {
      console.log('⚠️  [%s] @fuzefront/feature-flags has no init() — using defaults', appName)
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
    console.log('✅ [%s] Feature flags initialized', appName)
  } catch (error) {
    console.error(
      '❌ [%s] Feature-flag init failed — continuing with in-code defaults: %s',
      appName,
      error instanceof Error ? error.message : String(error)
    )
  }
}
