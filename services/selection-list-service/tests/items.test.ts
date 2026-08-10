// items.test.ts — Unit tests for selection list item CRUD routes (S4 — FFRNT-187).
//
// Coverage:
//   1. Feature flag OFF path → 404 on all routes
//   2. Feature flag ON path — shape/logic for each route
//   3. Pagination: limit clamping, envelope shape, cursor correctness
//   4. Input validation (code immutability, unknown props, required fields)
//   5. Duplicate code → 409 CONFLICT
//   6. Missing resource → 404

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { setFlagClient } from '../src/flags';

// ─── DB mock ─────────────────────────────────────────────────────────────────

const mockRaw = jest.fn();
const mockTrxRaw = jest.fn();
const mockTrx = {
  raw: mockTrxRaw,
};
const mockTransaction = jest.fn(async (cb: (t: typeof mockTrx) => Promise<void>) => cb(mockTrx));

jest.mock('../src/db', () => ({
  db: {
    raw: (...args: any[]) => mockRaw(...args),
    transaction: (...args: any[]) => mockTransaction(...args),
  },
}));

// ─── Identity mock (mintId) ───────────────────────────────────────────────────

jest.mock('@izzywdev/fuzefront-identity', () => ({
  mintId: (type: string) =>
    type === 'selectionListItem'
      ? 'front_sli_01testitemid0000000000000'
      : `front_sl_${type}`,
}));

// ─── Quota middleware mock (S6 concern — pass-through in S4 tests) ────────────

jest.mock('../src/middleware/quota', () => ({
  enforceListQuota: (_req: any, _res: any, next: any) => next(),
  enforceItemQuota: (_req: any, _res: any, next: any) => next(),
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-s4-items';
const TEST_USER_ID = 'usr_01testuserid0000000000000';
const TEST_ORG_ID  = 'org_01testorgid00000000000000';
const TEST_LIST_ID = 'front_sl_01testlistid000000000000';
const TEST_ITEM_ID = 'front_sli_01testitemid0000000000000';

function authHeader() {
  const token = jwt.sign({ userId: TEST_USER_ID, orgId: TEST_ORG_ID }, JWT_SECRET);
  return { Authorization: `Bearer ${token}` };
}

const ITEM_ROW = {
  id: TEST_ITEM_ID,
  list_id: TEST_LIST_ID,
  code: 'US',
  sort_order: 100,
  status: 'active',
  created_by: TEST_USER_ID,
  created_at: new Date('2026-08-10T12:00:00Z'),
  updated_at: new Date('2026-08-10T12:00:00Z'),
  label: 'United States',
  description: null,
  resolved_locale: 'en',
  is_machine: false,
};

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  process.env.JWT_SECRET = JWT_SECRET;
  // Inject a flag client that returns ON by default for all non-flag-OFF tests.
  setFlagClient({ getBooleanValue: async () => true });
  app = createApp();
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  setFlagClient(null);
});

beforeEach(() => {
  jest.clearAllMocks();
  // Re-inject flag client after clearAllMocks to ensure flag stays ON
  setFlagClient({ getBooleanValue: async () => true });
});

// ─── Feature flag OFF ─────────────────────────────────────────────────────────

describe('Feature flag OFF — items routes', () => {
  beforeEach(() => { setFlagClient({ getBooleanValue: async () => false }); });
  afterEach(() => { setFlagClient({ getBooleanValue: async () => true }); });

  it('GET /:listId/items returns 404', async () => {
    const res = await request(app)
      .get(`/v1/selection-lists/${TEST_LIST_ID}/items`)
      .set(authHeader());
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('POST /:listId/items returns 404', async () => {
    const res = await request(app)
      .post(`/v1/selection-lists/${TEST_LIST_ID}/items`)
      .set(authHeader())
      .send({ code: 'US', label: 'United States' });
    expect(res.status).toBe(404);
  });

  it('PATCH /:listId/items/:itemId returns 404', async () => {
    const res = await request(app)
      .patch(`/v1/selection-lists/${TEST_LIST_ID}/items/${TEST_ITEM_ID}`)
      .set(authHeader())
      .send({ label: 'Updated' });
    expect(res.status).toBe(404);
  });

  it('DELETE /:listId/items/:itemId returns 404', async () => {
    const res = await request(app)
      .delete(`/v1/selection-lists/${TEST_LIST_ID}/items/${TEST_ITEM_ID}`)
      .set(authHeader());
    expect(res.status).toBe(404);
  });
});

// ─── GET /:listId/items ───────────────────────────────────────────────────────

describe('GET /v1/selection-lists/:listId/items', () => {
  it('returns paginated items with correct envelope shape', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] }) // list check
      .mockResolvedValueOnce({ rows: [ITEM_ROW] })                 // main query
      .mockResolvedValueOnce({ rows: [{ total: '1' }] });          // count

    const res = await request(app)
      .get(`/v1/selection-lists/${TEST_LIST_ID}/items`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('page');
    expect(res.body.page).toHaveProperty('nextCursor');
    expect(res.body.page).toHaveProperty('hasMore');
    expect(res.body.page).toHaveProperty('total');
    expect(res.body.page.hasMore).toBe(false);
    expect(res.body.page.total).toBe(1);
    expect(res.body.items[0].id).toBe(TEST_ITEM_ID);
    expect(res.body.items[0].code).toBe('US');
    expect(res.body.items[0].label).toBe('United States');
    expect(res.body.items[0].sort_order).toBe(100);
  });

  it('enforces MAX_PAGE_SIZE — clamps limit to 200', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    const res = await request(app)
      .get(`/v1/selection-lists/${TEST_LIST_ID}/items?limit=9999`)
      .set(authHeader());

    expect(res.status).toBe(200);
    // The query should pass limit+1 = 201 (clamped to 200, then +1)
    const mainQueryParams = mockRaw.mock.calls[1][1] as unknown[];
    const lastNumericParam = [...mainQueryParams].reverse().find((p) => typeof p === 'number');
    expect(lastNumericParam).toBe(201);
  });

  it('sets hasMore=true and nextCursor when more rows exist', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      ...ITEM_ROW,
      id: `front_sli_row${String(i).padStart(19, '0')}`,
      sort_order: (i + 1) * 100,
    }));

    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] })
      .mockResolvedValueOnce({ rows })
      .mockResolvedValueOnce({ rows: [{ total: '51' }] });

    const res = await request(app)
      .get(`/v1/selection-lists/${TEST_LIST_ID}/items?limit=50`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.page.hasMore).toBe(true);
    expect(res.body.page.nextCursor).toBeTruthy();
    expect(res.body.items).toHaveLength(50);
  });

  it('uses cursor from previous page correctly', async () => {
    const cursor = Buffer.from(
      JSON.stringify({ sortOrder: 100, id: TEST_ITEM_ID }),
      'utf8',
    ).toString('base64url');

    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    const res = await request(app)
      .get(`/v1/selection-lists/${TEST_LIST_ID}/items?cursor=${cursor}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    // Verify cursor params appear in the main query
    const mainQueryParams = mockRaw.mock.calls[1][1] as unknown[];
    expect(mainQueryParams).toContain(100);
    expect(mainQueryParams).toContain(TEST_ITEM_ID);
  });

  it('returns 400 for invalid cursor', async () => {
    mockRaw.mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] });

    const res = await request(app)
      .get(`/v1/selection-lists/${TEST_LIST_ID}/items?cursor=invalid!cursor`)
      .set(authHeader());

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when list not found', async () => {
    mockRaw.mockResolvedValueOnce({ rows: [] }); // list check returns empty

    const res = await request(app)
      .get(`/v1/selection-lists/front_sl_nonexistent0000000000/items`)
      .set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

// ─── POST /:listId/items ──────────────────────────────────────────────────────

describe('POST /v1/selection-lists/:listId/items', () => {
  it('creates item and returns 201 with correct shape', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] }) // list check
      .mockResolvedValueOnce({ rows: [{ max_order: '200' }] })     // max sort_order
      .mockResolvedValueOnce({ rows: [ITEM_ROW] });                // fetch created

    mockTrxRaw
      .mockResolvedValueOnce({ rows: [] }) // INSERT item
      .mockResolvedValueOnce({ rows: [] }); // INSERT translation

    const res = await request(app)
      .post(`/v1/selection-lists/${TEST_LIST_ID}/items`)
      .set(authHeader())
      .send({ code: 'US', label: 'United States' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(TEST_ITEM_ID);
    expect(res.body.code).toBe('US');
    expect(res.body.label).toBe('United States');
    expect(res.body.list_id).toBe(TEST_LIST_ID);
    expect(res.body.status).toBe('active');
  });

  it('mints the id — rejects client-supplied id', async () => {
    const res = await request(app)
      .post(`/v1/selection-lists/${TEST_LIST_ID}/items`)
      .set(authHeader())
      .send({ code: 'US', label: 'United States', id: 'client-chosen-id' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when code is missing', async () => {
    const res = await request(app)
      .post(`/v1/selection-lists/${TEST_LIST_ID}/items`)
      .set(authHeader())
      .send({ label: 'United States' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when label is missing', async () => {
    const res = await request(app)
      .post(`/v1/selection-lists/${TEST_LIST_ID}/items`)
      .set(authHeader())
      .send({ code: 'US' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when list not found', async () => {
    mockRaw.mockResolvedValueOnce({ rows: [] }); // list check returns empty

    const res = await request(app)
      .post(`/v1/selection-lists/front_sl_nonexistent0000000000/items`)
      .set(authHeader())
      .send({ code: 'US', label: 'United States' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 409 on duplicate code', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] })
      .mockResolvedValueOnce({ rows: [{ max_order: '100' }] });

    mockTrxRaw.mockRejectedValueOnce({ code: '23505' });

    const res = await request(app)
      .post(`/v1/selection-lists/${TEST_LIST_ID}/items`)
      .set(authHeader())
      .send({ code: 'US', label: 'United States' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('appends at max+100 when sort_order not supplied', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] }) // list check
      .mockResolvedValueOnce({ rows: [{ max_order: '400' }] })     // max sort_order
      .mockResolvedValueOnce({ rows: [{ ...ITEM_ROW, sort_order: 500 }] }); // fetch

    mockTrxRaw
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post(`/v1/selection-lists/${TEST_LIST_ID}/items`)
      .set(authHeader())
      .send({ code: 'CA', label: 'Canada' });

    expect(res.status).toBe(201);
    // Verify the insert used sort_order = 500 (max 400 + 100)
    const insertParams = mockTrxRaw.mock.calls[0][1] as unknown[];
    expect(insertParams).toContain(500);
  });
});

// ─── PUT /:listId/items/reorder ───────────────────────────────────────────────

describe('PUT /v1/selection-lists/:listId/items/reorder', () => {
  const ITEM_ID_A = 'front_sli_aaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const ITEM_ID_B = 'front_sli_bbbbbbbbbbbbbbbbbbbbbbbbbbb';

  it('reorders items and returns 200 with items array', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] }) // list check
      .mockResolvedValueOnce({ rows: [{ id: ITEM_ID_A }, { id: ITEM_ID_B }] }) // active items
      .mockResolvedValueOnce({ rows: [{ ...ITEM_ROW, id: ITEM_ID_A, sort_order: 100 }, { ...ITEM_ROW, id: ITEM_ID_B, sort_order: 200 }] }); // after reorder

    mockTrxRaw
      .mockResolvedValueOnce({ rows: [] }) // UPDATE item A
      .mockResolvedValueOnce({ rows: [] }); // UPDATE item B

    const res = await request(app)
      .put(`/v1/selection-lists/${TEST_LIST_ID}/items/reorder`)
      .set(authHeader())
      .send({ item_ids: [ITEM_ID_A, ITEM_ID_B] });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('returns 400 when item_ids is not an array', async () => {
    mockRaw.mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] });

    const res = await request(app)
      .put(`/v1/selection-lists/${TEST_LIST_ID}/items/reorder`)
      .set(authHeader())
      .send({ item_ids: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when item_ids count does not match active items', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] })
      .mockResolvedValueOnce({ rows: [{ id: ITEM_ID_A }, { id: ITEM_ID_B }] });

    const res = await request(app)
      .put(`/v1/selection-lists/${TEST_LIST_ID}/items/reorder`)
      .set(authHeader())
      .send({ item_ids: [ITEM_ID_A] }); // missing ITEM_ID_B

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when list not found', async () => {
    mockRaw.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put(`/v1/selection-lists/front_sl_nonexistent0000000000/items/reorder`)
      .set(authHeader())
      .send({ item_ids: [ITEM_ID_A] });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

// ─── PATCH /:listId/items/:itemId ─────────────────────────────────────────────

describe('PATCH /v1/selection-lists/:listId/items/:itemId', () => {
  it('updates label and returns 200', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] }) // list check
      .mockResolvedValueOnce({ rows: [{ id: TEST_ITEM_ID }] })     // item exists
      .mockResolvedValueOnce({ rows: [{ ...ITEM_ROW, label: 'USA' }] }); // fetch updated

    mockTrxRaw
      .mockResolvedValueOnce({ rows: [] }); // UPSERT translation

    const res = await request(app)
      .patch(`/v1/selection-lists/${TEST_LIST_ID}/items/${TEST_ITEM_ID}`)
      .set(authHeader())
      .send({ label: 'USA' });

    expect(res.status).toBe(200);
    expect(res.body.label).toBe('USA');
  });

  it('rejects code in body (immutable field)', async () => {
    const res = await request(app)
      .patch(`/v1/selection-lists/${TEST_LIST_ID}/items/${TEST_ITEM_ID}`)
      .set(authHeader())
      .send({ code: 'NEW_CODE' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for empty body', async () => {
    const res = await request(app)
      .patch(`/v1/selection-lists/${TEST_LIST_ID}/items/${TEST_ITEM_ID}`)
      .set(authHeader())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when item not found', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] }) // list check
      .mockResolvedValueOnce({ rows: [] }); // item check returns empty

    const res = await request(app)
      .patch(`/v1/selection-lists/${TEST_LIST_ID}/items/front_sli_nonexistent000000000`)
      .set(authHeader())
      .send({ label: 'Updated' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 404 when list not found', async () => {
    mockRaw.mockResolvedValueOnce({ rows: [] }); // list check returns empty

    const res = await request(app)
      .patch(`/v1/selection-lists/front_sl_nonexistent0000000000/items/${TEST_ITEM_ID}`)
      .set(authHeader())
      .send({ label: 'Updated' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

// ─── DELETE /:listId/items/:itemId ────────────────────────────────────────────

describe('DELETE /v1/selection-lists/:listId/items/:itemId', () => {
  it('archives item (soft-delete) by default and returns 200', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] }) // list check
      .mockResolvedValueOnce({ rows: [{ id: TEST_ITEM_ID }] })     // item exists
      .mockResolvedValueOnce({ rows: [] })                          // UPDATE archived
      .mockResolvedValueOnce({ rows: [{ ...ITEM_ROW, status: 'archived' }] }); // fetch

    const res = await request(app)
      .delete(`/v1/selection-lists/${TEST_LIST_ID}/items/${TEST_ITEM_ID}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('archived');
  });

  it('hard-deletes with purge=true and returns 204', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] }) // list check
      .mockResolvedValueOnce({ rows: [{ id: TEST_ITEM_ID }] });    // item exists

    mockTrxRaw
      .mockResolvedValueOnce({ rows: [] }) // DELETE translations
      .mockResolvedValueOnce({ rows: [] }); // DELETE item

    const res = await request(app)
      .delete(`/v1/selection-lists/${TEST_LIST_ID}/items/${TEST_ITEM_ID}?purge=true`)
      .set(authHeader());

    expect(res.status).toBe(204);
  });

  it('returns 404 when item not found', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] }) // list check
      .mockResolvedValueOnce({ rows: [] }); // item check returns empty

    const res = await request(app)
      .delete(`/v1/selection-lists/${TEST_LIST_ID}/items/front_sli_nonexistent000000000`)
      .set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

// ─── POST /:listId/items/:itemId/archive ──────────────────────────────────────

describe('POST /v1/selection-lists/:listId/items/:itemId/archive', () => {
  it('archives item and returns 200', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] }) // list check
      .mockResolvedValueOnce({ rows: [{ id: TEST_ITEM_ID }] })     // item exists
      .mockResolvedValueOnce({ rows: [] })                          // UPDATE
      .mockResolvedValueOnce({ rows: [{ ...ITEM_ROW, status: 'archived' }] }); // fetch

    const res = await request(app)
      .post(`/v1/selection-lists/${TEST_LIST_ID}/items/${TEST_ITEM_ID}/archive`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('archived');
  });

  it('returns 404 when item not found', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post(`/v1/selection-lists/${TEST_LIST_ID}/items/front_sli_nonexistent000000000/archive`)
      .set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
