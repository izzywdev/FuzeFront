import { Pool } from 'pg';
import { FuzeEvent, IdentityUserDeletedPayloadV1 } from '@fuzefront/shared/kafka';

/**
 * Reacts to `identity.user.deleted` with two distinct operations, in one
 * transaction:
 *
 *   1. DELETE the user's own config overrides — config_values rows at
 *      (scope_type='user', scope_id=<user>). Same reasoning as the org
 *      handler: scope ids are never reused, so these can never resolve again.
 *
 *   2. ANONYMISE authorship left on rows that SURVIVE — config_values.
 *      set_by_user_id is a plain nullable UUID recording who last wrote a
 *      value. A platform/portal/org-scoped value written by the deleted user
 *      must stay (it still applies to live scopes), but it should not keep
 *      pointing at a user that no longer exists, so the column is NULLed.
 *      Deleting those rows instead would silently change live configuration
 *      for other tenants, which is a far worse outcome than a missing author.
 *
 * Order matters: the DELETE runs first, so the UPDATE does not bother
 * rewriting rows that are about to disappear anyway.
 *
 * config_history.actor_id is deliberately NOT anonymised. Two reasons, and
 * this is a judgement worth surfacing rather than burying:
 *   - migration 004 documents "NULL exactly when actor_type = 'system'".
 *     NULLing actor_id while actor_type stays 'user' would make a human action
 *     indistinguishable from a system one to every reader of that table and to
 *     openapi.yaml's Actor schema — corrupting the audit log rather than
 *     redacting it.
 *   - that same migration states history rows are never deleted by this
 *     service, i.e. the table is an append-only audit trail by design.
 * If the deleted user's id must also be erased from history (a
 * right-to-erasure requirement rather than a referential one), that needs a
 * schema change — an explicit `actor_redacted` flag or a sentinel actor_type —
 * not a silent NULL. Flagged for the owner; not decided here.
 *
 * `cascade` is accepted and logged; as with the org handler both modes behave
 * identically, since the only table left to purge is the audit log.
 *
 * Idempotent: a user with no overrides and no authorship is a logged no-op.
 */
export async function handleUserDeleted(
  pool: Pool,
  event: FuzeEvent<IdentityUserDeletedPayloadV1>,
): Promise<void> {
  const { userId, cascade } = event.payload;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const deletedRes = await client.query(
      `DELETE FROM config.config_values
        WHERE scope_type = 'user' AND scope_id = $1`,
      [userId],
    );

    const anonymisedRes = await client.query(
      `UPDATE config.config_values
          SET set_by_user_id = NULL,
              updated_at = now()
        WHERE set_by_user_id = $1`,
      [userId],
    );

    await client.query('COMMIT');

    const deleted = deletedRes.rowCount ?? 0;
    const anonymised = anonymisedRes.rowCount ?? 0;

    if (deleted === 0 && anonymised === 0) {
      // eslint-disable-next-line no-console
      console.log(
        '[config-service] user.deleted: user %s had no overrides and no authorship — no-op (correlationId=%s)',
        userId,
        event.correlationId,
      );
      return;
    }

    // eslint-disable-next-line no-console
    console.log(
      '[config-service] user.deleted: removed %d user-scoped override(s) and anonymised authorship on %d surviving row(s) for user %s (cascade=%s, history retained, correlationId=%s)',
      deleted,
      anonymised,
      userId,
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
