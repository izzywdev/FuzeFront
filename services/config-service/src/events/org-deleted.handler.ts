import { Pool } from 'pg';
import { FuzeEvent, IdentityOrgDeletedPayloadV1 } from '@fuzefront/shared/kafka';

/**
 * Reacts to `identity.org.deleted` by removing the deleted organization's
 * config OVERRIDES, so an org that no longer exists stops carrying settings
 * rows forever.
 *
 * WHAT IS DELETED, AND WHAT DELIBERATELY IS NOT.
 *
 *   config_values  — DELETED for (scope_type='org', scope_id=<org>). These are
 *                    the sparse per-org overrides. Once the org is gone they
 *                    can never resolve again (scope ids are minted per entity
 *                    and never reused), so they are pure dead weight.
 *
 *   config_history — NOT touched. migration 004 states the invariant directly:
 *                    "history rows are never deleted by this service", which is
 *                    why `revert_of REFERENCES config_history(id)` carries no
 *                    ON DELETE action. Deleting history here would (a) break
 *                    that documented invariant and (b) raise a foreign-key
 *                    violation the moment any surviving row reverts a deleted
 *                    one. The audit trail is the point of that table: an org
 *                    being deleted is precisely when "who changed this, and
 *                    when" matters most.
 *
 * `cascade` ('soft' | 'hard') is accepted and logged, but both modes behave
 * identically here, and that is deliberate rather than an oversight:
 *   - there is no is_active/soft-delete column on config_values to flip, and
 *   - the only other table holding org data is the audit log, which the
 *     invariant above puts out of scope for BOTH modes.
 * So the strongest action available is already the safe one. Documented rather
 * than silently ignored — selection-list-service's user-deleted handler makes
 * the same "soft and hard are equivalent here" call for the same reason.
 *
 * Idempotent: an org with no overrides deletes 0 rows and logs a no-op, so a
 * redelivered message (Kafka is at-least-once) is harmless.
 */
export async function handleOrgDeleted(
  pool: Pool,
  event: FuzeEvent<IdentityOrgDeletedPayloadV1>,
): Promise<void> {
  const { organizationId, cascade } = event.payload;

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
      '[config-service] org.deleted: removed %d config override(s) for org %s (cascade=%s, history retained, correlationId=%s)',
      deleted,
      organizationId,
      cascade,
      event.correlationId,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
