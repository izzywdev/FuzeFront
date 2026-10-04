/**
 * FFRNT-242 — Mirror-not-authority regression test
 *
 * The `selection_list_access` table is a READ-MODEL MIRROR for query
 * performance. It is NOT the authorization source.
 *
 * This test proves that the service always calls the Permit PDP for
 * authorization decisions and never consults the mirror table directly.
 *
 * HOW THE TEST WORKS:
 *   1. Create a list as USER_A (owner). USER_B has NO Permit grant.
 *   2. Directly INSERT a `list-owner` row into `selection_list_access` for
 *      USER_B, bypassing the Permit API (stale/injected mirror row scenario).
 *   3. Make mutating requests as USER_B and assert they are DENIED (403/404).
 *      If the service authorizes from the mirror table, USER_B would succeed —
 *      that is the regression this test catches.
 *
 * PRECONDITION:
 *   A migrated test database must be reachable (TEST_DB_URL, or the DB_* env
 *   vars). CI wires one via the `postgres:15` service + migration step in
 *   `selection-list-service-integration-tests`, so this always holds there —
 *   the earlier "DB unavailable" gap is closed. If the DB is unreachable (e.g.
 *   a local run with no test database) each test FAILS LOUDLY; it is never
 *   silently skipped, so an unverified run can never report a false green.
 *
 * This test does NOT verify implementation internals. It verifies OBSERVABLE
 * BEHAVIOUR: USER_B's API calls are denied even though a mirror row grants them
 * access.
 */

import { rawFetch, makeClient } from '../helpers/client';
import { mintTestToken } from '../helpers/auth';
import {
  insertDirectAccessGrant,
  removeDirectAccessGrant,
  getDbClient,
  closeDb,
} from '../helpers/db';
import { createTestList, purgeList } from '../helpers/factories';
import type { SelectionListId } from '../helpers/factories';

// ---------------------------------------------------------------------------
// Test actors
// ---------------------------------------------------------------------------

const ORG_ID = 'org_01test00000000mirror000000';
const USER_A = 'usr_01test00000000mirrora00000'; // Legitimate owner
const USER_B = 'usr_01test00000000mirrorb00000'; // Has mirror row but no Permit grant

function userAToken(): string {
  return mintTestToken({ userId: USER_A, organizationId: ORG_ID });
}
function userBToken(): string {
  return mintTestToken({ userId: USER_B, organizationId: ORG_ID });
}

// ---------------------------------------------------------------------------
// DB reachability check — run once; an unreachable DB fails every test loudly
// ---------------------------------------------------------------------------

let dbAvailable = false;
let testListId: SelectionListId;

beforeAll(async () => {
  try {
    const client = await getDbClient();
    await client.query('SELECT 1');
    client.release();
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }

  if (!dbAvailable) {
    // Do not set up fixtures. Every test below then fails loudly (see
    // requireDbTest) rather than skip — a silent pass here would be a false
    // green on the mirror-not-authority regression.
    console.warn(
      'mirror-not-authority: test database unreachable — the suite will FAIL ' +
      '(not skip). Set TEST_DB_URL (or DB_* env vars) to a migrated test database.'
    );
    return;
  }

  // Only reached when DB is available
  const clientA = makeClient(userAToken);
  const list = await createTestList(clientA, {
    key: 'mirror-test-' + Math.random().toString(16).slice(2, 8),
    name: 'Mirror Not Authority Test',
  });
  testListId = list.id as SelectionListId;
});

afterAll(async () => {
  if (dbAvailable && testListId) {
    await removeDirectAccessGrant(testListId, USER_B).catch(() => { /* already gone */ });
    const clientA = makeClient(userAToken);
    await purgeList(clientA, testListId);
  }
  await closeDb();
});

// ---------------------------------------------------------------------------
// Helper: require a reachable DB; fail the test loudly if it is not
// ---------------------------------------------------------------------------

function requireDbTest(name: string, fn: () => Promise<void>) {
  // The DB decision must be made when the test RUNS: `dbAvailable` is only set
  // later, in beforeAll. (An earlier version branched at *definition* time, when
  // it was always false, registering every test as `test.todo` — the file
  // reported green while asserting nothing, a vacuous pass on the suite's
  // central security regression.) Jest has no runtime skip, and a silent
  // `return` would be a false green, so an unreachable DB fails the test loudly.
  test(name, async () => {
    if (!dbAvailable) {
      throw new Error(
        'mirror-not-authority cannot run: test database unreachable. ' +
          'Set TEST_DB_URL (or DB_* env vars) to a migrated test database.'
      );
    }
    await fn();
  }, 30_000);
}

// ---------------------------------------------------------------------------
// The critical regression tests
// ---------------------------------------------------------------------------

describe('FFRNT-242: selection_list_access mirror cannot authorize', () => {
  beforeEach(async () => {
    if (!dbAvailable || !testListId) return;
    await insertDirectAccessGrant({
      list_id: testListId,
      user_id: USER_B,
      org_id: ORG_ID,
      role: 'list-owner',
      granted_by: USER_A,
    });
  });

  afterEach(async () => {
    if (!dbAvailable || !testListId) return;
    await removeDirectAccessGrant(testListId, USER_B).catch(() => { /* already gone */ });
  });

  requireDbTest('USER_B cannot read the list despite the injected mirror row', async () => {
    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(testListId)}`,
      { method: 'GET', token: userBToken() }
    );
    // 404 is the correct response per spec: "a read the caller is not entitled to
    // returns 404, not 403, so the API is not an existence oracle"
    expect([403, 404]).toContain(status);
    expect(status).not.toBe(200);
  });

  requireDbTest('USER_B cannot update the list despite the injected mirror row', async () => {
    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(testListId)}`,
      {
        method: 'PATCH',
        token: userBToken(),
        body: JSON.stringify({ name: 'Hijacked Name' }),
      }
    );
    expect(status).toBe(403);
    expect(status).not.toBe(200);
  });

  requireDbTest('USER_B cannot add items to the list despite the injected mirror row', async () => {
    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(testListId)}/items`,
      {
        method: 'POST',
        token: userBToken(),
        body: JSON.stringify({ code: 'INJ', label: 'Injected Item' }),
      }
    );
    expect(status).toBe(403);
  });

  requireDbTest('USER_B cannot manage access despite the injected mirror row', async () => {
    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(testListId)}/access`,
      { method: 'GET', token: userBToken() }
    );
    expect([403, 404]).toContain(status);
    expect(status).not.toBe(200);
  });

  requireDbTest('USER_B cannot delete the list despite the injected mirror row', async () => {
    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(testListId)}`,
      { method: 'DELETE', token: userBToken() }
    );
    expect([403, 404]).toContain(status);
    expect(status).not.toBe(200);
    expect(status).not.toBe(204); // 204 = purged = unauthorized success
  });

  requireDbTest('USER_B cannot translate the list despite the injected mirror row', async () => {
    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(testListId)}/translations/fr`,
      {
        method: 'PUT',
        token: userBToken(),
        body: JSON.stringify({ name: 'Traduction injectée' }),
      }
    );
    expect(status).toBe(403);
  });

  requireDbTest('USER_A requests are still served normally (no collateral damage)', async () => {
    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(testListId)}`,
      { method: 'GET', token: userAToken() }
    );
    expect(status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// PDP liveness test
// ---------------------------------------------------------------------------

describe('FFRNT-242: PDP is consulted on every mutating request', () => {
  requireDbTest(
    'revoking Permit grant immediately revokes access (PDP is live, not cached)',
    async () => {
      const clientA = makeClient(userAToken);
      const tempList = await createTestList(clientA, {
        key: 'pdp-live-' + Math.random().toString(16).slice(2, 8),
        name: 'PDP Live Test',
      });

      // Grant USER_B via Permit (the real way)
      await clientA.setAccess(tempList.id as SelectionListId, USER_B, 'list-viewer');

      const { status: statusGranted } = await rawFetch(
        `/v1/selection-lists/${encodeURIComponent(tempList.id)}`,
        { method: 'GET', token: userBToken() }
      );
      expect(statusGranted).toBe(200);

      // Revoke via Permit
      await clientA.revokeAccess(tempList.id as SelectionListId, USER_B);

      const { status: statusRevoked } = await rawFetch(
        `/v1/selection-lists/${encodeURIComponent(tempList.id)}`,
        { method: 'GET', token: userBToken() }
      );
      expect([403, 404]).toContain(statusRevoked);

      await purgeList(clientA, tempList.id as SelectionListId);
    }
  );
});
