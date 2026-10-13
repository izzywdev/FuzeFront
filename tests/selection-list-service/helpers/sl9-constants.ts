/**
 * Import-free constants shared by helpers/global-setup.ts (which runs outside the test module
 * graph) and the SL9 suites. See helpers/shared-lists.ts for how the feature is switched on.
 */

/** The platform organization (FuzeFront's root org) as the service under test is configured with it
 *  (`SELECTION_LIST_PLATFORM_ORG_ID`). Override with TEST_PLATFORM_ORG_ID in both places. */
export const PLATFORM_ORG_ID: string = process.env['TEST_PLATFORM_ORG_ID'] ?? 'org_01test00000000platform00000';

/** Org capped at ONE active list (fork `org_lists` quota refusal). Seeded by global-setup. */
export const FORK_QUOTA_LISTS_ORG_ID = 'org_01test0000000forkqlists0000';
/** Org whose per-list item ceiling is 2 (fork `list_items` quota refusal). Seeded by global-setup. */
export const FORK_QUOTA_ITEMS_ORG_ID = 'org_01test0000000forkqitems0000';
/** Org whose per-list item ceiling is 10000 so only the fork's own 5000-item cap can refuse (400). */
export const FORK_BIG_ORG_ID = 'org_01test0000000forkbig00000000';
