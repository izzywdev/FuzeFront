import { Knex } from 'knex'

/**
 * applications-service migration 019 — index for the marketplace review queue
 * (`GET /publication-requests`, contract 1.6.0).
 *
 * The default (and hot) queue is `status=pending`. A PARTIAL index over exactly
 * the pending predicate keeps the scan proportional to the queue length instead
 * of the whole `apps` table; its WHERE is written exactly as the query writes
 * it so the planner can use it. The queue orders by
 * date_trunc('milliseconds', marketplace_submitted_at) (to match the ms-precision
 * cursor), which is STABLE not IMMUTABLE and so cannot be an index key; the
 * index therefore narrows the rows and the (small) pending set is sorted in
 * memory.
 *
 * The approved/rejected views are audit lookups over a handful of rows and are
 * deliberately not indexed (rejected orders by a JSON field).
 *
 * Also defines apps_try_timestamptz(text) (see up()).
 *
 * Idempotent (IF NOT EXISTS / CREATE OR REPLACE) like its siblings: safe to re-run. Adds an index
 * and a pure function only — no data or column change, so no backfill and
 * trivially reversible.
 */
export async function up(knex: Knex): Promise<void> {
  // Total, non-raising text -> timestamptz cast used by the rejected queue's sort
  // key: legacy/hand-edited marketplace_metadata.publication.rejection.rejectedAt
  // values that look like a timestamp but are not one ('2026-01-01Tbogus',
  // '2026-02-30T...', bad zone) must degrade to the created_at fallback, never
  // make the whole queue query raise. CREATE OR REPLACE => idempotent.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION apps_try_timestamptz(v text) RETURNS timestamptz
    LANGUAGE plpgsql STABLE AS $$
    BEGIN
      RETURN v::timestamptz;
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END $$
  `)
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS apps_marketplace_pending_queue_idx
      ON apps (marketplace_submitted_at, slug)
      WHERE marketplace_submitted_at IS NOT NULL
        AND COALESCE(is_marketplace_approved, false) = false
  `)
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS apps_marketplace_pending_queue_idx')
  await knex.raw('DROP FUNCTION IF EXISTS apps_try_timestamptz(text)')
}
