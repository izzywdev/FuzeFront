import { Pool } from 'pg';
import { FuzeEvent, IdentityOrgDeletedPayloadV1 } from '@fuzefront/shared/kafka';

/**
 * Reacts to `identity.org.deleted`.
 *
 * SOFT IS A DEACTIVATION, AND IT MUST NOT DESTROY ANYTHING.
 *
 * identity.org.deleted's schema says it outright: "`cascade` distinguishes a
 * soft delete (deactivation — `organizations.is_active = false`, the current
 * behaviour) from a hard delete (row removed); consumers deactivate vs. purge
 * accordingly" (shared/src/kafka/schemas/identity.org.deleted.ts).
 *
 * A deactivated organization still EXISTS and can be reactivated. Deleting its
 * config overrides on that event would silently destroy configuration that a
 * later reactivation is expected to restore — data loss triggered by a
 * reversible admin action. Every emitter in this repo sends `soft` today
 * (backend/security/src/routes/organizations.ts, which answers "Organization
 * deactivated successfully"), so treating the two modes alike would have meant
 * purging on every real-world deletion event.
 *
 *   cascade='soft'  -> NO-OP. The org may come back; its overrides must survive.
 *                      config_values has no is_active column to flip, and it
 *                      needs none: the rows are inert while the org is
 *                      deactivated because nothing resolves config for it.
 *   cascade='hard'  -> DELETE config_values at (scope_type='org', scope_id=<org>).
 *                      The organization row is gone for good, so its sparse
 *                      overrides can never resolve again.
 *
 * config_history is never touched in EITHER mode. Migration 004 states the
 * invariant directly — "history rows are never deleted by this service" —
 * which is why `revert_of REFERENCES config_history(id)` carries no ON DELETE
 * action. Purging history would break that invariant AND raise a foreign-key
 * violation as soon as a surviving row reverted a deleted one. An org being
 * deleted is exactly when "who changed this, and when" matters most.
 *
 * Idempotent: a hard delete affecting 0 rows is a logged no-op, which Kafka's
 * at-least-once delivery requires.
 */
export async function handleOrgDeleted(
  pool: Pool,
  event: FuzeEvent<IdentityOrgDeletedPayloadV1>,
): Promise<void> {
  const { organizationId, cascade } = event.payload;

  if (cascade !== 'hard') {
    // eslint-disable-next-line no-console
    console.log(
      '[config-service] org.deleted(cascade=%s): org %s was DEACTIVATED, not removed — ' +
        'config overrides retained so a reactivation restores them (correlationId=%s)',
      cascade,
      organizationId,
      event.correlationId,
    );
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `DELETE FROM config.config_values
        WHERE scope_type = 'org' AND scope_id = $1`,
      [organizationId],
    );
    await client.query('COMMIT');

    const deleted = res.rowCount ?? 0;
    // eslint-disable-next-line no-console
    console.log(
      '[config-service] org.deleted(cascade=hard): removed %d config override(s) for org %s (history retained, correlationId=%s)',
      deleted,
      organizationId,
      event.correlationId,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
