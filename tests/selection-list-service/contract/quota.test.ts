/**
 * Contract tests — quota enforcement
 *
 * Verifies:
 *   - GET /v1/selection-lists/quota returns all 4 scopes with correct shape
 *   - Quota endpoint is x-pagination: exempt (fixed bounded response)
 *   - Creating a list when org_lists ceiling is reached → 403 QUOTA_EXCEEDED
 *     with { code: "QUOTA_EXCEEDED", scope: "org_lists", limit: N, current: N }
 *   - Creating an item when list_items ceiling is reached → 403 QUOTA_EXCEEDED
 *     with scope: "list_items"
 *   - Concurrent creates do not race past the ceiling (advisory-lock test)
 *   - QUOTA_EXCEEDED error body shape: code, scope, limit, current all present
 *
 * NOTE: The ceiling values used by the running service are configuration.
 * These tests are written to a test-mode configuration where:
 *   org_lists = 3 (configurable via TEST_QUOTA_ORG_LISTS env var)
 *   user_lists = 5
 *   list_items = 5 (configurable via TEST_QUOTA_LIST_ITEMS env var)
 *   list_locales = 3
 *
 * Override with environment variables when the service uses different test values.
 *
 * Tests are ALL RED until the service is implemented.
 */

import { makeClient, rawFetch } from '../helpers/client';
import { mintTestToken } from '../helpers/auth';
import { createTestList, purgeList } from '../helpers/factories';
import type { SelectionListId } from '../helpers/factories';

// ---------------------------------------------------------------------------
// Test actors
// ---------------------------------------------------------------------------

const ORG_ID = 'org_01test00000000quota0000000';
const USER_OWNER = 'usr_01test00000000quotaowner00';

function ownerToken(): string {
  return mintTestToken({ userId: USER_OWNER, organizationId: ORG_ID });
}

const QUOTA_ORG_LISTS = parseInt(process.env['TEST_QUOTA_ORG_LISTS'] ?? '3', 10);
const QUOTA_LIST_ITEMS = parseInt(process.env['TEST_QUOTA_LIST_ITEMS'] ?? '5', 10);

const createdListIds: SelectionListId[] = [];

afterAll(async () => {
  const client = makeClient(ownerToken);
  for (const id of createdListIds) {
    await purgeList(client, id);
  }
});

// ---------------------------------------------------------------------------
// GET /v1/selection-lists/quota — shape and exempt from pagination
// ---------------------------------------------------------------------------

describe('GET /v1/selection-lists/quota', () => {
  it('returns status 200 with quota_status shape', async () => {
    const client = makeClient(ownerToken);
    const quota = await client.getQuota();
    expect(quota).toHaveProperty('organization_id');
    expect(quota).toHaveProperty('quotas');
    expect(Array.isArray(quota.quotas)).toBe(true);
  });

  it('returns exactly 4 quota scopes', async () => {
    const client = makeClient(ownerToken);
    const quota = await client.getQuota();
    expect(quota.quotas.length).toBe(4);
  });

  it('all 4 expected scope values are present', async () => {
    const client = makeClient(ownerToken);
    const quota = await client.getQuota();
    const scopes = quota.quotas.map((q) => q.scope);
    expect(scopes).toContain('org_lists');
    expect(scopes).toContain('user_lists');
    expect(scopes).toContain('list_items');
    expect(scopes).toContain('list_locales');
  });

  it('each quota entry has the required fields', async () => {
    const client = makeClient(ownerToken);
    const quota = await client.getQuota();
    for (const entry of quota.quotas) {
      expect(typeof entry.scope).toBe('string');
      expect(['organization', 'user', 'list']).toContain(entry.applies_to);
      expect(typeof entry.limit).toBe('number');
      expect(entry.limit).toBeGreaterThan(0);
      // current may be null for per-list scopes (list_items, list_locales)
      if (entry.applies_to === 'list') {
        // per-list quotas may return null for current at the org level
        expect([null, ...Array.from({ length: 1000 }, (_, i) => i)]).toContain(entry.current);
      } else {
        expect(typeof entry.current).toBe('number');
      }
    }
  });

  it('is NOT paginated — response has no items/page envelope', async () => {
    const { status, body } = await rawFetch('/v1/selection-lists/quota', {
      method: 'GET',
      token: ownerToken(),
    });
    expect(status).toBe(200);
    // The quota response must NOT have items/page pagination envelope
    expect((body as { items?: unknown }).items).toBeUndefined();
    expect((body as { page?: unknown }).page).toBeUndefined();
    // It must have organization_id and quotas
    expect((body as { organization_id?: unknown }).organization_id).toBeDefined();
    expect((body as { quotas?: unknown }).quotas).toBeDefined();
  });

  it('requires authentication', async () => {
    const { status } = await rawFetch('/v1/selection-lists/quota', { method: 'GET' });
    expect(status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// org_lists quota enforcement
// ---------------------------------------------------------------------------

describe('org_lists quota enforcement', () => {
  it('creating a list when org_lists ceiling is reached → 403 QUOTA_EXCEEDED', async () => {
    const client = makeClient(ownerToken);

    // Fill up to the ceiling
    const toCreate = QUOTA_ORG_LISTS;
    for (let i = 0; i < toCreate; i++) {
      try {
        const list = await createTestList(client, {
          key: `quota-fill-${i}-${Math.random().toString(16).slice(2, 6)}`,
          name: `Quota Fill ${i}`,
        });
        createdListIds.push(list.id as SelectionListId);
      } catch {
        // If we hit the ceiling before expected, that is a separate issue
        // captured by the assertion below
      }
    }

    // This create should now be refused
    const { status, body } = await rawFetch('/v1/selection-lists', {
      method: 'POST',
      token: ownerToken(),
      body: JSON.stringify({
        key: 'quota-over-' + Math.random().toString(16).slice(2, 8),
        name: 'Over Quota',
      }),
    });

    expect(status).toBe(403);
    const errorBody = body as { code?: string; scope?: string; limit?: number; current?: number };
    expect(errorBody.code).toBe('QUOTA_EXCEEDED');
    expect(errorBody.scope).toBe('org_lists');
    expect(typeof errorBody.limit).toBe('number');
    expect(typeof errorBody.current).toBe('number');
    expect(errorBody.current).toBeGreaterThanOrEqual(errorBody.limit!);
  });
});

// ---------------------------------------------------------------------------
// list_items quota enforcement
// ---------------------------------------------------------------------------

describe('list_items quota enforcement', () => {
  it('creating an item when list_items ceiling is reached → 403 QUOTA_EXCEEDED', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, {
      key: 'item-quota-' + Math.random().toString(16).slice(2, 8),
      name: 'Item Quota Test',
    });
    createdListIds.push(list.id as SelectionListId);

    // Fill up to the ceiling
    for (let i = 0; i < QUOTA_LIST_ITEMS; i++) {
      try {
        await client.createItem(list.id as SelectionListId, {
          code: `ITEM${i}`,
          label: `Item ${i}`,
        });
      } catch {
        // may have already hit quota
      }
    }

    // Next create should be refused
    const { status, body } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}/items`,
      {
        method: 'POST',
        token: ownerToken(),
        body: JSON.stringify({ code: 'OVER', label: 'Over Quota Item' }),
      }
    );

    expect(status).toBe(403);
    const errorBody = body as { code?: string; scope?: string; limit?: number; current?: number };
    expect(errorBody.code).toBe('QUOTA_EXCEEDED');
    expect(errorBody.scope).toBe('list_items');
    expect(typeof errorBody.limit).toBe('number');
    expect(typeof errorBody.current).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Concurrent creates do not race past the ceiling
// ---------------------------------------------------------------------------

describe('Concurrent quota enforcement (advisory lock)', () => {
  it('parallel creates at the ceiling: only some succeed, none exceed the limit', async () => {
    const client = makeClient(ownerToken);

    // Create a fresh list to fill with items concurrently
    const list = await createTestList(client, {
      key: 'concurrent-' + Math.random().toString(16).slice(2, 8),
      name: 'Concurrent Quota Test',
    });
    createdListIds.push(list.id as SelectionListId);

    // Fire QUOTA_LIST_ITEMS + 3 concurrent creates
    const attempts = QUOTA_LIST_ITEMS + 3;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, (_, i) =>
        rawFetch(`/v1/selection-lists/${encodeURIComponent(list.id)}/items`, {
          method: 'POST',
          token: ownerToken(),
          body: JSON.stringify({ code: `CONC${i}`, label: `Concurrent ${i}` }),
        })
      )
    );

    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 500));
    const successful = statuses.filter((s) => s === 201).length;
    const refused = statuses.filter((s) => s === 403).length;

    // At most QUOTA_LIST_ITEMS creates should succeed
    expect(successful).toBeLessThanOrEqual(QUOTA_LIST_ITEMS);
    // All others must be 403 QUOTA_EXCEEDED (not 500, not silent success)
    expect(refused).toBe(attempts - successful);

    // Verify the body of refused responses
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.status === 403) {
        expect((r.value.body as { code?: string }).code).toBe('QUOTA_EXCEEDED');
      }
    }
  });
});
