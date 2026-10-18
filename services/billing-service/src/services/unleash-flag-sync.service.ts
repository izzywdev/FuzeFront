// unleash-flag-sync.service.ts — per-org Unleash plan-tier flag sync.
//
// When a subscription changes, this service updates the Unleash Admin API so
// each org's plan-tier permission flags reflect its active subscription tier.
// This is the Unleash half of the billing → access-control pipeline:
//
//   Stripe webhook → syncPlanToPermit() [Permit ABAC attributes]
//                  → syncPlanFlags()    [Unleash per-org flag states]  ← this
//
// Per-org flag enablement uses the Unleash `userWithId` strategy: each
// plan-tier flag carries ONE strategy whose `parameters.userIds` is a
// comma-separated list of org/user IDs entitled to that tier or above.
// This service reads that list, adds or removes the entity's ID, and PATCHes
// the strategy back. The org/user ID is treated as the Unleash "userId" —
// consistent with how toUnleashContext() maps targetingKey → userId in
// packages/feature-flags/src/unleash-provider.ts.
//
// PLAN_CAPABILITY_MAP (inclusive — enables the named flag AND all below):
//   free       → no per-org plan flags (plan-free is global default-ON)
//   starter    → plan-starter
//   growth     → plan-starter, plan-growth
//   enterprise → plan-starter, plan-growth, plan-enterprise
//
// Capability flags (sso-enabled, api-access, …) are managed by FFRNT-365
// and not included here — those require Permit ABAC policy changes as well.
//
// DARK DEPLOY: the `fuzefront.billing.plan-flag-sync-enabled` flag defaults
// OFF; merging this file does not affect production. Flip the flag in Unleash
// (via prod-unleash-ops.yml or the admin UI) to activate.
//
// IMPORTANT — same error-swallowing contract as permit.service.ts:
// A failure here must never fail webhook processing. The permit.service.ts
// header describes the reasoning in detail; it applies equally here.

import axios from 'axios';
import { Pool } from 'pg';
import { normalizeTier } from '@fuzefront/billing-types';
import { getBooleanFlag, FlagContext } from './authz.flags';

export const PLAN_FLAG_SYNC_ENABLED = 'fuzefront.billing.plan-flag-sync-enabled';

// The three plan-tier permission flags managed per-org. plan-free is global
// default-ON and needs no per-org strategy.
const PLAN_TIER_FLAGS = [
  'fuzefront.billing.plan-starter',
  'fuzefront.billing.plan-growth',
  'fuzefront.billing.plan-enterprise',
] as const;

// Which flags to enable for each canonical tier (inclusive — all listed flags
// get the orgId added; unlisted flags get it removed).
const PLAN_CAPABILITY_MAP: Record<string, readonly string[]> = {
  free: [],
  starter: ['fuzefront.billing.plan-starter'],
  growth: ['fuzefront.billing.plan-starter', 'fuzefront.billing.plan-growth'],
  enterprise: ['fuzefront.billing.plan-starter', 'fuzefront.billing.plan-growth', 'fuzefront.billing.plan-enterprise'],
};

export interface UnleashFlagSyncConfig {
  /** Unleash admin API base, e.g. http://fuzefront-unleash.fuzefront.svc.cluster.local:4242 */
  adminUrl: string;
  adminToken: string;
  project: string;
  environment: string;
}

export class UnleashFlagSyncService {
  // Per-flag mutex: serializes GET→PATCH within this process. Combined with
  // the Postgres advisory lock below, this prevents both intra- and inter-
  // process races in multi-replica deployments.
  private readonly _flagLocks = new Map<string, Promise<void>>();

  // Deterministic lock IDs in the billing-service namespace (2_147_000_0xx).
  // Each flag gets a unique int so replicas don't contend across flag names.
  private static readonly FLAG_LOCK_IDS: Readonly<Record<string, number>> = {
    'fuzefront.billing.plan-starter':    2_147_000_001,
    'fuzefront.billing.plan-growth':     2_147_000_002,
    'fuzefront.billing.plan-enterprise': 2_147_000_003,
  };

  constructor(
    private readonly cfg: UnleashFlagSyncConfig,
    private readonly logger: Pick<Console, 'error' | 'warn' | 'info'> = console,
    private readonly db?: Pool,
  ) {}

  private withFlagLock<T>(flagName: string, fn: () => Promise<T>): Promise<T> {
    const prior = this._flagLocks.get(flagName) ?? Promise.resolve();
    const next = prior.then(fn, fn);
    // Store a void chain so the Map never holds a rejected promise.
    this._flagLocks.set(flagName, next.then(() => undefined, () => undefined));
    return next;
  }

  // Acquires a Postgres session-level advisory lock for the given flag, runs
  // fn(), then unconditionally releases it. Uses a dedicated client checkout
  // so the lock and unlock always land on the same connection. Falls back to
  // calling fn() directly when db is absent (single-process / test mode).
  private async withDbAdvisoryLock<T>(flagName: string, fn: () => Promise<T>): Promise<T> {
    const lockId = UnleashFlagSyncService.FLAG_LOCK_IDS[flagName];
    if (!this.db || lockId === undefined) return fn();
    const client = await this.db.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [lockId]);
      try {
        return await fn();
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
      }
    } finally {
      client.release();
    }
  }

  /**
   * Syncs the per-org plan-tier permission flags for the given entity.
   * Adds the entityId to the userWithId strategy of each flag it should have;
   * removes it from flags it should not have.
   *
   * Returns true if all flag syncs succeeded, false if any failed (failures are
   * logged and swallowed — a partial sync is still better than a failed webhook).
   */
  async syncPlanFlags(entityId: string, planTier: string): Promise<boolean> {
    try {
      const flagCtx: FlagContext = { entityId };
      const enabled = await getBooleanFlag(PLAN_FLAG_SYNC_ENABLED, false, flagCtx);
      if (!enabled) {
        this.logger.info(
          `[flag-sync] ${PLAN_FLAG_SYNC_ENABLED} is OFF — skipping Unleash plan flag sync for ${entityId}`,
        );
        return false;
      }

      const canonicalTier = normalizeTier(planTier);
      const enabledFlags = new Set(PLAN_CAPABILITY_MAP[canonicalTier] ?? []);
      let allOk = true;

      for (const flag of PLAN_TIER_FLAGS) {
        const shouldEnable = enabledFlags.has(flag);
        try {
          await this.withFlagLock(flag, () =>
            this.withDbAdvisoryLock(flag, () => this.setOrgInFlag(flag, entityId, shouldEnable)),
          );
        } catch (err) {
          this.logger.error(
            `[flag-sync] failed to ${shouldEnable ? 'add' : 'remove'} ${entityId} ${shouldEnable ? 'to' : 'from'} ${flag}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          allOk = false;
        }
      }

      return allOk;
    } catch (err) {
      // getBooleanFlag or any top-level await threw — swallow to prevent an
      // unhandled rejection from crashing the Node.js 24 process mid-webhook.
      this.logger.error(
        `[flag-sync] unexpected error syncing plan flags for ${entityId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  /** Adds or removes entityId from the userWithId strategy for the given flag. */
  private async setOrgInFlag(
    flagName: string,
    entityId: string,
    shouldInclude: boolean,
  ): Promise<void> {
    const strategy = await this.getOrCreateUserWithIdStrategy(flagName);
    if (!strategy) {
      this.logger.warn(`[flag-sync] no userWithId strategy found/created for ${flagName}`);
      return;
    }

    const current = parseUserIds(strategy.parameters?.userIds ?? '');
    const had = current.has(entityId);

    if (shouldInclude === had) return; // no-op — already in the right state

    if (shouldInclude) {
      current.add(entityId);
    } else {
      current.delete(entityId);
    }

    await this.putStrategyUserIds(flagName, strategy.id, serializeUserIds(current));
  }

  /**
   * Returns the existing `userWithId` strategy for the flag's environment, or
   * creates one with an empty `userIds` list and returns it.
   */
  private async getOrCreateUserWithIdStrategy(
    flagName: string,
  ): Promise<{ id: string; parameters: { userIds?: string } } | null> {
    const url = `${this.cfg.adminUrl}/api/admin/projects/${this.cfg.project}/features/${flagName}/environments/${this.cfg.environment}/strategies`;
    const headers = { Authorization: this.cfg.adminToken, 'Content-Type': 'application/json' };

    // GET existing strategies — Unleash v4 returns a bare array; v5+ wraps it as { strategies: [] }.
    const resp = await axios.get<unknown>(url, { headers, timeout: 5000 });
    const list: Array<{ id: string; name: string; parameters: { userIds?: string } }> =
      Array.isArray(resp.data) ? resp.data : ((resp.data as any).strategies ?? []);
    const existing = list.find((s) => s.name === 'userWithId');
    if (existing) return existing;

    // No userWithId strategy yet — create one with empty userIds.
    // First ensure the environment is enabled.
    await axios.post(
      `${this.cfg.adminUrl}/api/admin/projects/${this.cfg.project}/features/${flagName}/environments/${this.cfg.environment}/on`,
      null,
      { headers: { Authorization: this.cfg.adminToken }, timeout: 5000, validateStatus: () => true },
    );

    const createResp = await axios.post<{ id: string; parameters: { userIds?: string } }>(
      url,
      { name: 'userWithId', parameters: { userIds: '' } },
      { headers, timeout: 5000 },
    );
    return createResp.data;
  }

  // PUT /strategies/:id is supported on both Unleash v4 and v5; PATCH is v5+ only.
  private async putStrategyUserIds(
    flagName: string,
    strategyId: string,
    userIds: string,
  ): Promise<void> {
    const url = `${this.cfg.adminUrl}/api/admin/projects/${this.cfg.project}/features/${flagName}/environments/${this.cfg.environment}/strategies/${strategyId}`;
    await axios.put(
      url,
      { name: 'userWithId', parameters: { userIds } },
      { headers: { Authorization: this.cfg.adminToken, 'Content-Type': 'application/json' }, timeout: 5000 },
    );
  }
}

function parseUserIds(raw: string): Set<string> {
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

function serializeUserIds(ids: Set<string>): string {
  return Array.from(ids).join(',');
}
