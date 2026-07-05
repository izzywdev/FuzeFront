import { EntityType } from '../types';

/**
 * Minimal shape of the permitio client we use, so tests don't need the real SDK.
 * Mirrors `permit.api.users.update` / `permit.api.tenants.update` used in backend.
 */
export interface PermitClientLike {
  api: {
    users: { update: (key: string, data: { attributes: Record<string, unknown> }) => Promise<unknown> };
    tenants: { update: (key: string, data: { attributes: Record<string, unknown> }) => Promise<unknown> };
  };
}

/**
 * Syncs the billing plan to Permit.io so the existing permission middleware can
 * gate features by plan via ABAC attributes.
 *
 * Failures are swallowed (logged) — a Permit outage must NOT fail webhook
 * processing, otherwise Stripe retries pile up and we lose the local mirror
 * update. The local DB cache + Permit are eventually reconciled by the next
 * subscription event.
 */
export class PermitSyncService {
  constructor(
    private readonly permit: PermitClientLike,
    private readonly logger: Pick<Console, 'error' | 'warn'> = console,
  ) {}

  async syncPlanToPermit(args: {
    entityType: EntityType;
    entityId: string;
    planTier: string;
    status: string;
    seatQuantity?: number;
  }): Promise<boolean> {
    const attributes: Record<string, unknown> = {
      plan_tier: args.planTier,
      plan_status: args.status,
    };
    if (typeof args.seatQuantity === 'number') {
      attributes.seat_limit = args.seatQuantity;
    }

    try {
      if (args.entityType === 'user') {
        await this.permit.api.users.update(args.entityId, { attributes });
      } else {
        await this.permit.api.tenants.update(args.entityId, { attributes });
      }
      return true;
    } catch (err) {
      this.logger.error(
        `[permit-sync] failed to sync ${args.entityType} ${args.entityId} → ${args.planTier}/${args.status}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }
}
