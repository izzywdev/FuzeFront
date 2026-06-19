import { Knex } from 'knex';
/**
 * Plan B — provisioning backbone.
 *
 * - Adds 'personal' to the organization type enum (personal workspace orgs).
 * - Tracks per-org Permit provisioning as resumable steps so reconciliation is
 *   idempotent and self-healing.
 * - Adds organization_invitations (used by Plan G; created now).
 * - Adds event_outbox so first-time-user / email events are durably recorded
 *   even if the Kafka publish fails (best-effort publish, guaranteed record).
 *
 * NOTE: no role/DB DDL here — that is the privileged bootstrap's job (A0).
 */
export declare const config: {
    transaction: boolean;
};
export declare function up(knex: Knex): Promise<void>;
export declare function down(knex: Knex): Promise<void>;
//# sourceMappingURL=009_provisioning_backbone.d.ts.map