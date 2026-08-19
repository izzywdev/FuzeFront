/**
 * Contract tests — GET/POST/PATCH /v1/selection-lists/{listId}/items and reorder
 *
 * Verifies:
 *   - Pagination contract for items (same envelope as lists)
 *   - Item create: id minted server-side (sli_ prefix), no client id accepted
 *   - code immutability: PATCH with `code` → 400 VALIDATION_ERROR
 *   - Reorder: valid permutation succeeds; missing id → 422; extra id → 422;
 *     archived id → 422; sort_order after reorder is gapped (100, 200, 300…)
 *   - Archive vs purge for items
 *   - Cannot purge list when non-archived items exist (409)
 *   - Item sort_order: omitting sort_order appends at max + 100
 *   - status filter defaults to active (archived items excluded from picker)
 *
 * Tests are ALL RED until the service is implemented.
 */

import { makeClient, rawFetch } from '../helpers/client';
import { mintTestToken } from '../helpers/auth';
import {
  createTestList,
  createTestListWithItems,
  purgeList,
  collectAllItems,
} from '../helpers/factories';
import type { SelectionListId, SelectionListItemId } from '../helpers/factories';
import type { SelectionListItem } from '@fuzeone/selection-list-client';

// ---------------------------------------------------------------------------
// Test actors
// ---------------------------------------------------------------------------

const ORG_ID = 'org_01test00000000000items0000';
const USER_OWNER = 'usr_01test00000000000itemowner0';

function ownerToken(): string {
  return mintTestToken({ userId: USER_OWNER, organizationId: ORG_ID });
}

const createdListIds: SelectionListId[] = [];

afterAll(async () => {
  const client = makeClient(ownerToken);
  for (const id of createdListIds) {
    await purgeList(client, id);
  }
});

// ---------------------------------------------------------------------------
// Identifier contract for items
// ---------------------------------------------------------------------------

describe('POST /v1/selection-lists/{listId}/items — identifier contract', () => {
  it('mints an sli_-prefixed id server-side and returns 201', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'item-id-' + Math.random().toString(16).slice(2, 8), name: 'Item ID Test' });
    createdListIds.push(list.id as SelectionListId);

    const item = await client.createItem(list.id as SelectionListId, { code: 'ITEM1', label: 'Item One' });
    expect(item.id).toMatch(/^sli_[0-9a-z]+$/);
    expect(item.list_id).toBe(list.id);
  });

  it('rejects a body containing an id field with 400 VALIDATION_ERROR', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'item-id-rej-' + Math.random().toString(16).slice(2, 8), name: 'Item ID Reject' });
    createdListIds.push(list.id as SelectionListId);

    const { status, body } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}/items`,
      {
        method: 'POST',
        token: ownerToken(),
        body: JSON.stringify({ id: 'sli_01hclientchoseid0000000000', code: 'INJ', label: 'Injected' }),
      }
    );
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('VALIDATION_ERROR');
  });

  it('rejects an sl_-prefixed id (wrong entity type) with 400 VALIDATION_ERROR', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'item-cross-' + Math.random().toString(16).slice(2, 8), name: 'Cross Type' });
    createdListIds.push(list.id as SelectionListId);

    const { status, body } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}/items`,
      {
        method: 'POST',
        token: ownerToken(),
        body: JSON.stringify({ id: 'sl_01hclientcrosstypeid0000000', code: 'CROSS', label: 'Cross' }),
      }
    );
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('VALIDATION_ERROR');
  });

  it('duplicate code within the same list returns 409 CONFLICT', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'dup-code-' + Math.random().toString(16).slice(2, 8), name: 'Dup Code' });
    createdListIds.push(list.id as SelectionListId);

    await client.createItem(list.id as SelectionListId, { code: 'DUP', label: 'First' });
    const { status, body } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}/items`,
      {
        method: 'POST',
        token: ownerToken(),
        body: JSON.stringify({ code: 'DUP', label: 'Second' }),
      }
    );
    expect(status).toBe(409);
    expect((body as { code?: string }).code).toBe('CONFLICT');
  });

  it('item created without sort_order is appended at max(sort_order) + 100', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'sort-append-' + Math.random().toString(16).slice(2, 8), name: 'Sort Append' });
    createdListIds.push(list.id as SelectionListId);

    const item1 = await client.createItem(list.id as SelectionListId, { code: 'A', label: 'A', sort_order: 300 });
    const item2 = await client.createItem(list.id as SelectionListId, { code: 'B', label: 'B' });
    expect(item2.sort_order).toBe(item1.sort_order + 100);
  });
});

// ---------------------------------------------------------------------------
// Pagination for items
// ---------------------------------------------------------------------------

describe('GET /v1/selection-lists/{listId}/items — pagination', () => {
  let listId: SelectionListId;
  let allItemIds: SelectionListItemId[];

  beforeAll(async () => {
    const client = makeClient(ownerToken);
    const { list, items } = await createTestListWithItems(client, 5, {
      key: 'item-pag-' + Math.random().toString(16).slice(2, 8),
    });
    listId = list.id as SelectionListId;
    allItemIds = items.map((i) => i.id as SelectionListItemId);
    createdListIds.push(listId);
  });

  it('limit=3 with 5 items returns exactly 3 items + hasMore: true + non-null nextCursor', async () => {
    const client = makeClient(ownerToken);
    const page = await client.getItems(listId, { limit: 3 });
    expect(page.items.length).toBe(3);
    expect(page.page.hasMore).toBe(true);
    expect(page.page.nextCursor).not.toBeNull();
  });

  it('echoing nextCursor returns the remaining 2 items + hasMore: false', async () => {
    const client = makeClient(ownerToken);
    const page1 = await client.getItems(listId, { limit: 3 });
    expect(page1.page.nextCursor).not.toBeNull();

    const page2 = await client.getItems(listId, {
      limit: 3,
      cursor: page1.page.nextCursor!,
    });
    expect(page2.items.length).toBe(2);
    expect(page2.page.hasMore).toBe(false);
    expect(page2.page.nextCursor).toBeNull();
  });

  it('cursor walk visits every item exactly once (no gaps, no duplicates)', async () => {
    const all = await collectAllItems(makeClient(ownerToken), listId, 2);
    const returnedIds = all.map((i) => i.id);
    const unique = new Set(returnedIds);
    expect(unique.size).toBe(returnedIds.length);
    for (const id of allItemIds) {
      expect(returnedIds).toContain(id);
    }
  });

  it('limit is clamped to 200 (request limit=9999 → response has ≤200 items)', async () => {
    const client = makeClient(ownerToken);
    const page = await client.getItems(listId, { limit: 9999 });
    expect(page.items.length).toBeLessThanOrEqual(200);
  });

  it('items are returned in sort_order ascending', async () => {
    const client = makeClient(ownerToken);
    const all = await collectAllItems(client, listId, 10);
    for (let i = 1; i < all.length; i++) {
      expect(all[i].sort_order).toBeGreaterThanOrEqual(all[i - 1].sort_order);
    }
  });

  it('status filter defaults to active (archived items are excluded from default listing)', async () => {
    const client = makeClient(ownerToken);
    // Archive one item and verify it does not appear in the default listing
    const page = await client.getItems(listId, { limit: 10 });
    const firstItem = page.items[0];
    await client.archiveItem(listId, firstItem.id as SelectionListItemId);

    const defaultPage = await client.getItems(listId, { limit: 10 });
    const defaultIds = defaultPage.items.map((i) => i.id);
    expect(defaultIds).not.toContain(firstItem.id);

    // Restore so other tests are not affected
    await client.updateItem(listId, firstItem.id as SelectionListItemId, { status: 'active' });
  });
});

// ---------------------------------------------------------------------------
// code immutability
// ---------------------------------------------------------------------------

describe('PATCH /v1/selection-lists/{listId}/items/{itemId} — code immutability', () => {
  it('sending code in the PATCH body is rejected with 400 VALIDATION_ERROR', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'code-imm-' + Math.random().toString(16).slice(2, 8), name: 'Code Immutable' });
    createdListIds.push(list.id as SelectionListId);
    const item = await client.createItem(list.id as SelectionListId, { code: 'IMMUTE', label: 'Original' });

    const { status, body } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}/items/${encodeURIComponent(item.id)}`,
      {
        method: 'PATCH',
        token: ownerToken(),
        body: JSON.stringify({ code: 'CHANGED' }),
      }
    );
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('VALIDATION_ERROR');
  });

  it('can update label without touching code', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'label-upd-' + Math.random().toString(16).slice(2, 8), name: 'Label Update' });
    createdListIds.push(list.id as SelectionListId);
    const item = await client.createItem(list.id as SelectionListId, { code: 'LBL', label: 'Old Label' });

    const updated = await client.updateItem(list.id as SelectionListId, item.id as SelectionListItemId, {
      label: 'New Label',
    });
    expect(updated.label).toBe('New Label');
    expect(updated.code).toBe('LBL'); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

describe('PUT /v1/selection-lists/{listId}/items/reorder', () => {
  it('valid permutation succeeds and items come back in new order', async () => {
    const client = makeClient(ownerToken);
    const { list, items } = await createTestListWithItems(client, 3, {
      key: 'reorder-valid-' + Math.random().toString(16).slice(2, 8),
    });
    createdListIds.push(list.id as SelectionListId);

    const [a, b, c] = items as [SelectionListItem, SelectionListItem, SelectionListItem];
    // Reverse the order: c, b, a
    const result = await client.reorderItems(list.id as SelectionListId, [
      c.id as SelectionListItemId,
      b.id as SelectionListItemId,
      a.id as SelectionListItemId,
    ]);

    expect(result.items[0].id).toBe(c.id);
    expect(result.items[1].id).toBe(b.id);
    expect(result.items[2].id).toBe(a.id);
  });

  it('sort_order values are re-gapped to 100, 200, 300… after reorder', async () => {
    const client = makeClient(ownerToken);
    const { list, items } = await createTestListWithItems(client, 3, {
      key: 'reorder-gap-' + Math.random().toString(16).slice(2, 8),
    });
    createdListIds.push(list.id as SelectionListId);

    const ids = items.map((i) => i.id as SelectionListItemId);
    const result = await client.reorderItems(list.id as SelectionListId, ids);

    const sortOrders = result.items.map((i) => i.sort_order);
    expect(sortOrders[0]).toBe(100);
    expect(sortOrders[1]).toBe(200);
    expect(sortOrders[2]).toBe(300);
  });

  it('reorder with a missing item id returns 422 VALIDATION_ERROR', async () => {
    const client = makeClient(ownerToken);
    const { list, items } = await createTestListWithItems(client, 3, {
      key: 'reorder-miss-' + Math.random().toString(16).slice(2, 8),
    });
    createdListIds.push(list.id as SelectionListId);

    const ids = items.map((i) => i.id as SelectionListItemId);
    // Omit the last item — makes the set incomplete
    const { status, body } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}/items/reorder`,
      {
        method: 'PUT',
        token: ownerToken(),
        body: JSON.stringify({ item_ids: ids.slice(0, 2) }),
      }
    );
    expect(status).toBe(400); // spec says 400 VALIDATION_ERROR for incomplete/wrong set
    expect((body as { code?: string }).code).toBe('VALIDATION_ERROR');
  });

  it('reorder with an extra id not in the list returns 422 VALIDATION_ERROR', async () => {
    const client = makeClient(ownerToken);
    const { list, items } = await createTestListWithItems(client, 2, {
      key: 'reorder-extra-' + Math.random().toString(16).slice(2, 8),
    });
    createdListIds.push(list.id as SelectionListId);

    const ids = items.map((i) => i.id as SelectionListItemId);
    ids.push('sli_01hnonexistentitemid000000' as SelectionListItemId); // extra
    const { status, body } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}/items/reorder`,
      {
        method: 'PUT',
        token: ownerToken(),
        body: JSON.stringify({ item_ids: ids }),
      }
    );
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('VALIDATION_ERROR');
  });

  it('reorder with archived item ids returns 400 VALIDATION_ERROR (archived items excluded from permutation)', async () => {
    const client = makeClient(ownerToken);
    const { list, items } = await createTestListWithItems(client, 3, {
      key: 'reorder-arc-' + Math.random().toString(16).slice(2, 8),
    });
    createdListIds.push(list.id as SelectionListId);

    // Archive the third item, then include it in the reorder set
    const archivedItemId = items[2].id as SelectionListItemId;
    await client.archiveItem(list.id as SelectionListId, archivedItemId);

    const idsWithArchived = items.map((i) => i.id as SelectionListItemId);
    const { status, body } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}/items/reorder`,
      {
        method: 'PUT',
        token: ownerToken(),
        body: JSON.stringify({ item_ids: idsWithArchived }),
      }
    );
    expect(status).toBe(400);
    expect((body as { code?: string }).code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Archive vs purge for items
// ---------------------------------------------------------------------------

describe('DELETE /v1/selection-lists/{listId}/items/{itemId} — archive vs purge', () => {
  it('DELETE without ?purge archives the item; item still appears with status=archived', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'item-arc-' + Math.random().toString(16).slice(2, 8), name: 'Item Archive' });
    createdListIds.push(list.id as SelectionListId);
    const item = await client.createItem(list.id as SelectionListId, { code: 'ARC', label: 'Archiveable' });

    const archived = await client.deleteItem(list.id as SelectionListId, item.id as SelectionListItemId);
    expect(archived).not.toBeNull();
    expect(archived!.status).toBe('archived');

    // Item still appears with status=archived
    const page = await client.getItems(list.id as SelectionListId, { status: 'archived' });
    expect(page.items.map((i) => i.id)).toContain(item.id);
  });

  it('DELETE with ?purge=true permanently removes the item; GET returns 404', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'item-purge-' + Math.random().toString(16).slice(2, 8), name: 'Item Purge' });
    createdListIds.push(list.id as SelectionListId);
    const item = await client.createItem(list.id as SelectionListId, { code: 'PURGE', label: 'Purgeable' });

    await client.deleteItem(list.id as SelectionListId, item.id as SelectionListItemId, { purge: true });

    const { status } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}/items/${encodeURIComponent(item.id)}`,
      { method: 'GET', token: ownerToken() }
    );
    // 404 or gone — implementation may choose 404 vs 410
    expect([404, 410]).toContain(status);
  });

  it('cannot purge a list that still has non-archived items — 409 CONFLICT', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'purge-guard-' + Math.random().toString(16).slice(2, 8), name: 'Purge Guard' });
    createdListIds.push(list.id as SelectionListId);
    await client.createItem(list.id as SelectionListId, { code: 'LIVE', label: 'Live Item' });

    const { status, body } = await rawFetch(
      `/v1/selection-lists/${encodeURIComponent(list.id)}?purge=true`,
      { method: 'DELETE', token: ownerToken() }
    );
    expect(status).toBe(409);
    expect((body as { code?: string }).code).toBe('CONFLICT');
  });
});

// ---------------------------------------------------------------------------
// Item response shape
// ---------------------------------------------------------------------------

describe('SelectionListItem response shape', () => {
  it('every required field is present and non-null where the spec guarantees it', async () => {
    const client = makeClient(ownerToken);
    const list = await createTestList(client, { key: 'shape-' + Math.random().toString(16).slice(2, 8), name: 'Shape Test' });
    createdListIds.push(list.id as SelectionListId);
    const item = await client.createItem(list.id as SelectionListId, { code: 'SHAPE', label: 'Shape Label' });

    expect(item.id).toMatch(/^sli_[0-9a-z]+$/);
    expect(item.list_id).toBe(list.id);
    expect(typeof item.code).toBe('string');
    expect(item.code.length).toBeGreaterThan(0);
    expect(typeof item.sort_order).toBe('number');
    expect(['active', 'archived']).toContain(item.status);
    expect(typeof item.label).toBe('string');
    expect(item.label.length).toBeGreaterThan(0); // never null
    expect(typeof item.resolved_locale).toBe('string');
    expect(typeof item.is_machine).toBe('boolean');
    expect(typeof item.created_by).toBe('string');
    expect(new Date(item.created_at).getTime()).not.toBeNaN();
    expect(new Date(item.updated_at).getTime()).not.toBeNaN();
  });
});
