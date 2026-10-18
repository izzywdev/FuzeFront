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
  constructor(
    private readonly cfg: UnleashFlagSyncConfig,
    private readonly logger: Pick<Console, 'error' | 'warn' | 'info'> = console,
  ) {}

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
          await this.setOrgInFlag(flag, entityId, shouldEnable);
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

    await this.patchStrategyUserIds(flagName, strategy.id, serializeUserIds(current));
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

    // GET existing strategies
    const resp = await axios.get<Array<{ id: string; name: string; parameters: { userIds?: string } }>>(
      url, { headers, timeout: 5000 },
    );
    const existing = resp.data.find((s) => s.name === 'userWithId');
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

  private async patchStrategyUserIds(
    flagName: string,
    strategyId: string,
    userIds: string,
  ): Promise<void> {
    const url = `${this.cfg.adminUrl}/api/admin/projects/${this.cfg.project}/features/${flagName}/environments/${this.cfg.environment}/strategies/${strategyId}`;
    await axios.patch(
      url,
      { parameters: { userIds } },
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
