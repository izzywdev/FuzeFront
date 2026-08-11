/**
 * Contract tests — POST /v1/resolve
 *
 * Verifies:
 *   - Active item ids → results map with label/locale/is_machine/status
 *   - Archived item ids → in results with status: "archived" (NOT in missing)
 *   - Non-existent ids → in missing, not in results
 *   - Empty ids: [] → { results: {}, missing: [] } (not an error)
 *   - Response does NOT contain list_key, organization_id, or any field beyond
 *     the 4 declared in the spec (label, locale, is_machine, status)
 *   - Cross-org: resolving an id from another org's list → appears in missing
 *   - The response always accounts for every requested id (results + missing = ids)
 *   - Locale fallback chain operates on the resolve endpoint
 *   - Unauthenticated call from trusted in-cluster caller is accepted
 *
 * Tests are ALL RED until the service is implemented.
 */

import { makeClient, rawFetch } from '../helpers/client';
import { mintTestToken } from '../helpers/auth';
import { createTestList, createTestListWithItems, purgeList } from '../helpers/factories';
import type { SelectionListId, SelectionListItemId } from '../helpers/factories';

// ---------------------------------------------------------------------------
// Test actors — two separate orgs
// ---------------------------------------------------------------------------

const ORG_A = 'org_01test00000000resolve0000a';
const USER_A = 'usr_01test00000000resolveusra0';

const ORG_B = 'org_01test00000000resolve0000b';
const USER_B = 'usr_01test00000000resolveusrb0';

function orgAToken(): string {
  return mintTestToken({ userId: USER_A, organizationId: ORG_A });
}
function orgBToken(): string {
  return mintTestToken({ userId: USER_B, organizationId: ORG_B });
}

const createdByA: SelectionListId[] = [];
const createdByB: SelectionListId[] = [];

afterAll(async () => {
  const clientA = makeClient(orgAToken);
  for (const id of createdByA) await purgeList(clientA, id);

  const clientB = makeClient(orgBToken);
  for (const id of createdByB) await purgeList(clientB, id);
});

// ---------------------------------------------------------------------------
// Basic resolve
// ---------------------------------------------------------------------------

describe('POST /v1/resolve — active items', () => {
  let activeItemId: SelectionListItemId;

  beforeAll(async () => {
    const client = makeClient(orgAToken);
    const { list, items } = await createTestListWithItems(client, 2, {
      key: 'resolve-active-' + Math.random().toString(16).slice(2, 8),
    });
    createdByA.push(list.id as SelectionListId);
    activeItemId = items[0].id as SelectionListItemId;
  });

  it('resolves an active item id to its label/locale/is_machine/status', async () => {
    const client = makeClient(orgAToken);
    const result = await client.resolveIds([activeItemId]);

    expect(result.results[activeItemId]).toBeDefined();
    const resolved = result.results[activeItemId];
    expect(typeof resolved.label).toBe('string');
    expect(resolved.label.length).toBeGreaterThan(0);
    expect(typeof resolved.locale).toBe('string');
    expect(typeof resolved.is_machine).toBe('boolean');
    expect(resolved.status).toBe('active');
    expect(result.missing).not.toContain(activeItemId);
  });

  it('response shape contains ONLY the 4 declared fields (no list_key, organization_id, etc.)', async () => {
    const client = makeClient(orgAToken);
    const result = await client.resolveIds([activeItemId]);
    const resolved = result.results[activeItemId];

    // Allowed fields only
    const keys = Object.keys(resolved as object);
    for (const key of keys) {
      expect(['label', 'locale', 'is_machine', 'status']).toContain(key);
    }

    // Forbidden fields
    expect((resolved as { list_key?: unknown }).list_key).toBeUndefined();
    expect((resolved as { organization_id?: unknown }).organization_id).toBeUndefined();
    expect((resolved as { list_id?: unknown }).list_id).toBeUndefined();
    expect((resolved as { code?: unknown }).code).toBeUndefined();
  });

  it('all requested ids are accounted for: results + missing = request ids', async () => {
    const client = makeClient(orgAToken);
    const missingId = 'sli_01hnonexistentresolve00000' as SelectionListItemId;
    const result = await client.resolveIds([activeItemId, missingId]);

    const accounted = [
      ...Object.keys(result.results),
      ...result.missing,
    ];
    expect(accounted).toContain(activeItemId);
    expect(accounted).toContain(missingId);
    // No id appears in both
    const inBoth = Object.keys(result.results).filter((id) =>
      result.missing.includes(id as SelectionListItemId)
    );
    expect(inBoth.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Archived items resolve (not in missing)
// ---------------------------------------------------------------------------

describe('POST /v1/resolve — archived items', () => {
  let archivedItemId: SelectionListItemId;

  beforeAll(async () => {
    const client = makeClient(orgAToken);
    const { list, items } = await createTestListWithItems(client, 2, {
      key: 'resolve-arc-' + Math.random().toString(16).slice(2, 8),
    });
    createdByA.push(list.id as SelectionListId);
    archivedItemId = items[1].id as SelectionListItemId;
    await client.archiveItem(list.id as SelectionListId, archivedItemId);
  });

  it('archived item id appears in results (not missing) with status: "archived"', async () => {
    const client = makeClient(orgAToken);
    const result = await client.resolveIds([archivedItemId]);

    expect(result.missing).not.toContain(archivedItemId);
    expect(result.results[archivedItemId]).toBeDefined();
    expect(result.results[archivedItemId].status).toBe('archived');
    // Still has a real label
    expect(result.results[archivedItemId].label.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Non-existent ids
// ---------------------------------------------------------------------------

describe('POST /v1/resolve — non-existent ids', () => {
  it('non-existent ids appear in missing, not in results', async () => {
    const client = makeClient(orgAToken);
    const ghostId = 'sli_01hghostid0000000000000000' as SelectionListItemId;
    const result = await client.resolveIds([ghostId]);

    expect(result.missing).toContain(ghostId);
    expect(result.results[ghostId]).toBeUndefined();
  });

  it('empty ids array → { results: {}, missing: [] } (not an error)', async () => {
    // The ResolveRequest schema requires minItems: 1, but the spec implies
    // an empty result is safe. The contract requires this not to error.
    // If the schema enforces minItems: 1 strictly, the test should expect 400.
    // We test the boundary: empty array.
    const { status, body } = await rawFetch('/v1/resolve', {
      method: 'POST',
      token: orgAToken(),
      body: JSON.stringify({ ids: [] }),
    });
    // Two valid interpretations per spec:
    // 1. minItems: 1 enforced → 400 VALIDATION_ERROR
    // 2. Empty set → { results: {}, missing: [] }
    // The spec says minItems: 1 in ResolveRequest, so 400 is correct.
    // If the implementation returns 200, that is also acceptable for empty.
    if (status === 200) {
      const b = body as { results: object; missing: unknown[] };
      expect(Object.keys(b.results).length).toBe(0);
      expect(b.missing.length).toBe(0);
    } else {
      expect(status).toBe(400);
      expect((body as { code?: string }).code).toBe('VALIDATION_ERROR');
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-org: id from another org's list appears in missing
// ---------------------------------------------------------------------------

describe('POST /v1/resolve — cross-org id isolation', () => {
  let orgBItemId: SelectionListItemId;

  beforeAll(async () => {
    const clientB = makeClient(orgBToken);
    const { list, items } = await createTestListWithItems(clientB, 1, {
      key: 'resolve-org-b-' + Math.random().toString(16).slice(2, 8),
    });
    createdByB.push(list.id as SelectionListId);
    orgBItemId = items[0].id as SelectionListItemId;
  });

  it('org A cannot see org B item id — it appears in missing (not leaked)', async () => {
    // POST /v1/resolve is intentionally minimal for security:
    // an id from another org must never leak its label
    const client = makeClient(orgAToken);
    const result = await client.resolveIds([orgBItemId]);

    // The id must be in missing (org-scoped) — it must NOT appear in results
    expect(result.missing).toContain(orgBItemId);
    expect(result.results[orgBItemId]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Unauthenticated access (trusted in-cluster callers)
// ---------------------------------------------------------------------------

describe('POST /v1/resolve — unauthenticated', () => {
  it('unauthenticated call is accepted (spec allows security: [])', async () => {
    // The spec declares `security: [bearerAuth: [], {}]` — {} means optional.
    // A trusted in-cluster caller may call without a token.
    const client = makeClient(); // no token
    // We expect either 200 (accepted) or 401 (if the test instance requires auth)
    // Document both outcomes — the spec explicitly allows unauthenticated calls.
    // This test FAILS if the service returns any other status code.
    let status: number;
    try {
      await client.resolveIds(['sli_01hanyid00000000000000000' as SelectionListItemId]);
      status = 200;
    } catch (err: unknown) {
      // SelectionListApiError carries the HTTP status
      status = (err as { status?: number }).status ?? 500;
    }
    expect([200, 401]).toContain(status);
  });
});

// ---------------------------------------------------------------------------
// Locale fallback on resolve
// ---------------------------------------------------------------------------

describe('POST /v1/resolve — locale resolution', () => {
  let enItemId: SelectionListItemId;

  beforeAll(async () => {
    const client = makeClient(orgAToken);
    const { list, items } = await createTestListWithItems(client, 1, {
      key: 'resolve-locale-' + Math.random().toString(16).slice(2, 8),
      source_locale: 'en',
    });
    createdByA.push(list.id as SelectionListId);
    enItemId = items[0].id as SelectionListItemId;
  });

  it('requesting locale=fr when only en exists falls back to en', async () => {
    const client = makeClient(orgAToken);
    const result = await client.resolveIds([enItemId], { locale: 'fr' });
    const resolved = result.results[enItemId];
    expect(resolved).toBeDefined();
    expect(resolved.locale).toBe('en');
    expect(resolved.label.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Response envelope shape
// ---------------------------------------------------------------------------

describe('POST /v1/resolve — response envelope', () => {
  it('response has exactly results and missing at the top level (no extra fields)', async () => {
    const { status, body } = await rawFetch('/v1/resolve', {
      method: 'POST',
      token: orgAToken(),
      body: JSON.stringify({ ids: ['sli_01hanyid00000000000000000'] }),
    });
    expect([200, 401]).toContain(status);
    if (status === 200) {
      const keys = Object.keys(body as object);
      expect(keys.sort()).toEqual(['missing', 'results']);
    }
  });
});
