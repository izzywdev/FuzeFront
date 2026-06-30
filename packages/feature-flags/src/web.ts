import {
  OpenFeature,
  ProviderEvents,
  type Provider,
  type Client,
} from '@openfeature/web-sdk';
import { toEvaluationContext } from './context';
import type { FuzeFlagsContext, FuzeFlagsOptions } from './types';

const DEFAULT_READY_TIMEOUT_MS = 5000;
const DEFAULT_APP_NAME = 'fuzefront';
const DEFAULT_REFRESH_SEC = 15;

let client: Client | undefined;

/**
 * Build the browser-side Unleash OpenFeature provider, wrapping
 * `unleash-proxy-client` via the official `@openfeature/unleash-web-provider`.
 * Dynamic import keeps module load safe if the dependency is absent.
 *
 * NOTE: the web `url` should be the Unleash front-end/proxy endpoint
 * (e.g. `.../api/frontend`) and `clientToken` a front-end token.
 */
async function buildProvider(opts: FuzeFlagsOptions): Promise<Provider> {
  const mod: any = await import('@openfeature/unleash-web-provider');
  const UnleashWebProvider =
    mod.UnleashWebProvider ?? mod.default?.UnleashWebProvider ?? mod.default;
  return new UnleashWebProvider({
    url: opts.url,
    clientKey: opts.clientToken,
    appName: opts.appName ?? DEFAULT_APP_NAME,
    refreshInterval: opts.refreshIntervalSec ?? DEFAULT_REFRESH_SEC,
  });
}

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
 * Initialize the web feature-flags client. Resolves within `readyTimeoutMs`
 * even if the Unleash proxy is unreachable — never hangs or throws.
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
    const set = OpenFeature.setProviderAndWait(provider).catch(() => undefined);
    client = OpenFeature.getClient();
    await Promise.race([set, awaitReady(client, timeout)]);
  } catch {
    client = OpenFeature.getClient();
  }
}

/**
 * Replace the global evaluation context. On the web SDK this triggers a
 * re-fetch of toggles for the new context.
 */
export async function setContext(context: FuzeFlagsContext): Promise<void> {
  await OpenFeature.setContext(toEvaluationContext(context));
}

function ensureClient(): Client {
  if (!client) client = OpenFeature.getClient();
  return client;
}

// The web SDK resolves against the static context set via setContext; reads are
// synchronous. The public API stays async for parity with the server entry.
export async function getBoolean(
  flag: string,
  defaultValue: boolean,
  context?: FuzeFlagsContext,
): Promise<boolean> {
  try {
    if (context) await OpenFeature.setContext(toEvaluationContext(context));
    return ensureClient().getBooleanValue(flag, defaultValue);
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
    if (context) await OpenFeature.setContext(toEvaluationContext(context));
    return ensureClient().getStringValue(flag, defaultValue);
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
    if (context) await OpenFeature.setContext(toEvaluationContext(context));
    return ensureClient().getNumberValue(flag, defaultValue);
  } catch {
    return defaultValue;
  }
}

export async function close(): Promise<void> {
  try {
    await OpenFeature.close();
  } catch {
    // ignore
  } finally {
    client = undefined;
  }
}

export async function __setProviderForTesting(provider: Provider): Promise<void> {
  await OpenFeature.setProviderAndWait(provider);
  client = OpenFeature.getClient();
}

export type { FuzeFlagsContext, FuzeFlagsOptions } from './types';
