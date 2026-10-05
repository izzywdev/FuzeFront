// lib/featureFlags.ts — startup/shutdown wiring for the family flag client
// (`@fuzefront/feature-flags`: OpenFeature + Unleash).
//
// WHY (rollout runbook B4). `src/flags.ts` reads the release flag
// `fuzefront.selection-lists.service` through `getClient()` of this package, but
// until `init()` runs no Unleash provider is installed and OpenFeature's no-op
// provider answers every evaluation with the in-code default (OFF). So even with
// the flag at 100% in Unleash the API 404'd for everyone. `initFeatureFlags()`
// installs the provider; `closeFeatureFlags()` stops its polling on shutdown.
//
// Env (the Helm chart wires these; the token is a SealedSecret reference):
//   UNLEASH_URL            Unleash CLIENT API base, ending in /api
//   UNLEASH_APP_NAME       app name reported to Unleash (default selection-list-service)
//   UNLEASH_CLIENT_TOKEN   Unleash CLIENT token (never an admin/frontend token)
//
// Local/CI with no Unleash: set FUZE_FLAGS_PROVIDER=offline (+ FUZE_FLAGS_OFFLINE_ON,
// a comma list of keys to force ON) to install the ONE explicit offline provider
// in @fuzefront/feature-flags. It is refused in production and ignored whenever
// Unleash is configured (Unleash always wins), so a stray env var can never light
// up a dark feature in prod. This replaces the old FLAGS_FORCE_ON hatch and, unlike
// it, runs the SAME OpenFeature client path production uses.
//
// FAIL-CLOSED BY CONSTRUCTION. Release flag, default OFF: if the URL/token is
// missing, the package cannot be loaded, init throws, or Unleash is unreachable,
// the service still starts and every evaluation resolves to the fail-safe OFF —
// i.e. the feature stays dark (404). The service never refuses to start because
// the flag platform is down: flags are a rollout control, not a dependency.
// `init()` itself is bounded (it resolves within its readyTimeout even when
// Unleash is down) so startup cannot hang on it.

import { logger } from './logger';

export type FlagInitResult = 'initialized' | 'skipped-unconfigured' | 'skipped-unavailable' | 'failed';

interface FlagsModule {
  init(
    options: {
      url?: string;
      clientToken?: string;
      appName?: string;
      provider?: 'unleash' | 'offline';
      offline?: { on: string[] };
    },
    context?: Record<string, unknown>,
  ): Promise<void>;
  close?: () => Promise<void>;
}

export interface FeatureFlagsDeps {
  /** Loads the package. Defaults to a lazy `require`. Injectable for tests. */
  load?: () => FlagsModule | null;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_APP_NAME = 'selection-list-service';

function defaultLoad(): FlagsModule | null {
  try {
    // Lazy on purpose (same as src/flags.ts): a missing/unbuilt package degrades
    // to fail-safe OFF instead of crashing the service at import time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@fuzefront/feature-flags') as FlagsModule;
  } catch (err) {
    logger.error(
      { err },
      '@fuzefront/feature-flags could not be loaded — release flag stays OFF (feature dark)',
    );
    return null;
  }
}

let loaded: FlagsModule | null = null;

/**
 * Install the Unleash-backed OpenFeature provider. Never throws.
 * Returns what happened so startup can log it and tests can assert it.
 */
export async function initFeatureFlags({ load = defaultLoad, env = process.env }: FeatureFlagsDeps = {}): Promise<FlagInitResult> {
  const url = env.UNLEASH_URL;
  const clientToken = env.UNLEASH_CLIENT_TOKEN;
  const offlineRequested = env.FUZE_FLAGS_PROVIDER === 'offline';
  const appName = env.UNLEASH_APP_NAME || DEFAULT_APP_NAME;
  const context = {
    environment: env.NODE_ENV === 'production' ? 'prod' : env.FLAG_ENV || 'local',
    app: appName,
  };

  // No Unleash configured. Either install the explicit offline provider (local/
  // CI, forced ON via FUZE_FLAGS_OFFLINE_ON) or run with in-code defaults (dark).
  if (!url || !clientToken) {
    if (!offlineRequested) {
      logger.warn(
        { hasUrl: Boolean(url), hasToken: Boolean(clientToken) },
        'UNLEASH_URL / UNLEASH_CLIENT_TOKEN not set — feature flags use in-code defaults (release flag OFF: feature dark)',
      );
      return 'skipped-unconfigured';
    }

    const mod = load();
    if (!mod || typeof mod.init !== 'function') {
      logger.error('feature-flags package unavailable or has no init() — release flag stays OFF');
      return 'skipped-unavailable';
    }

    const on = (env.FUZE_FLAGS_OFFLINE_ON || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const start = performance.now();
    logger.debug({ op: 'featureflags.init', provider: 'offline', on }, 'featureflags.init start (offline)');
    try {
      // Refused in production by the provider itself (throws) — we fail closed.
      await mod.init({ provider: 'offline', offline: { on }, appName }, context);
      loaded = mod;
      logger.info(
        { op: 'featureflags.init', provider: 'offline', on, elapsedMs: Math.round(performance.now() - start) },
        'feature flags initialized (offline provider)',
      );
      return 'initialized';
    } catch (err) {
      logger.error(
        { err, op: 'featureflags.init', provider: 'offline', elapsedMs: Math.round(performance.now() - start) },
        'offline feature-flag init failed — continuing with in-code defaults (release flag OFF)',
      );
      return 'failed';
    }
  }

  const mod = load();
  if (!mod || typeof mod.init !== 'function') {
    logger.error('feature-flags package unavailable or has no init() — release flag stays OFF');
    return 'skipped-unavailable';
  }

  const start = performance.now();
  logger.debug({ op: 'featureflags.init', appName }, 'featureflags.init start');
  try {
    await mod.init({ url, clientToken, appName }, context);
    loaded = mod;
    logger.info(
      { op: 'featureflags.init', appName, elapsedMs: Math.round(performance.now() - start) },
      'feature flags initialized',
    );
    return 'initialized';
  } catch (err) {
    logger.error(
      { err, op: 'featureflags.init', elapsedMs: Math.round(performance.now() - start) },
      'feature-flag init failed — continuing with in-code defaults (release flag OFF)',
    );
    return 'failed';
  }
}

/** Stop the provider's polling. Safe to call when init never ran. Never throws. */
export async function closeFeatureFlags(): Promise<void> {
  const mod = loaded;
  loaded = null;
  if (!mod || typeof mod.close !== 'function') return;
  try {
    await mod.close();
    logger.info('feature flags closed');
  } catch (err) {
    logger.warn({ err }, 'feature-flag close failed (ignored during shutdown)');
  }
}
