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
   * Unleash server API base URL, ending in `/api`, e.g.
   * `http://fuzefront-unleash.fuzefront.svc.cluster.local:4242/api`.
   *
   * For the web entry this should point at the Unleash front-end/proxy endpoint
   * (`/api/frontend` or an edge/proxy URL).
   */
  url: string;
  /**
   * Client API token (server) or front-end token (web). Sourced from the
   * `UNLEASH_CLIENT_TOKEN` env var by the consuming service.
   */
  clientToken: string;
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
