import {
  OpenFeature,
  ProviderEvents,
  type Provider,
  type Client,
} from '@openfeature/server-sdk';
import { toEvaluationContext } from './context';
import type { FuzeFlagsContext, FuzeFlagsOptions } from './types';

const DEFAULT_READY_TIMEOUT_MS = 5000;
const DEFAULT_APP_NAME = 'fuzefront';
const DEFAULT_REFRESH_SEC = 15;

/** Module-level singleton client (one OpenFeature client per process). */
let client: Client | undefined;

/**
 * Build the server-side Unleash OpenFeature provider.
 *
 * We wrap the native Unleash Node SDK (`unleash-client`) behind the official
 * OpenFeature provider published by Unleash (`unleash-openfeature-provider-server`)
 * when available; the import is dynamic so a missing/unreachable provider never
 * crashes module load. Keeping OpenFeature as the public surface means the rest
 * of this module is provider-agnostic.
 */
async function buildProvider(opts: FuzeFlagsOptions): Promise<Provider> {
  const mod: any = await import('unleash-openfeature-provider-server');
  const UnleashProvider = mod.UnleashProvider ?? mod.default?.UnleashProvider ?? mod.default;
  return new UnleashProvider({
    url: opts.url,
    clientKey: opts.clientToken,
    appName: opts.appName ?? DEFAULT_APP_NAME,
    refreshInterval: (opts.refreshIntervalSec ?? DEFAULT_REFRESH_SEC) * 1000,
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
