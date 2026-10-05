/**
 * Public types for @fuzefront/feature-flags.
 *
 * The public evaluation surface is OpenFeature; these Fuze-flavored types map
 * onto OpenFeature's EvaluationContext using FIXED key names so that Unleash
 * strategy constraints can target them deterministically across the family.
 */

/**
 * Fuze evaluation context. Mapped onto an OpenFeature EvaluationContext:
 *   - `userId`                 -> OpenFeature `targetingKey`
 *   - `environment`            -> custom string field `environment`
 *   - `orgId`                  -> custom string field `orgId`
 *   - `tenantId`               -> custom string field `tenantId`
 *   - `app`                    -> custom string field `app`
 *   - any extra keys           -> custom fields (string/number/boolean/Date passed through)
 *
 * Use these exact key names in Unleash constraints (e.g. constrain on
 * context field `orgId` or `environment`).
 */
export interface FuzeFlagsContext {
  /** Deployment environment, e.g. "production" | "development". */
  environment?: string;
  /** Tenant / organization id. Drives custom context field + Unleash constraints. */
  orgId?: string;
  /** Explicit tenant id (alias for orgId when both are meaningful). */
  tenantId?: string;
  /** End-user id -> OpenFeature targetingKey (used for stickiness / gradual rollout). */
  userId?: string;
  /** Consuming app name. */
  app?: string;
  /** Arbitrary extra custom context fields. */
  [k: string]: unknown;
}

export interface FuzeFlagsOptions {
  /**
   * Which provider to install. Defaults to `'unleash'` (the only production
   * provider). `'offline'` installs an in-memory provider from a static ON list
   * and is the single, explicit replacement for the old per-service
   * `FLAGS_FORCE_ON` escape hatches — selected ONLY by env
   * (`FUZE_FLAGS_PROVIDER=offline`), refused in production, and ignored whenever
   * Unleash is configured (Unleash always wins). See {@link init}.
   */
  provider?: 'unleash' | 'offline';
  /**
   * Offline-provider configuration. `on` lists the flag keys resolved `true`;
   * every other key is absent, so the caller's in-code default applies. Used
   * only when `provider === 'offline'`.
   */
  offline?: { on: string[] };
  /**
   * Unleash server API base URL, ending in `/api`, e.g.
   * `http://fuzefront-unleash.fuzefront.svc.cluster.local:4242/api`.
   *
   * For the web entry this should point at the Unleash front-end/proxy endpoint
   * (`/api/frontend` or an edge/proxy URL). Optional because the offline
   * provider needs no Unleash endpoint; required for the Unleash provider.
   */
  url?: string;
  /**
   * Client API token (server) or front-end token (web). Sourced from the
   * `UNLEASH_CLIENT_TOKEN` env var by the consuming service. Optional for the
   * offline provider; required for the Unleash provider.
   */
  clientToken?: string;
  /** Application name reported to Unleash. Defaults to "fuzefront". */
  appName?: string;
  /** Poll interval (seconds) for refreshing toggles. Defaults to 15. */
  refreshIntervalSec?: number;
  /**
   * Max time (ms) init() will wait for the provider to become ready before
   * resolving anyway (graceful degradation). Defaults to 5000.
   */
  readyTimeoutMs?: number;
}
