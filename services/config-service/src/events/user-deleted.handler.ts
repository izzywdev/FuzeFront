import { Pool } from 'pg';
import { FuzeEvent, IdentityUserDeletedPayloadV1 } from '@fuzefront/shared/kafka';

/**
 * Reacts to `identity.user.deleted`.
 *
 * SOFT IS A DEACTIVATION, AND IT MUST NOT DESTROY ANYTHING.
 *
 * identity.user.deleted's schema says "`cascade` distinguishes deactivation
 * from hard removal" (shared/src/kafka/schemas/identity.user.deleted.ts), and
 * every emitter in this repo sends `soft` today
 * (backend/security/src/routes/me.ts). A deactivated user can be restored, so
 * purging their overrides — or wiping their authorship from rows that survive
 * — would destroy state a later reactivation is expected to bring back.
 *
 *   cascade='soft'  -> NO-OP.
 *   cascade='hard'  -> two operations, in ONE transaction:
 *
 *        1. DELETE the user's own overrides: config_values at
 *           (scope_type='user', scope_id=<user>). The user row is gone for
 *           good, so these can never resolve again.
 *
 *        2. ANONYMISE authorship left on rows that SURVIVE.
 *           config_values.set_by_user_id is a plain nullable UUID recording
 *           who last wrote a value. A platform/portal/org-scoped value written
 *           by the deleted user must STAY — it still applies to live scopes —
 *           but it should not keep pointing at a user that no longer exists,
 *           so the column is NULLed. Deleting those rows instead would
 *           silently change live configuration for other tenants, which is a
 *           far worse outcome than a missing author.
 *
 *      Order matters: the DELETE runs first, so the UPDATE does not bother
 *      rewriting rows that are about to disappear anyway.
 *
 * config_history.actor_id is deliberately NOT anonymised, in either mode. Two
 * reasons, and this is a judgement worth surfacing rather than burying:
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
 * Idempotent: a hard delete with no overrides and no authorship is a logged
 * no-op, which Kafka's at-least-once delivery requires.
 */
export async function handleUserDeleted(
  pool: Pool,
  event: FuzeEvent<IdentityUserDeletedPayloadV1>,
): Promise<void> {
  const { userId, cascade } = event.payload;

  if (cascade !== 'hard') {
    // eslint-disable-next-line no-console
    console.log(
      '[config-service] user.deleted(cascade=%s): user %s was DEACTIVATED, not removed — ' +
        'overrides and authorship retained so a reactivation restores them (correlationId=%s)',
      cascade,
      userId,
      event.correlationId,
    );
    return;
  }

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
        '[config-service] user.deleted(cascade=hard): user %s had no overrides and no authorship — no-op (correlationId=%s)',
        userId,
        event.correlationId,
      );
      return;
    }

    // eslint-disable-next-line no-console
    console.log(
      '[config-service] user.deleted(cascade=hard): removed %d user-scoped override(s) and anonymised authorship on %d surviving row(s) for user %s (history retained, correlationId=%s)',
      deleted,
      anonymised,
      userId,
      event.correlationId,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
