// Startup wiring for the family flag client (@fuzefront/feature-flags).
//
// Without this the OpenFeature provider is never installed, so every flag read
// resolves to its in-code default and the Unleash `developers` segment has no
// effect at runtime. Initialization is best-effort and NEVER fatal: if Unleash
// is unreachable or unconfigured the service still starts and flags degrade to
// their fail-safe defaults (release OFF / kill-switch ON).
//
// Env:
//   UNLEASH_URL          Unleash CLIENT API base, ending in /api
//                        (default: in-cluster service DNS)
//   UNLEASH_CLIENT_TOKEN Unleash CLIENT token — never a frontend/admin token
//
// Local/CI with no Unleash: set FUZE_FLAGS_PROVIDER=offline (+ FUZE_FLAGS_OFFLINE_ON,
// a comma list of keys to force ON) to install the ONE explicit offline provider
// in @fuzefront/feature-flags. It is refused in production and ignored whenever
// Unleash is configured (Unleash always wins), so a stray env var can never light
// up a dark feature in prod. This replaces the old per-route FLAGS_FORCE_ON hatch
// and, unlike it, runs the SAME OpenFeature client path production uses.

const DEFAULT_UNLEASH_URL =
  'http://fuzefront-unleash.fuzefront.svc.cluster.local:4242/api'

export async function initFeatureFlags(appName: string): Promise<void> {
  const clientToken = process.env.UNLEASH_CLIENT_TOKEN
  const context = {
    environment:
      process.env.NODE_ENV === 'production'
        ? 'prod'
        : process.env.FLAG_ENV || 'local',
    app: appName,
  }

  if (!clientToken) {
    // No Unleash. Install the explicit offline provider when asked (local/CI),
    // otherwise run with in-code defaults (flags dark). The offline provider is
    // refused in production by the package itself, so this cannot light up a
    // dark feature in prod.
    if (process.env.FUZE_FLAGS_PROVIDER === 'offline') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const flags = require('@fuzefront/feature-flags')
        if (typeof flags.init !== 'function') {
          console.log('⚠️  @fuzefront/feature-flags has no init() — using defaults')
          return
        }
        const on = (process.env.FUZE_FLAGS_OFFLINE_ON || '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
        await flags.init({ provider: 'offline', offline: { on }, appName }, context)
        console.log('✅ Feature flags initialized (offline provider) (%s)', appName)
      } catch (error) {
        console.error(
          '❌ Offline feature-flag init failed — continuing with in-code defaults: %s',
          error instanceof Error ? error.message : String(error)
        )
      }
      return
    }
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
      context
    )
    console.log('✅ Feature flags initialized (%s)', appName)
  } catch (error) {
    console.error(
      '❌ Feature-flag init failed — continuing with in-code defaults: %s',
      error instanceof Error ? error.message : String(error)
    )
  }
}
