import {
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

/** Module-level singleton client (one OpenFeature client per process). */
let client: Client | undefined;

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
    url: opts.url,
    clientToken: opts.clientToken,
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
 * client via `require('@fuzeone/feature-flags').getClient()` and call
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
