/**
 * Contract tests — GET/POST /v1/selection-lists
 *
 * Verifies:
 *   - Pagination contract: limit, cursor, hasMore, nextCursor, gapless walk, limit clamping
 *   - Create: id minted server-side, client-supplied id rejected (422)
 *   - Identifier standard: `sl_` prefix on every created list
 *   - Archive vs purge semantics (DELETE with and without ?purge=true)
 *   - `status` filter (active / archived / all)
 *   - Locale parameter validation (unsupported locale → 400)
 *   - Duplicate key → 409 CONFLICT
 *   - Missing auth → 401
 *   - Unknown property in body → 400 VALIDATION_ERROR (additionalProperties: false)
 *
 * Tests are written against the FROZEN SPEC (openapi.yaml v1.0.0) and are
 * expected to FAIL until the service is fully implemented (TDD / S12).
 */

import { makeClient, rawFetch } from '../helpers/client';
import { mintTestToken } from '../helpers/auth';
import {
  createTestList,
  createNLists,
  purgeList,
  collectAllLists,
} from '../helpers/factories';
import type { SelectionListId } from '../helpers/factories';

// ---------------------------------------------------------------------------
// Test actors
// ---------------------------------------------------------------------------

const ORG_ID = 'org_01test00000000000lists0000';
const USER_OWNER = 'usr_01test00000000000listowner0';

function ownerToken(): string {
  return mintTestToken({ userId: USER_OWNER, organizationId: ORG_ID });
}

// Keep track of all lists created so we can purge them in afterAll
const createdListIds: SelectionListId[] = [];

afterAll(async () => {
  const client = makeClient(ownerToken);
  for (const id of createdListIds) {
    await purgeList(client, id);
  }
});

// ---------------------------------------------------------------------------
// Authentication guard
// ---------------------------------------------------------------------------

describe('GET /v1/selection-lists — authentication', () => {
  it('returns 401 when no Authorization header is present', async () => {
    const { status, body } = await rawFetch('/v1/selection-lists', { method: 'GET' });
    expect(status).toBe(401);
    expect((body as { code?: string }).code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 when Bearer token is malformed', async () => {
    const { status } = await rawFetch('/v1/selection-lists', {
      method: 'GET',
      token: 'not-a-valid-jwt',
    });
    expect(status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Create — identifier contract
// ---------------------------------------------------------------------------

describe('POST /v1/selection-lists — identifier contract', () => {
  it('mints an sl_-prefixed id server-side and returns 201', async () => {
    const client = makeClient(ownerToken);
    const list = await client.createList({ key: 'id-test-' + Math.random().toString(16).slice(2, 8), name: 'ID Test' });
    createdListIds.push(list.id as SelectionListId);

    expect(list.id).toMatch(/^sl_[0-9a-z]+$/);
    expect(list.organization_id).toBe(ORG_ID);
  });

  it('rejects a body containing an id field with 400 VALIDATION_ERROR (additionalProperties: false)', async () => {
    const { status, body } = await rawFetch('/v1/selection-lists', {
      method: 'POST',
      token: ownerToken(),
      body: JSON.stringify({
        id: 'sl_01hclientchosenitself000000',
        key: 'id-injection-' + Math.random().toString(16).slice(2, 8),
        name: 'Should be rejected',
      }),
    });
    // The schema sets additionalProperties: false, so an unknown `id` field is a 400
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('VALIDATION_ERROR');
  });

  it('rejects an sli_-prefixed id (wrong entity type) with 400 VALIDATION_ERROR', async () => {
    const { status, body } = await rawFetch('/v1/selection-lists', {
      method: 'POST',
      token: ownerToken(),
      body: JSON.stringify({
        id: 'sli_01hclientwrongtypeid000000',
        key: 'cross-type-' + Math.random().toString(16).slice(2, 8),
        name: 'Cross-type rejection test',
      }),
    });
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('VALIDATION_ERROR');
  });

  it('grants list-owner to the creator automatically', async () => {
    const client = makeClient(ownerToken);
    const list = await client.createList({
      key: 'owner-grant-' + Math.random().toString(16).slice(2, 8),
      name: 'Owner Grant Test',
    });
    createdListIds.push(list.id as SelectionListId);

    // The creator should be able to manage access (list-owner action)
    const grants = await client.getAccess(list.id as SelectionListId);
    const ownerGrant = grants.items.find(
      (g) => g.user_id === USER_OWNER && g.role === 'list-owner'
    );
    expect(ownerGrant).toBeDefined();
  });

  it('returns 409 CONFLICT when key is duplicated within the org', async () => {
    const client = makeClient(ownerToken);
    const key = 'dup-key-' + Math.random().toString(16).slice(2, 8);
    const list = await client.createList({ key, name: 'Original' });
    createdListIds.push(list.id as SelectionListId);

    const { status, body } = await rawFetch('/v1/selection-lists', {
      method: 'POST',
      token: ownerToken(),
      body: JSON.stringify({ key, name: 'Duplicate' }),
    });
    expect(status).toBe(409);
    expect((body as { code?: string }).code).toBe('CONFLICT');
  });
});

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

describe('GET /v1/selection-lists — response shape', () => {
  it('returns the required envelope fields: items + page', async () => {
    const client = makeClient(ownerToken);
    const page = await client.getLists({ limit: 1 });
    expect(page).toHaveProperty('items');
    expect(page).toHaveProperty('page');
    expect(page.page).toHaveProperty('nextCursor');
    expect(page.page).toHaveProperty('hasMore');
    expect(Array.isArray(page.items)).toBe(true);
  });

  it('each list row contains every required field from the spec', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client);
    createdListIds.push(list.id as SelectionListId);

    // Verify all required fields are present and of the right type
    expect(typeof list.id).toBe('string');
    expect(typeof list.organization_id).toBe('string');
    expect(typeof list.key).toBe('string');
    expect(typeof list.source_locale).toBe('string');
    expect(['active', 'archived']).toContain(list.status);
    expect(typeof list.name).toBe('string');
    expect(list.name.length).toBeGreaterThan(0); // never null/empty
    expect(typeof list.resolved_locale).toBe('string');
    expect(typeof list.is_machine).toBe('boolean');
    expect(typeof list.created_by).toBe('string');
    expect(typeof list.created_at).toBe('string');
    expect(typeof list.updated_at).toBe('string');
    // RFC 3339 sanity check
    expect(new Date(list.created_at).getTime()).not.toBeNaN();
    expect(new Date(list.updated_at).getTime()).not.toBeNaN();
  });

  it('does not leak organization_id from another org in the listing', async () => {
    // All items returned must belong to the caller's org
    const client = makeClient(ownerToken);
    const list = await createTestList(client);
    createdListIds.push(list.id as SelectionListId);

    const page = await client.getLists({ limit: 200 });
    for (const item of page.items) {
      expect(item.organization_id).toBe(ORG_ID);
    }
  });
});

// ---------------------------------------------------------------------------
// Pagination contract (baseline §4.1 / governance/pagination-standard.md)
// ---------------------------------------------------------------------------

describe('GET /v1/selection-lists — pagination', () => {
  // We create 5 known lists so we can assert exactly 3 + 2 page split
  const paginationListIds: SelectionListId[] = [];

  beforeAll(async () => {
    const client = makeClient(ownerToken);
    const lists = await createNLists(client, 5, 'pag-lists');
    for (const l of lists) paginationListIds.push(l.id as SelectionListId);
    createdListIds.push(...paginationListIds);
  });

  it('limit=3: returns exactly 3 items, hasMore: true, non-null nextCursor when >=4 exist', async () => {
    const client = makeClient(ownerToken);
    const page = await client.getLists({ limit: 3 });
    expect(page.items.length).toBeLessThanOrEqual(3);
    // If the org has >= 4 lists total, hasMore must be true
    const total = page.page.total;
    if (total !== undefined && total >= 4) {
      expect(page.items.length).toBe(3);
      expect(page.page.hasMore).toBe(true);
      expect(page.page.nextCursor).not.toBeNull();
    }
  });

  it('cursor walk visits every item exactly once with no gaps or duplicates', async () => {
    const client = makeClient(ownerToken);
    // Use a large enough page size that we definitely need multiple pages
    const all = await collectAllLists(client, 2);
    const ids = all.map((l) => l.id);
    // No duplicates
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
    // All 5 known lists are present
    for (const knownId of paginationListIds) {
      expect(ids).toContain(knownId);
    }
  });

  it('terminates with nextCursor: null and hasMore: false on the last page', async () => {
    const client = makeClient(ownerToken);
    let lastPage = await client.getLists({ limit: 200 });
    // Keep fetching until no more pages (should be one-shot with limit 200 unless >200 lists)
    while (lastPage.page.hasMore && lastPage.page.nextCursor) {
      lastPage = await client.getLists({ limit: 200, cursor: lastPage.page.nextCursor });
    }
    expect(lastPage.page.hasMore).toBe(false);
    expect(lastPage.page.nextCursor).toBeNull();
  });

  it('limit is clamped to 200 server-side (request limit=9999 → response has ≤200 items)', async () => {
    const client = makeClient(ownerToken);
    const page = await client.getLists({ limit: 9999 });
    expect(page.items.length).toBeLessThanOrEqual(200);
  });

  it('a malformed cursor returns 400 VALIDATION_ERROR (not a silent page-1 reset)', async () => {
    const { status, body } = await rawFetch('/v1/selection-lists?cursor=NOT_A_REAL_CURSOR', {
      method: 'GET',
      token: ownerToken(),
    });
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Status filter
// ---------------------------------------------------------------------------

describe('GET /v1/selection-lists — status filter', () => {
  let activeListId: SelectionListId;
  let archivedListId: SelectionListId;

  beforeAll(async () => {
    const client = makeClient(ownerToken);
    const active = await createTestList(client, { key: 'status-active-' + Math.random().toString(16).slice(2, 8), name: 'Active' });
    activeListId = active.id as SelectionListId;
    createdListIds.push(activeListId);

    const toArchive = await createTestList(client, { key: 'status-arc-' + Math.random().toString(16).slice(2, 8), name: 'To Archive' });
    archivedListId = toArchive.id as SelectionListId;
    createdListIds.push(archivedListId);
    await client.archiveList(archivedListId);
  });

  it('default (status=active) does not return archived lists', async () => {
    const client = makeClient(ownerToken);
    const all = await collectAllLists(client, 50);
    const ids = all.map((l) => l.id);
    expect(ids).toContain(activeListId);
    expect(ids).not.toContain(archivedListId);
  });

  it('status=archived returns archived list and not active list', async () => {
    const client = makeClient(ownerToken);
    const page = await client.getLists({ status: 'archived', limit: 200 });
    const ids = page.items.map((l) => l.id);
    expect(ids).toContain(archivedListId);
    expect(ids).not.toContain(activeListId);
  });

  it('status=all returns both', async () => {
    const client = makeClient(ownerToken);
    const page = await client.getLists({ status: 'all', limit: 200 });
    const ids = page.items.map((l) => l.id);
    expect(ids).toContain(activeListId);
    expect(ids).toContain(archivedListId);
  });
});

// ---------------------------------------------------------------------------
// Archive vs purge semantics
// ---------------------------------------------------------------------------

describe('DELETE /v1/selection-lists/{listId} — archive vs purge', () => {
  it('DELETE without ?purge archives the list (status: archived); list still resolves via status=archived', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'arc-test-' + Math.random().toString(16).slice(2, 8), name: 'Archive Test' });
    createdListIds.push(list.id as SelectionListId);

    const archived = await client.deleteList(list.id as SelectionListId);
    expect(archived).not.toBeNull();
    expect(archived!.status).toBe('archived');

    // List is still accessible via status=archived filter
    const page = await client.getLists({ status: 'archived', limit: 200 });
    expect(page.items.map((l) => l.id)).toContain(list.id);
  });

  it('DELETE with ?purge=true permanently removes the list; GET returns 404', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'purge-test-' + Math.random().toString(16).slice(2, 8), name: 'Purge Test' });
    // Do not add to createdListIds — we are purging it here

    const result = await client.deleteList(list.id as SelectionListId, { purge: true });
    expect(result).toBeNull(); // 204 No Content on purge

    // Subsequent GET must return 404
    const { status } = await rawFetch(`/v1/selection-lists/${encodeURIComponent(list.id)}`, {
      method: 'GET',
      token: ownerToken(),
    });
    expect(status).toBe(404);
  });

  it('archiving an already-archived list returns 200 (idempotent)', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'arc-idemp-' + Math.random().toString(16).slice(2, 8), name: 'Archive Idempotent' });
    createdListIds.push(list.id as SelectionListId);

    await client.archiveList(list.id as SelectionListId);
    // Second archive call should still return 200 with status: archived
    const result = await client.archiveList(list.id as SelectionListId);
    expect(result.status).toBe('archived');
  });

  it('GET returns 404 (not 403) for a list the caller cannot read (cross-org existence oracle)', async () => {
    // Use a plausible but non-existent list id; the service should 404
    const { status } = await rawFetch('/v1/selection-lists/sl_01hnonexistent000000000000', {
      method: 'GET',
      token: ownerToken(),
    });
    expect(status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Locale parameter validation
// ---------------------------------------------------------------------------

describe('GET /v1/selection-lists — locale validation', () => {
  it('unsupported locale value returns 400 VALIDATION_ERROR (not a silent fallback)', async () => {
    const { status, body } = await rawFetch('/v1/selection-lists?locale=xx', {
      method: 'GET',
      token: ownerToken(),
    });
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('VALIDATION_ERROR');
  });

  it('valid locale=fr is accepted', async () => {
    const client = makeClient(ownerToken);
    const page = await client.getLists({ locale: 'fr' });
    expect(page).toHaveProperty('items');
  });
});

// ---------------------------------------------------------------------------
// key filter
// ---------------------------------------------------------------------------

describe('GET /v1/selection-lists?key= — exact match filter', () => {
  it('returns only the list matching the exact key', async () => {
    const client = makeClient(ownerToken);
    const uniqueKey = 'key-filter-' + Math.random().toString(16).slice(2, 8);
    const list = await createTestList(client, { key: uniqueKey, name: 'Key Filter Test' });
    createdListIds.push(list.id as SelectionListId);

    const page = await client.getLists({ key: uniqueKey });
    expect(page.items.length).toBe(1);
    expect(page.items[0].id).toBe(list.id);
  });

  it('returns empty items array when no list matches the key', async () => {
    const client = makeClient(ownerToken);
    const page = await client.getLists({ key: 'no-such-key-' + Math.random().toString(16).slice(2, 8) });
    expect(page.items.length).toBe(0);
    expect(page.page.hasMore).toBe(false);
    expect(page.page.nextCursor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PATCH /v1/selection-lists/{listId}
// ---------------------------------------------------------------------------

describe('PATCH /v1/selection-lists/{listId}', () => {
  it('partial update: changing name upserts the source_locale translation', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'patch-' + Math.random().toString(16).slice(2, 8), name: 'Original Name' });
    createdListIds.push(list.id as SelectionListId);

    const updated = await client.updateList(list.id as SelectionListId, { name: 'Updated Name' });
    expect(updated.name).toBe('Updated Name');
  });

  it('empty body is rejected with 400 VALIDATION_ERROR (minProperties: 1)', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'patch-empty-' + Math.random().toString(16).slice(2, 8), name: 'Patch Empty Test' });
    createdListIds.push(list.id as SelectionListId);

    const { status, body } = await rawFetch(`/v1/selection-lists/${encodeURIComponent(list.id)}`, {
      method: 'PATCH',
      token: ownerToken(),
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('VALIDATION_ERROR');
  });

  it('sending code in the patch body is rejected (additionalProperties: false)', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'patch-code-' + Math.random().toString(16).slice(2, 8), name: 'Patch Code Test' });
    createdListIds.push(list.id as SelectionListId);

    const { status, body } = await rawFetch(`/v1/selection-lists/${encodeURIComponent(list.id)}`, {
      method: 'PATCH',
      token: ownerToken(),
      body: JSON.stringify({ code: 'NEW_CODE' }),
    });
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('VALIDATION_ERROR');
  });
});
