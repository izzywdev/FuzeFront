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
 * Idempotent (IF NOT EXISTS) like its siblings: safe to re-run. Adds an index
 * only — no data or column change, so no backfill and trivially reversible.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS apps_marketplace_pending_queue_idx
      ON apps (marketplace_submitted_at, slug)
      WHERE marketplace_submitted_at IS NOT NULL
        AND COALESCE(is_marketplace_approved, false) = false
  `)
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS apps_marketplace_pending_queue_idx')
}
