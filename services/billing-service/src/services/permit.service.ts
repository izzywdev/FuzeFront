// permit.service.ts — billing-service's ABAC entitlement sync. Step 3 of 3 in
// an owner-requested migration off the embedded Permit.io SDK, onto
// FuzeFront's own Security API (backend/security's
// `PATCH /api/v1/security/authz/subjects/{subjectType}/{subjectKey}/attributes`)
// via the shared `@fuzefront/auth` client (`AuthzClient.setAttributes`).
// config-service was step 1 (#679), selection-list-service was step 2 (#699).
// See src/services/authz.ts for the client bootstrap and src/services/
// machineToken.ts for how billing authenticates (webhook handlers have no
// end-user bearer token to forward, unlike the other two services — see that
// file's header for why).
//
// syncPlanToPermit() is NOT a role assignment — it writes ABAC attributes
// (`plan_tier`, `plan_status`, optionally `seat_limit`) that the platform's
// permission checks read via context. Called from four money-path Stripe
// webhook handlers (checkout-completed, subscription-updated, invoice-paid,
// invoice-failed).
//
// ****************************************************************************
// * THE MOST IMPORTANT CONSTRAINT — DO NOT "IMPROVE" THIS ERROR HANDLING.    *
// ****************************************************************************
// Failures are swallowed (logged) — a Security API / Permit outage, a missing
// machine-token configuration, or a token-fetch failure must NOT fail webhook
// processing, otherwise Stripe retries pile up and we lose the local mirror
// update. The local DB cache + Permit are eventually reconciled by the next
// subscription event. `AuthzClient.setAttributes` THROWS on any failure (it
// must — it is a write, never a silent no-op); this class is the ONLY place
// that catches that throw and turns it into `false`. Do not let that throw
// propagate to a handler.
import { AuthzClient, SubjectType } from '@fuzefront/auth';
import { EntityType } from '../types';
import { getBooleanFlag, FLAGS, FlagContext } from './authz.flags';

/** Maps billing's EntityType onto the Security API's SubjectType. */
function toSubjectType(entityType: EntityType): SubjectType {
  return entityType === 'user' ? 'user' : 'tenant';
}

export class PermitSyncService {
  constructor(
    private readonly authz: AuthzClient,
    /** Fetches (and caches) the bearer token used to authenticate to the
     *  Security API. Injected so tests can supply a fake without a real
     *  Authentik token endpoint. See `machineToken.ts`'s `getMachineToken`. */
    private readonly getToken: () => Promise<string>,
    private readonly logger: Pick<Console, 'error' | 'warn'> = console,
  ) {}

  async syncPlanToPermit(args: {
    entityType: EntityType;
    entityId: string;
    planTier: string;
    status: string;
    seatQuantity?: number;
  }): Promise<boolean> {
    const attributes: Record<string, string | number | boolean> = {
      plan_tier: args.planTier,
      plan_status: args.status,
    };
    if (typeof args.seatQuantity === 'number') {
      attributes.seat_limit = args.seatQuantity;
    }

    const flagCtx: FlagContext = { entityType: args.entityType, entityId: args.entityId };
    const authzEnabled = await getBooleanFlag(FLAGS.AUTHZ_ENABLED, false, flagCtx);

    if (!authzEnabled) {
      // Dark deploy: the flag defaults OFF so merging this migration cannot
      // affect production billing until a deliberate flag flip in a deploy
      // window. This is a deliberate skip, not a failure — same `false`
      // return as a swallowed error, since neither case means "synced".
      this.logger.warn(
        `[authz-sync] fuzefront.billing.authz-enabled flag is OFF — skipping Security API ` +
          `sync for ${args.entityType} ${args.entityId}.`,
      );
      return false;
    }

    try {
      const token = await this.getToken();
      await this.authz.setAttributes(
        {
          subject: { type: toSubjectType(args.entityType), key: args.entityId },
          attributes,
        },
        token,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `[authz-sync] failed to sync ${args.entityType} ${args.entityId} → ${args.planTier}/${args.status}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }
}
