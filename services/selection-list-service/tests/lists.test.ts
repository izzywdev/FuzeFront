// lists.test.ts — Unit tests for selection list CRUD routes (S4 — FFRNT-187).
//
// Coverage:
//   1. Feature flag OFF path → 404 on all routes
//   2. Feature flag ON path — shape/logic for each route
//   3. Pagination: limit clamping, envelope shape, cursor correctness
//   4. Input validation (key constraints, unknown props, required fields)
//   5. Duplicate key → 409 CONFLICT
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
    type === 'selectionList'
      ? 'front_sl_01testlistid000000000000'
      : `front_sli_${type}`,
}));

// ─── Quota middleware mock (S6 concern — pass-through in S4 tests) ────────────

jest.mock('../src/middleware/quota', () => ({
  enforceListQuota: (_req: any, _res: any, next: any) => next(),
  enforceItemQuota: (_req: any, _res: any, next: any) => next(),
}));

// ─── Test helpers ─────────────────────────────────────────────────────────────

const JWT_SECRET = 'test-secret-s4-lists';
const TEST_USER_ID = 'usr_01testuserid0000000000000';
const TEST_ORG_ID  = 'org_01testorgid00000000000000';
const TEST_LIST_ID = 'front_sl_01testlistid000000000000';

function authHeader() {
  const token = jwt.sign({ userId: TEST_USER_ID, orgId: TEST_ORG_ID }, JWT_SECRET);
  return { Authorization: `Bearer ${token}` };
}

const LIST_ROW = {
  id: TEST_LIST_ID,
  organization_id: TEST_ORG_ID,
  key: 'countries',
  source_locale: 'en',
  status: 'active',
  created_by: TEST_USER_ID,
  created_at: new Date('2026-08-10T12:00:00Z'),
  updated_at: new Date('2026-08-10T12:00:00Z'),
  name: 'Countries',
  description: null,
  resolved_locale: 'en',
  is_machine: false,
  item_count: '0',
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
  // mockReset clears both call history AND the specificReturnValues queue
  // (mockClear/clearAllMocks only clears call history, not the once-queues).
  mockRaw.mockReset();
  mockTrxRaw.mockReset();
  mockTransaction.mockReset();
  // Re-establish the transaction implementation after reset.
  mockTransaction.mockImplementation(async (cb: (t: typeof mockTrx) => Promise<void>) => cb(mockTrx));
  setFlagClient({ getBooleanValue: async () => true });
});

// ─── Feature flag OFF ─────────────────────────────────────────────────────────

describe('Feature flag OFF — lists routes', () => {
  beforeEach(() => { setFlagClient({ getBooleanValue: async () => false }); });
  afterEach(() => { setFlagClient({ getBooleanValue: async () => true }); });

  it('GET / returns 404', async () => {
    const res = await request(app)
      .get('/v1/selection-lists')
      .set(authHeader());
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('GET /:listId returns 404', async () => {
    const res = await request(app)
      .get(`/v1/selection-lists/${TEST_LIST_ID}`)
      .set(authHeader());
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('PATCH /:listId returns 404', async () => {
    const res = await request(app)
      .patch(`/v1/selection-lists/${TEST_LIST_ID}`)
      .set(authHeader())
      .send({ key: 'new-key' });
    expect(res.status).toBe(404);
  });

  it('DELETE /:listId returns 404', async () => {
    const res = await request(app)
      .delete(`/v1/selection-lists/${TEST_LIST_ID}`)
      .set(authHeader());
    expect(res.status).toBe(404);
  });

  it('POST /:listId/archive returns 404', async () => {
    const res = await request(app)
      .post(`/v1/selection-lists/${TEST_LIST_ID}/archive`)
      .set(authHeader());
    expect(res.status).toBe(404);
  });
});

// ─── GET / — list all ─────────────────────────────────────────────────────────

describe('GET /v1/selection-lists', () => {
  it('returns paginated envelope with correct shape', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [LIST_ROW] })        // main query
      .mockResolvedValueOnce({ rows: [{ total: '1' }] }); // count query

    const res = await request(app)
      .get('/v1/selection-lists')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('page');
    expect(res.body.page).toHaveProperty('nextCursor');
    expect(res.body.page).toHaveProperty('hasMore');
    expect(res.body.page).toHaveProperty('total');
    expect(res.body.page.hasMore).toBe(false);
    expect(res.body.page.total).toBe(1);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items[0].id).toBe(TEST_LIST_ID);
    expect(res.body.items[0].key).toBe('countries');
    expect(res.body.items[0].name).toBe('Countries');
    expect(res.body.items[0].resolved_locale).toBe('en');
  });

  it('enforces MAX_PAGE_SIZE — clamps limit to 200', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    const res = await request(app)
      .get('/v1/selection-lists?limit=9999')
      .set(authHeader());

    expect(res.status).toBe(200);
    // The query should have been called with limit+1 = 201
    const sqlCall = mockRaw.mock.calls[0][0] as string;
    // The clamped limit+1 should appear in params
    const params = mockRaw.mock.calls[0][1] as unknown[];
    // Last numeric param is limit+1 (200+1=201)
    const lastNumericParam = [...params].reverse().find((p) => typeof p === 'number');
    expect(lastNumericParam).toBe(201);
  });

  it('sets hasMore=true and nextCursor when more rows exist', async () => {
    // Return limit+1 rows to trigger hasMore
    const rows = Array.from({ length: 51 }, (_, i) => ({
      ...LIST_ROW,
      id: `front_sl_row${String(i).padStart(20, '0')}`,
      created_at: new Date(`2026-08-10T${String(12 - i % 12).padStart(2, '0')}:00:00Z`),
    }));
    mockRaw
      .mockResolvedValueOnce({ rows })
      .mockResolvedValueOnce({ rows: [{ total: '51' }] });

    const res = await request(app)
      .get('/v1/selection-lists?limit=50')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.page.hasMore).toBe(true);
    expect(res.body.page.nextCursor).toBeTruthy();
    expect(res.body.items).toHaveLength(50);
  });

  it('uses cursor from previous page correctly', async () => {
    // First encode a cursor
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: '2026-08-10T12:00:00.000Z', id: TEST_LIST_ID }),
      'utf8',
    ).toString('base64url');

    mockRaw
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: '0' }] });

    const res = await request(app)
      .get(`/v1/selection-lists?cursor=${cursor}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    // Verify the cursor params were passed to the SQL
    const params = mockRaw.mock.calls[0][1] as unknown[];
    expect(params).toContain('2026-08-10T12:00:00.000Z');
    expect(params).toContain(TEST_LIST_ID);
  });

  it('returns 400 for an invalid cursor', async () => {
    const res = await request(app)
      .get('/v1/selection-lists?cursor=not-valid-base64-json')
      .set(authHeader());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid status filter', async () => {
    const res = await request(app)
      .get('/v1/selection-lists?status=deleted')
      .set(authHeader());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 when no JWT', async () => {
    const res = await request(app).get('/v1/selection-lists');
    expect(res.status).toBe(401);
  });
});

// ─── POST / — create a list ───────────────────────────────────────────────────

describe('POST /v1/selection-lists', () => {
  it('creates a list and returns 201 with correct shape', async () => {
    mockTrxRaw
      .mockResolvedValueOnce({ rows: [] }) // INSERT into selection_lists
      .mockResolvedValueOnce({ rows: [] }); // INSERT into translations

    mockRaw.mockResolvedValueOnce({ rows: [LIST_ROW] }); // fetchList after insert

    const res = await request(app)
      .post('/v1/selection-lists')
      .set(authHeader())
      .send({ key: 'countries', name: 'Countries' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('front_sl_01testlistid000000000000');
    expect(res.body.key).toBe('countries');
    expect(res.body.name).toBe('Countries');
    expect(res.body.status).toBe('active');
    expect(res.body.organization_id).toBe(TEST_ORG_ID);
  });

  it('mints the id — never uses client-supplied id', async () => {
    // 'id' is not in allowedProps — validation rejects it before any DB calls.
    const res = await request(app)
      .post('/v1/selection-lists')
      .set(authHeader())
      .send({ key: 'countries', name: 'Countries', id: 'client-chosen-id' });

    // Unknown property 'id' should cause 400
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when key is missing', async () => {
    const res = await request(app)
      .post('/v1/selection-lists')
      .set(authHeader())
      .send({ name: 'Countries' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/v1/selection-lists')
      .set(authHeader())
      .send({ key: 'countries' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid key format', async () => {
    const res = await request(app)
      .post('/v1/selection-lists')
      .set(authHeader())
      .send({ key: 'Countries With Spaces', name: 'Countries' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for unsupported source_locale', async () => {
    const res = await request(app)
      .post('/v1/selection-lists')
      .set(authHeader())
      .send({ key: 'countries', name: 'Countries', source_locale: 'klingon' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 on duplicate key', async () => {
    mockTrxRaw.mockRejectedValueOnce({ code: '23505' });

    const res = await request(app)
      .post('/v1/selection-lists')
      .set(authHeader())
      .send({ key: 'countries', name: 'Countries' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
  });
});

// ─── GET /:listId ─────────────────────────────────────────────────────────────

describe('GET /v1/selection-lists/:listId', () => {
  it('returns the list with correct shape', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ source_locale: 'en' }] }) // quick fetch
      .mockResolvedValueOnce({ rows: [LIST_ROW] }); // full fetch with translations

    const res = await request(app)
      .get(`/v1/selection-lists/${TEST_LIST_ID}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(TEST_LIST_ID);
    expect(res.body.key).toBe('countries');
    expect(res.body.resolved_locale).toBe('en');
    expect(typeof res.body.is_machine).toBe('boolean');
  });

  it('returns 404 when list not found', async () => {
    mockRaw.mockResolvedValueOnce({ rows: [] }); // quick fetch returns empty

    const res = await request(app)
      .get(`/v1/selection-lists/front_sl_nonexistent0000000000`)
      .set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 401 when no JWT', async () => {
    const res = await request(app).get(`/v1/selection-lists/${TEST_LIST_ID}`);
    expect(res.status).toBe(401);
  });
});

// ─── PATCH /:listId ───────────────────────────────────────────────────────────

describe('PATCH /v1/selection-lists/:listId', () => {
  it('updates name and returns 200', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ id: TEST_LIST_ID, source_locale: 'en', status: 'active', key: 'countries' }] }) // fetch existing
      .mockResolvedValueOnce({ rows: [{ ...LIST_ROW, name: 'Countries Updated' }] }); // fetch after update

    mockTrxRaw
      .mockResolvedValueOnce({ rows: [] }) // UPDATE selection_lists
      .mockResolvedValueOnce({ rows: [] }); // UPSERT translation

    const res = await request(app)
      .patch(`/v1/selection-lists/${TEST_LIST_ID}`)
      .set(authHeader())
      .send({ name: 'Countries Updated' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Countries Updated');
  });

  it('returns 400 for empty body', async () => {
    const res = await request(app)
      .patch(`/v1/selection-lists/${TEST_LIST_ID}`)
      .set(authHeader())
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for unknown properties', async () => {
    const res = await request(app)
      .patch(`/v1/selection-lists/${TEST_LIST_ID}`)
      .set(authHeader())
      .send({ nonexistent_field: 'value' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when list not found', async () => {
    mockRaw.mockResolvedValueOnce({ rows: [] }); // fetch existing returns empty

    const res = await request(app)
      .patch(`/v1/selection-lists/front_sl_nonexistent0000000000`)
      .set(authHeader())
      .send({ key: 'new-key' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns 409 on duplicate key', async () => {
    mockRaw.mockResolvedValueOnce({
      rows: [{ id: TEST_LIST_ID, source_locale: 'en', status: 'active', key: 'countries' }],
    });
    mockTrxRaw.mockRejectedValueOnce({ code: '23505' });

    const res = await request(app)
      .patch(`/v1/selection-lists/${TEST_LIST_ID}`)
      .set(authHeader())
      .send({ key: 'duplicate-key' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
  });
});

// ─── DELETE /:listId ──────────────────────────────────────────────────────────

describe('DELETE /v1/selection-lists/:listId', () => {
  it('archives (soft-delete) by default and returns 200', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ id: TEST_LIST_ID }] }) // check exists
      .mockResolvedValueOnce({ rows: [] })                      // UPDATE archived
      .mockResolvedValueOnce({ rows: [{ ...LIST_ROW, status: 'archived' }] }); // fetch after

    const res = await request(app)
      .delete(`/v1/selection-lists/${TEST_LIST_ID}`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('archived');
  });

  it('hard-deletes with purge=true and returns 204', async () => {
    mockRaw.mockResolvedValueOnce({ rows: [{ id: TEST_LIST_ID }] }); // check exists

    mockTrxRaw
      .mockResolvedValueOnce({ rows: [] }) // DELETE item translations
      .mockResolvedValueOnce({ rows: [] }) // DELETE items
      .mockResolvedValueOnce({ rows: [] }) // DELETE list translations
      .mockResolvedValueOnce({ rows: [] }); // DELETE list

    const res = await request(app)
      .delete(`/v1/selection-lists/${TEST_LIST_ID}?purge=true`)
      .set(authHeader());

    expect(res.status).toBe(204);
  });

  it('returns 404 when list not found', async () => {
    mockRaw.mockResolvedValueOnce({ rows: [] }); // check exists returns empty

    const res = await request(app)
      .delete(`/v1/selection-lists/front_sl_nonexistent0000000000`)
      .set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

// ─── POST /:listId/archive ────────────────────────────────────────────────────

describe('POST /v1/selection-lists/:listId/archive', () => {
  it('archives the list and returns 200', async () => {
    mockRaw
      .mockResolvedValueOnce({ rows: [{ id: TEST_LIST_ID }] }) // check exists
      .mockResolvedValueOnce({ rows: [] })                      // UPDATE archived
      .mockResolvedValueOnce({ rows: [{ ...LIST_ROW, status: 'archived' }] }); // fetch after

    const res = await request(app)
      .post(`/v1/selection-lists/${TEST_LIST_ID}/archive`)
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('archived');
  });

  it('returns 404 when list not found', async () => {
    mockRaw.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post(`/v1/selection-lists/front_sl_nonexistent0000000000/archive`)
      .set(authHeader());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
