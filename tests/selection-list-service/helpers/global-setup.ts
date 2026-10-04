/**
 * Jest globalSetup — seeds the test-mode quota ceilings.
 *
 * contract/quota.test.ts is "written to a test-mode configuration" with small
 * ceilings (org_lists = TEST_QUOTA_ORG_LISTS, list_items = TEST_QUOTA_LIST_ITEMS).
 * The service's own, production mechanism for a non-default ceiling is the
 * per-org override row in `selection_list_org_quota` — so the harness seeds
 * exactly that row, for exactly the org the quota suite acts as. A service-wide
 * ceiling would instead cap every OTHER suite's org at 3 lists too (several of
 * them legitimately hold more), and an env switch that lowers ceilings inside
 * the service would be a prod footgun; the override row is neither.
 *
 * Skipped (loudly) when the DB is unreachable, like the mirror-not-authority
 * suite — the quota-ceiling tests then fail on their own assertions rather than
 * this hook masking the cause.
 */
import { getDbClient, closeDb } from './db';

/** The org contract/quota.test.ts acts as (its ORG_ID constant). */
export const QUOTA_TEST_ORG_ID = 'org_01test00000000quota0000000';

export default async function globalSetup(): Promise<void> {
  const orgLists = parseInt(process.env['TEST_QUOTA_ORG_LISTS'] ?? '3', 10);
  const listItems = parseInt(process.env['TEST_QUOTA_LIST_ITEMS'] ?? '5', 10);
  try {
    const client = await getDbClient();
    try {
      await client.query(
        `INSERT INTO selection_list_org_quota
           (organization_id, max_lists, max_items_per_list, updated_by, updated_at)
         VALUES ($1, $2, $3, 'jest-global-setup', NOW())
         ON CONFLICT (organization_id) DO UPDATE SET
           max_lists = EXCLUDED.max_lists,
           max_items_per_list = EXCLUDED.max_items_per_list,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [QUOTA_TEST_ORG_ID, orgLists, listItems],
      );
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn(
      '[FLAGGED GAP] quota ceilings NOT seeded (DB unavailable) — quota-ceiling tests will fail: ' +
        (err as Error).message,
    );
  } finally {
    await closeDb();
  }
}
