import { Organization } from '../types/shared';
import { EventPublisher } from './eventPublisher';
import type { Knex } from 'knex';
/**
 * Plan B — tenant provisioning that is correct, idempotent, and self-healing.
 *
 * The DB table `organization_provisioning` is the source of truth for each org's
 * Permit wiring. The reconciler runs missing/failed steps in dependency order,
 * skips `done` steps, records failures, and flips the org to `active` once every
 * step is done. It is safe to call repeatedly (org-create, login, internal HTTP).
 */
export declare const PROVISIONING_STEPS: readonly ["permit_user_sync", "permit_tenant_create", "permit_role_assign", "welcome_email"];
export type ProvisioningStep = (typeof PROVISIONING_STEPS)[number];
/** Externals injected for testing (no real Permit cloud / broker needed). */
export interface ProvisioningPermitClient {
    syncUser(org: Organization, ownerEmail: string): Promise<void>;
    createTenant(org: Organization): Promise<void>;
    assignOwnerRole(org: Organization): Promise<void>;
}
export interface ProvisioningDeps {
    db: Knex;
    permit: ProvisioningPermitClient;
    publish: EventPublisher;
}
/**
 * Default Permit client built on the existing utils. Each call throws on a real
 * failure (so the step records `failed`) and resolves on success / benign 409.
 */
export declare const defaultPermitClient: ProvisioningPermitClient;
/**
 * Idempotently ensure the user has exactly ONE personal org (type='personal')
 * with an owner membership. Returns the personal org. Re-running is a no-op.
 */
export declare function ensurePersonalOrg(userId: string, overrides?: Partial<ProvisioningDeps>): Promise<Organization>;
/**
 * Idempotent, dependency-ordered reconciliation of an org's Permit provisioning.
 * Skips `done` steps; retries `pending`/`failed`; records `last_error` and bumps
 * `attempts` on failure; flips org to `active` when all steps are done.
 * Returns the org's final provisioning_state.
 */
export declare function reconcileOrganizationProvisioning(orgId: string, overrides?: Partial<ProvisioningDeps>): Promise<'active' | 'pending' | 'failed'>;
/**
 * Single-sourced entry point used by login self-heal AND the internal HTTP
 * endpoint (Plan D's provisioning-service). Ensures the user's personal org
 * exists, then reconciles every org they own that isn't yet active.
 */
export declare function runInternalProvision(userId: string, overrides?: Partial<ProvisioningDeps>): Promise<{
    personalOrgId: string;
    reconciled: Array<{
        orgId: string;
        state: string;
    }>;
}>;
//# sourceMappingURL=organizationProvisioning.d.ts.map