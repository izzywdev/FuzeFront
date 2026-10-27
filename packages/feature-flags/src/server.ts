import {
  InMemoryProvider,
  OpenFeature,
  ProviderEvents,
  type Provider,
  type Client,
} from '@openfeature/server-sdk';
import { toEvaluationContext } from './context';
import { UnleashOpenFeatureProvider } from './unleash-provider';
import type { FuzeFlagsContext, FuzeFlagsOptions } from './types';

const DEFAULT_READY_TIMEOUT_MS = 5000;
const DEFAULT_APP_NAME = 'fuzefront';
const DEFAULT_REFRESH_SEC = 15;

/**
 * Raised when the offline provider is asked to install somewhere it must never
 * run — chiefly production. Callers (e.g. a service's `initFeatureFlags`) catch
 * it and degrade to the fail-safe defaults, exactly as they would for an
 * Unleash outage; the no-op provider is left installed so evaluations keep
 * returning the caller's in-code defaults.
 */
export class FlagsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlagsConfigError';
  }
}

/** Module-level singleton client (one OpenFeature client per process). */
let client: Client | undefined;

/**
 * Build the offline (in-memory) provider: every key in `onKeys` resolves
 * `true`; any key NOT listed is absent, so the caller's in-code default applies
 * (the same InMemoryProvider used by the package's own tests). This is the ONE
 * explicit offline provider that replaces the per-service `FLAGS_FORCE_ON`
 * hatches — it never reaches a real flag store and never talks to Unleash.
 */
function buildOfflineProvider(onKeys: string[]): Provider {
  const flags: Record<
    string,
    { disabled: boolean; variants: { on: boolean; off: boolean }; defaultVariant: string }
  > = {};
  for (const key of onKeys) {
    flags[key] = {
      disabled: false,
      variants: { on: true, off: false },
      defaultVariant: 'on',
    };
  }
  return new InMemoryProvider(flags as never);
}

/**
 * Map process env to {@link FuzeFlagsOptions}. The ONLY selector for the offline
 * provider is `FUZE_FLAGS_PROVIDER=offline`; `FUZE_FLAGS_OFFLINE_ON` is the
 * comma-separated ON list (whitespace trimmed). Unleash config is read from the
 * standard `UNLEASH_URL` / `UNLEASH_CLIENT_TOKEN` vars — and always wins over an
 * offline request (see {@link init}).
 */
export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): FuzeFlagsOptions {
  const providerEnv = env.FUZE_FLAGS_PROVIDER;
  const provider =
    providerEnv === 'offline' || providerEnv === 'unleash' ? providerEnv : undefined;
  const on = (env.FUZE_FLAGS_OFFLINE_ON || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    provider,
    offline: { on },
    url: env.UNLEASH_URL,
    clientToken: env.UNLEASH_CLIENT_TOKEN,
  };
}

/**
 * Build the server-side Unleash OpenFeature provider.
 *
 * This previously `import()`ed `unleash-openfeature-provider-server` — a package
 * that does not exist on npm and was never declared as a dependency, so the
 * import always threw, the catch below degraded to the no-op default provider,
 * and every server-side flag silently resolved to its in-code default. We now
 * use an in-repo provider over the stable, Unleash-maintained `unleash-client`
 * (see ./unleash-provider). OpenFeature remains the public surface.
 */
async function buildProvider(opts: FuzeFlagsOptions): Promise<Provider> {
  // Statically imported: it is in-repo source and only *type*-imports the
  // OpenFeature SDK. The heavy `unleash-client` stays lazily imported inside
  // the provider's initialize(), so module load never requires the Unleash SDK.
  return new UnleashOpenFeatureProvider({
    url: opts.url ?? '',
    clientToken: opts.clientToken ?? '',
    appName: opts.appName ?? DEFAULT_APP_NAME,
    refreshIntervalMs: (opts.refreshIntervalSec ?? DEFAULT_REFRESH_SEC) * 1000,
  });
}

/**
 * Wait for the provider to emit Ready, but never longer than `timeoutMs`.
 * On timeout we resolve anyway: evaluations will return defaults until the
 * provider catches up (graceful degradation), and OpenFeature keeps polling.
 */
function awaitReady(c: Client, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    if (typeof (timer as any).unref === 'function') (timer as any).unref();
    c.addHandler(ProviderEvents.Ready, finish);
    c.addHandler(ProviderEvents.Error, finish);
  });
}

/**
 * Initialize the feature-flags client. Resolves within `readyTimeoutMs` even
 * if Unleash is unreachable — it NEVER hangs or throws on a down server.
 */
export async function init(
  opts: FuzeFlagsOptions,
  context?: FuzeFlagsContext,
): Promise<void> {
  const timeout = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;

  // Offline provider: the single, explicit replacement for the per-service
  // FLAGS_FORCE_ON hatches. Guard order matters and is deliberate.
  if (opts.provider === 'offline') {
    // 1. Unleash always wins. If a real endpoint/token is configured, an
    //    offline request is a misconfiguration, not an intent — ignore it
    //    LOUDLY and fall through to the Unleash provider below. Never print the
    //    url or token.
    if (opts.url || opts.clientToken) {
      // eslint-disable-next-line no-console
      console.error(
        '[feature-flags] FUZE_FLAGS_PROVIDER=offline ignored: Unleash is configured ' +
          '(UNLEASH_URL/UNLEASH_CLIENT_TOKEN set) — using the Unleash provider.',
      );
    } else {
      // 2. Never in production. A single env var must not be able to light up a
      //    dark feature in prod; prod targeting is Unleash only. Leave the no-op
      //    provider installed so evaluations keep returning in-code defaults,
      //    then throw so the caller fails closed (same as an Unleash outage).
      if (process.env.NODE_ENV === 'production') {
        client = OpenFeature.getClient();
        throw new FlagsConfigError('offline provider refused in production');
      }
      const provider = buildOfflineProvider(opts.offline?.on ?? []);
      if (context) {
        await OpenFeature.setContext(toEvaluationContext(context));
      }
      const set = OpenFeature.setProviderAndWait(provider).catch(() => undefined);
      client = OpenFeature.getClient();
      await Promise.race([set, awaitReady(client, timeout)]);
      return;
    }
  }

  try {
    const provider = await buildProvider(opts);
    if (context) {
      await OpenFeature.setContext(toEvaluationContext(context));
    }
    // setProviderAndWait can reject if the provider fails to init; we bound it.
    const set = OpenFeature.setProviderAndWait(provider).catch(() => undefined);
    client = OpenFeature.getClient();
    await Promise.race([set, awaitReady(client, timeout)]);
  } catch {
    // Provider construction/import failed -> degrade. Ensure a client exists so
    // getX still returns defaults via the (no-op) default provider.
    client = OpenFeature.getClient();
  }
}

/** Replace the global evaluation context. */
export async function setContext(context: FuzeFlagsContext): Promise<void> {
  await OpenFeature.setContext(toEvaluationContext(context));
}

function ensureClient(): Client {
  if (!client) client = OpenFeature.getClient();
  return client;
}

export async function getBoolean(
  flag: string,
  defaultValue: boolean,
  context?: FuzeFlagsContext,
): Promise<boolean> {
  try {
    return await ensureClient().getBooleanValue(
      flag,
      defaultValue,
      context ? toEvaluationContext(context) : undefined,
    );
  } catch {
    return defaultValue;
  }
}

export async function getString(
  flag: string,
  defaultValue: string,
  context?: FuzeFlagsContext,
): Promise<string> {
  try {
    return await ensureClient().getStringValue(
      flag,
      defaultValue,
      context ? toEvaluationContext(context) : undefined,
    );
  } catch {
    return defaultValue;
  }
}

export async function getNumber(
  flag: string,
  defaultValue: number,
  context?: FuzeFlagsContext,
): Promise<number> {
  try {
    return await ensureClient().getNumberValue(
      flag,
      defaultValue,
      context ? toEvaluationContext(context) : undefined,
    );
  } catch {
    return defaultValue;
  }
}

/**
 * OpenFeature-shaped facade returned by {@link getClient}.
 *
 * Consumers (e.g. `backend/applications/src/app-registry/flags.ts`) resolve the
 * client via `require('@fuzefront/feature-flags').getClient()` and call
 * `getBooleanValue(key, default, context)`. That export was missing, so
 * `resolveClient()` returned null and every flag took its in-code default
 * regardless of Unleash — this restores the contract those callers already
 * assume. Never throws: any failure resolves to the caller's default.
 */
export interface FuzeFlagsClient {
  getBooleanValue(
    flag: string,
    defaultValue: boolean,
    context?: FuzeFlagsContext,
  ): Promise<boolean>;
  getStringValue(
    flag: string,
    defaultValue: string,
    context?: FuzeFlagsContext,
  ): Promise<string>;
  getNumberValue(
    flag: string,
    defaultValue: number,
    context?: FuzeFlagsContext,
  ): Promise<number>;
}

/**
 * Get the flag client. Safe to call before {@link init} — evaluations simply
 * return their defaults until a provider is installed.
 */
export function getClient(): FuzeFlagsClient {
  return {
    getBooleanValue: getBoolean,
    getStringValue: getString,
    getNumberValue: getNumber,
  };
}

/** Shut down the provider and reset state. Safe to call repeatedly. */
export async function close(): Promise<void> {
  try {
    await OpenFeature.close();
  } catch {
    // ignore shutdown errors
  } finally {
    client = undefined;
  }
}

/**
 * Test/advanced seam: install an arbitrary OpenFeature provider (e.g.
 * InMemoryProvider) without going through Unleash. Used by unit tests to run
 * offline and deterministically.
 */
export async function __setProviderForTesting(provider: Provider): Promise<void> {
  await OpenFeature.setProviderAndWait(provider);
  client = OpenFeature.getClient();
}

export type { FuzeFlagsContext, FuzeFlagsOptions } from './types';
