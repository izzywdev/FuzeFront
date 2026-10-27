import { testOrg } from './ids';

/**
 * Constants shared by helpers/global-setup.ts (which runs outside the test module
 * graph) and the SL9 suites. Org ids are minted codec-valid (helpers/ids.ts). See helpers/shared-lists.ts for how the feature is switched on.
 */

/** The platform organization (FuzeFront's root org) as the service under test is configured with it
 *  (`SELECTION_LIST_PLATFORM_ORG_ID`). Override with TEST_PLATFORM_ORG_ID in both places. */
export const PLATFORM_ORG_ID: string = process.env['TEST_PLATFORM_ORG_ID'] ?? 'org_01jpmf4z1yf88rpb9z9sd6pz00';

/** Org capped at ONE active list (fork `org_lists` quota refusal). Seeded by global-setup. */
export const FORK_QUOTA_LISTS_ORG_ID = testOrg('forkqlists');
/** Org whose per-list item ceiling is 2 (fork `list_items` quota refusal). Seeded by global-setup. */
export const FORK_QUOTA_ITEMS_ORG_ID = testOrg('forkqitems');
/** Org whose per-list item ceiling is 10000 so only the fork's own 5000-item cap can refuse (400). */
export const FORK_BIG_ORG_ID = testOrg('forkbig');

// ---- platform-org TRUST fixtures (service 1.1.0: SELECTION_LIST_PLATFORM_ORG_ID is the only source of the platform
// org, and counts only once selection_list_ref_index shows an ACTIVE, is_active=true row typed 'platform' for it) ----

/** An org the projection types 'platform' (active) that is NOT the configured platform org: must get nothing. Seeded by global-setup. */
export const DECOY_PLATFORM_ORG_ID = testOrg('decoyplatform');
/** Configured by the "unconfirmed" instance; has NO projection row until a test confirms it. */
export const UNCONFIRMED_PLATFORM_ORG_ID = testOrg('unconfirmedplat');
/** Configured by the "deactivated" instance; projected as type platform but is_active=false until a test activates it. */
export const DEACTIVATED_PLATFORM_ORG_ID = testOrg('deactivatedplat');

// ---- platform-org SUSPENSION fixtures (contract/shared-lists-platform-suspension.test.ts) ----

/**
 * The platform org of the two dedicated SUSPENSION instances (CI ports 3016 flags ON / 3017 shared-lists flag OFF). The suite
 * deactivates and reactivates it, so it must be NOBODY else's platform org: suspending the main one would fail every
 * parallel suite's writes. The suite confirms it in the projection through the identity.org.created handler (no SQL back
 * door) and tells the stand-in Security API publish_platform is effective in its tenant. A literal in ci.yml (the service
 * refuses any value that is not a canonical TypeID), pinned by contract/harness-ids.test.ts.
 */
export const SUSPENDABLE_PLATFORM_ORG_ID = testOrg('suspendableplat');
