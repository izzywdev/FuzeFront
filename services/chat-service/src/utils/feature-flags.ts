// Startup wiring for the family flag client (@fuzefront/feature-flags).
// Mirrors backend/security/src/utils/feature-flags.ts (copied rather than
// shared — chat-service compiles independently into its own dist/, same as
// the rest of the per-service split).
//
// Without this the OpenFeature provider is never installed, so every flag
// read (e.g. `fuzefront.authz.chat-agent-security-api`, agent/authzFlag.ts)
// resolves to its in-code default. Initialization is best-effort and NEVER
// fatal: if Unleash is unreachable or unconfigured the service still starts
// and flags degrade to their fail-safe default (release OFF).
//
// Env:
//   UNLEASH_URL          Unleash CLIENT API base, ending in /api
//                        (default: in-cluster service DNS)
//   UNLEASH_CLIENT_TOKEN Unleash CLIENT token — never a frontend/admin token

const DEFAULT_UNLEASH_URL =
  'http://fuzefront-unleash.fuzefront.svc.cluster.local:4242/api';

export async function initFeatureFlags(appName: string): Promise<void> {
  const clientToken = process.env.UNLEASH_CLIENT_TOKEN;
  if (!clientToken) {
    // Constant format string + arguments, never an interpolated one.
    // eslint-disable-next-line no-console
    console.log(
      '[%s] UNLEASH_CLIENT_TOKEN not set — feature flags will use in-code defaults',
      appName,
    );
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const flags = require('@fuzefront/feature-flags');
    if (typeof flags.init !== 'function') {
      // eslint-disable-next-line no-console
      console.log('[%s] @fuzefront/feature-flags has no init() — using defaults', appName);
      return;
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
      },
    );
    // eslint-disable-next-line no-console
    console.log('[%s] Feature flags initialized', appName);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      '[%s] Feature-flag init failed — continuing with in-code defaults: %s',
      appName,
      error instanceof Error ? error.message : String(error),
    );
  }
}
