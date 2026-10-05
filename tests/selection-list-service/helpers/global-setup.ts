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

/**
 * Review M-4 orgs (contract/quota-enforcement.test.ts), each seeded with the override row the service
 * itself reads: a per-user ceiling of 2 and a locale ceiling of 2; and an org capped at 1 ACTIVE list,
 * whose hard storage ceiling (active limit x the service's default factor of 10) is therefore 10.
 */
/**
 * Orgs whose suites legitimately create MORE than the default 20 active lists as ONE user (the outbox suite
 * walks every mutating route on fresh lists and never purges them). `user_lists` is enforced now (review M-4),
 * so they get a generous per-user override row instead of an exemption in the service.
 */
export const HIGH_CHURN_TEST_ORG_IDS = ['org_01test0000000outbox00000000', 'org_01test0000000outbox00000001'];

export const QUOTA_USER_TEST_ORG_ID = 'org_01test00000000qusrl0000000';
export const QUOTA_STORAGE_TEST_ORG_ID = 'org_01test00000000storag000000';

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
      await client.query(
        `INSERT INTO selection_list_org_quota
           (organization_id, max_lists_per_user, max_locales, updated_by, updated_at)
         VALUES ($1, 2, 2, 'jest-global-setup', NOW())
         ON CONFLICT (organization_id) DO UPDATE SET
           max_lists_per_user = EXCLUDED.max_lists_per_user,
           max_locales = EXCLUDED.max_locales,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [QUOTA_USER_TEST_ORG_ID],
      );
      await client.query(
        `INSERT INTO selection_list_org_quota
           (organization_id, max_lists, updated_by, updated_at)
         VALUES ($1, 1, 'jest-global-setup', NOW())
         ON CONFLICT (organization_id) DO UPDATE SET
           max_lists = EXCLUDED.max_lists,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
        [QUOTA_STORAGE_TEST_ORG_ID],
      );
      for (const org of HIGH_CHURN_TEST_ORG_IDS) {
        await client.query(
          `INSERT INTO selection_list_org_quota
             (organization_id, max_lists_per_user, updated_by, updated_at)
           VALUES ($1, 1000, 'jest-global-setup', NOW())
           ON CONFLICT (organization_id) DO UPDATE SET
             max_lists_per_user = EXCLUDED.max_lists_per_user,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
          [org],
        );
      }
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
