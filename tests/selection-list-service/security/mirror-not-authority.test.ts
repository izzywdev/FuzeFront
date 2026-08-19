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
 *   TEST_DB_URL (or DB_* env vars) must point to the test database.
 *   If the DB is not available, the tests are SKIPPED (explicitly, with a gap
 *   marker) — not silently passed.
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
// DB availability check — run once and conditionally skip all tests
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
    // Emit a visible gap marker — a silent return would be a false green.
    // Tests below use `test.skipIf` at the describe level.
    console.warn(
      '[FLAGGED GAP] FFRNT-242 mirror-not-authority: DB unavailable — all tests SKIPPED. ' +
      'Set TEST_DB_URL (or DB_* env vars) to run this suite against a real DB.'
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
// Helper: skip when DB not available (produces visible SKIP in Jest output)
// ---------------------------------------------------------------------------

function skipIfNoDb(name: string, fn: () => Promise<void>) {
  // Use test.skip when DB is not available so the skip is reported, not hidden.
  if (!dbAvailable) {
    test.todo(`${name} [DB UNAVAILABLE — FFRNT-242 gap]`);
  } else {
    test(name, fn, 30_000);
  }
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
      organization_id: ORG_ID,
      role: 'list-owner',
      granted_by: USER_A,
    });
  });

  afterEach(async () => {
    if (!dbAvailable || !testListId) return;
    await removeDirectAccessGrant(testListId, USER_B).catch(() => { /* already gone */ });
  });

  skipIfNoDb('USER_B cannot read the list despite the injected mirror row', async () => {
    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(testListId)}`,
      { method: 'GET', token: userBToken() }
    );
    // 404 is the correct response per spec: "a read the caller is not entitled to
    // returns 404, not 403, so the API is not an existence oracle"
    expect([403, 404]).toContain(status);
    expect(status).not.toBe(200);
  });

  skipIfNoDb('USER_B cannot update the list despite the injected mirror row', async () => {
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

  skipIfNoDb('USER_B cannot add items to the list despite the injected mirror row', async () => {
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

  skipIfNoDb('USER_B cannot manage access despite the injected mirror row', async () => {
    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(testListId)}/access`,
      { method: 'GET', token: userBToken() }
    );
    expect([403, 404]).toContain(status);
    expect(status).not.toBe(200);
  });

  skipIfNoDb('USER_B cannot delete the list despite the injected mirror row', async () => {
    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(testListId)}`,
      { method: 'DELETE', token: userBToken() }
    );
    expect([403, 404]).toContain(status);
    expect(status).not.toBe(200);
    expect(status).not.toBe(204); // 204 = purged = unauthorized success
  });

  skipIfNoDb('USER_B cannot translate the list despite the injected mirror row', async () => {
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

  skipIfNoDb('USER_A requests are still served normally (no collateral damage)', async () => {
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
  skipIfNoDb(
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
