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
 *        3. REDACT the deleted user's id from config_history (hard only).
 *           DECIDED 2026-10-04 (migration 005): right-to-erasure requires the
 *           user's id to leave the audit trail too, but a silent
 *           `actor_id = NULL` would be indistinguishable from a system action
 *           (migration 004's invariant: actor_id NULL iff actor_type='system').
 *           So erasure is explicit: on a 'user' row authored by this user,
 *           `actor_id` goes NULL and `actor_redacted` goes TRUE while
 *           `actor_type` stays 'user'. This is the ONE sanctioned in-place
 *           mutation of an otherwise append-only table, and it changes only WHO
 *           — action/old_value/new_value/occurred_at are untouched, so the
 *           record of WHAT changed is preserved.
 *
 * Why a flag and not a sentinel: the sibling selection-list-service erases its
 * TEXT authorship columns with a '[deleted-user]' string, but config_history
 * .actor_id is a native UUID surfaced as a TypeID id — a fabricated sentinel id
 * would be forbidden by governance/identifier-standard.md and would read as a
 * real user. A UUID column takes a flag; a TEXT column takes a sentinel. Do not
 * "harmonise" the two.
 *
 * SOFT retains history authorship unchanged: a deactivated user can be
 * reactivated, so their authorship is restorable state, not erasable.
 *
 * Idempotent: a hard delete with no overrides, no authorship and no history is
 * a logged no-op, which Kafka's at-least-once delivery requires.
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

    // Right-to-erasure: redact the user's id from the append-only audit trail
    // without destroying the record that a user (not the system) acted. See
    // migration 005 and the header comment.
    const redactedRes = await client.query(
      `UPDATE config.config_history
          SET actor_id = NULL,
              actor_redacted = TRUE
        WHERE actor_type = 'user' AND actor_id = $1`,
      [userId],
    );

    await client.query('COMMIT');

    const deleted = deletedRes.rowCount ?? 0;
    const anonymised = anonymisedRes.rowCount ?? 0;
    const redacted = redactedRes.rowCount ?? 0;

    if (deleted === 0 && anonymised === 0 && redacted === 0) {
      // eslint-disable-next-line no-console
      console.log(
        '[config-service] user.deleted(cascade=hard): user %s had no overrides, no authorship and no history — no-op (correlationId=%s)',
        userId,
        event.correlationId,
      );
      return;
    }

    // eslint-disable-next-line no-console
    console.log(
      '[config-service] user.deleted(cascade=hard): removed %d user-scoped override(s), anonymised authorship on %d surviving row(s), and redacted %d history entr(ies) for user %s (correlationId=%s)',
      deleted,
      anonymised,
      redacted,
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
