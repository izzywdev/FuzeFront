/**
 * OpenFeature Provider backed by the official Unleash Node SDK (`unleash-client`).
 *
 * WHY THIS EXISTS: `server.ts` previously `import()`ed a package named
 * `unleash-openfeature-provider-server`, which does not exist on npm and was not
 * declared as a dependency. The import therefore ALWAYS threw, the catch degraded
 * to the no-op default provider, and every server-side flag silently resolved to
 * its in-code default — no Unleash targeting was ever applied. The only published
 * Unleash OpenFeature Node provider (`@unleash/openfeature-node-provider`) is
 * 0.1.0-alpha, which we will not put on a production path, so we wrap the stable,
 * Unleash-maintained `unleash-client` ourselves.
 *
 * OpenFeature remains the public surface (so Unleash stays swappable); this class
 * is the only Unleash-aware code in the package's server path.
 */
import type {
  EvaluationContext,
  JsonValue,
  Provider,
  ResolutionDetails,
} from '@openfeature/server-sdk';

export interface UnleashProviderOptions {
  /** Unleash *client* API base, ending in `/api`. */
  url: string;
  /** Unleash CLIENT token (never a frontend or admin token). */
  clientToken: string;
  appName: string;
  /** Toggle refresh interval in milliseconds. */
  refreshIntervalMs: number;
}

/**
 * Map an OpenFeature EvaluationContext onto an Unleash context.
 *
 * `targetingKey` -> Unleash's built-in `userId`. This is the field the
 * `developers` segment constrains, so getting it wrong silently disables all
 * user targeting. Unleash only treats a fixed set of fields as built-ins;
 * everything else must go under `properties` to be constraint-targetable.
 */
export function toUnleashContext(context?: EvaluationContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const properties: Record<string, string> = {};
  if (!context) return { properties };

  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || value === null) continue;

    if (key === 'targetingKey') {
      out.userId = String(value);
      continue;
    }
    // Unleash built-in context fields, passed through as-is.
    if (
      key === 'userId' ||
      key === 'sessionId' ||
      key === 'remoteAddress' ||
      key === 'environment' ||
      key === 'appName'
    ) {
      out[key] = String(value);
      continue;
    }
    if (key === 'currentTime') {
      out.currentTime = value instanceof Date ? value : new Date(String(value));
      continue;
    }
    properties[key] = value instanceof Date ? value.toISOString() : String(value);
  }

  out.properties = properties;
  return out;
}

export class UnleashOpenFeatureProvider implements Provider {
  readonly metadata = { name: 'unleash-client (FuzeFront)' } as const;
  readonly runsOn = 'server' as const;

  private unleash: any;
  private readonly opts: UnleashProviderOptions;

  constructor(opts: UnleashProviderOptions) {
    this.opts = opts;
  }

  async initialize(): Promise<void> {
    // Imported lazily so that merely loading this module never requires the
    // Unleash SDK to be installed (tests use the in-memory provider instead).
    const { Unleash } = await import('unleash-client');
    this.unleash = new Unleash({
      url: this.opts.url,
      appName: this.opts.appName,
      refreshInterval: this.opts.refreshIntervalMs,
      customHeaders: { Authorization: this.opts.clientToken },
      // Never let SDK transport errors escape as unhandled events; evaluation
      // already falls back to the caller's default.
      disableMetrics: false,
    });
    this.unleash.on('error', () => {
      /* swallow: evaluations fall back to defaults */
    });
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      this.unleash.on('ready', done);
      this.unleash.on('error', done);
      const t = setTimeout(done, 5000);
      if (typeof (t as any).unref === 'function') (t as any).unref();
    });
  }

  async onClose(): Promise<void> {
    try {
      this.unleash?.destroy?.();
    } catch {
      /* ignore */
    } finally {
      this.unleash = undefined;
    }
  }

  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<boolean>> {
    if (!this.unleash) return { value: defaultValue, reason: 'ERROR' };
    try {
      const value = this.unleash.isEnabled(
        flagKey,
        toUnleashContext(context),
        defaultValue,
      );
      return { value: Boolean(value), reason: 'TARGETING_MATCH' };
    } catch {
      return { value: defaultValue, reason: 'ERROR' };
    }
  }

  private resolveVariant<T>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    coerce: (raw: string) => T | undefined,
  ): ResolutionDetails<T> {
    if (!this.unleash) return { value: defaultValue, reason: 'ERROR' };
    try {
      const variant = this.unleash.getVariant(flagKey, toUnleashContext(context));
      const payload = variant?.payload?.value;
      if (!variant?.enabled || payload === undefined) {
        return { value: defaultValue, reason: 'DEFAULT' };
      }
      const coerced = coerce(String(payload));
      if (coerced === undefined) return { value: defaultValue, reason: 'ERROR' };
      return { value: coerced, reason: 'TARGETING_MATCH', variant: variant.name };
    } catch {
      return { value: defaultValue, reason: 'ERROR' };
    }
  }

  async resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<string>> {
    return this.resolveVariant(flagKey, defaultValue, context, (raw) => raw);
  }

  async resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<number>> {
    return this.resolveVariant(flagKey, defaultValue, context, (raw) => {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    });
  }

  async resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<T>> {
    return this.resolveVariant(flagKey, defaultValue, context, (raw) => {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return undefined;
      }
    });
  }
}
