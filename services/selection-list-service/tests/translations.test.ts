// translations.test.ts — unit/integration tests for the translation workbench routes.
//
// Tests run against a real Express app (supertest) with the DB and feature-flag
// modules fully mocked — no Postgres connection required.
//
// Coverage goals:
//   ✓ Feature flag OFF → 404 for every endpoint
//   ✓ Feature flag ON → normal routing
//   ✓ Missing auth → 401
//   ✓ Unknown list (not in caller's org) → 404
//   ✓ source_locale constraint → 400 for PUT/DELETE/autofill
//   ✓ Unsupported locale → 400
//   ✓ Missing required body fields → 400
//   ✓ Happy paths for all 7 routes
//   ✓ GET /translations completeness_pct and source_changed computation
//   ✓ Autofill skips human translations (is_machine=false)
//   ✓ Autofill skips fresh machine translations (hash match, overwrite_machine=false)
//   ✓ Autofill overwrites stale machine translations
//   ✓ computeSourceHash produces deterministic md5

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { computeSourceHash } from '../src/routes/translations';

// ─── Module mocks ────────────────────────────────────────────────────────────

jest.mock('../src/db', () => ({ db: jest.fn() }));
jest.mock('../src/flags', () => ({ isSelectionListsEnabled: jest.fn() }));

// Pull typed references AFTER the jest.mock calls so we get the mocked versions.
import { db } from '../src/db';
import { isSelectionListsEnabled } from '../src/flags';

const mockDb = db as jest.Mock;
const mockFlag = isSelectionListsEnabled as jest.Mock;

// ─── Test data ────────────────────────────────────────────────────────────────

const JWT_SECRET = 'translations-test-secret';
const TOKEN = jwt.sign(
  { userId: 'usr_01test', orgId: 'org_01test' },
  JWT_SECRET
);

const LIST_ID = 'front_sl_01testlist';
const ITEM_ID = 'front_sli_01testitem';

const mockList = {
  id: LIST_ID,
  organization_id: 'org_01test',
  key: 'countries',
  source_locale: 'en',
  status: 'active',
};

const mockItem = {
  id: ITEM_ID,
  list_id: LIST_ID,
  code: 'US',
  sort_order: 100,
  status: 'active',
};

const mockSourceListTrans = {
  list_id: LIST_ID,
  locale: 'en',
  name: 'Countries',
  description: 'A list of countries.',
  source_hash: null,
  is_machine: false,
  updated_at: '2026-08-10T12:00:00.000Z',
};

const mockFrListTrans = {
  list_id: LIST_ID,
  locale: 'fr',
  name: '[MT] Countries',
  description: '[MT] A list of countries.',
  source_hash: computeSourceHash('Countries', 'A list of countries.'),
  is_machine: true,
  updated_at: '2026-08-10T12:00:00.000Z',
};

const mockSourceItemTrans = {
  item_id: ITEM_ID,
  locale: 'en',
  label: 'United States',
  description: null,
  source_hash: null,
  is_machine: false,
  updated_at: '2026-08-10T12:00:00.000Z',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a mock knex query chain. `returnValue` is what .first() / awaiting the
 * chain resolves to.
 */
function chain(returnValue?: unknown) {
  const q: Record<string, jest.Mock> = {};
  const methods = [
    'where', 'whereNot', 'whereIn', 'groupBy', 'select', 'join',
    'count', 'insert', 'onConflict', 'merge', 'delete',
  ];
  methods.forEach((m) => {
    q[m] = jest.fn().mockReturnThis();
  });
  // .first() resolves to returnValue
  q['first'] = jest.fn().mockResolvedValue(returnValue);
  // Awaiting the chain directly (e.g. for count, select, listing) resolves to
  // returnValue (an array by default).
  q['then'] = (resolve: (v: unknown) => void) =>
    Promise.resolve(returnValue).then(resolve);
  return q;
}

beforeAll(() => {
  process.env.JWT_SECRET = JWT_SECRET;
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default: feature flag ON
  mockFlag.mockResolvedValue(true);
});

// ─── computeSourceHash ───────────────────────────────────────────────────────

describe('computeSourceHash', () => {
  it('produces a deterministic md5 hex string', () => {
    const h1 = computeSourceHash('Countries', 'A list.');
    const h2 = computeSourceHash('Countries', 'A list.');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{32}$/);
  });

  it('treats undefined/null description as empty string', () => {
    expect(computeSourceHash('Countries')).toBe(computeSourceHash('Countries', null));
  });

  it('differs when name or description changes', () => {
    const h1 = computeSourceHash('Countries', 'desc');
    const h2 = computeSourceHash('Countries', 'other');
    expect(h1).not.toBe(h2);
  });
});

// ─── Feature flag OFF ────────────────────────────────────────────────────────

describe('feature flag OFF', () => {
  beforeEach(() => mockFlag.mockResolvedValue(false));

  const cases: Array<[string, string, string]> = [
    ['get', `/v1/selection-lists/${LIST_ID}/translations`, ''],
    ['put', `/v1/selection-lists/${LIST_ID}/translations/fr`, ''],
    ['delete', `/v1/selection-lists/${LIST_ID}/translations/fr`, ''],
    ['get', `/v1/selection-lists/${LIST_ID}/items/${ITEM_ID}/translations`, ''],
    ['put', `/v1/selection-lists/${LIST_ID}/items/${ITEM_ID}/translations/fr`, ''],
    ['delete', `/v1/selection-lists/${LIST_ID}/items/${ITEM_ID}/translations/fr`, ''],
    ['post', `/v1/selection-lists/${LIST_ID}/translations/fr/autofill`, ''],
  ];

  test.each(cases)('%s %s → 404 when flag is OFF', async (method, url) => {
    const app = createApp();
    const res = await (request(app) as any)[method](url)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

// ─── Unauthenticated (no token) ───────────────────────────────────────────────

describe('unauthenticated', () => {
  it('GET /translations → 401 with no token', async () => {
    const app = createApp();
    const res = await request(app).get(
      `/v1/selection-lists/${LIST_ID}/translations`
    );
    expect(res.status).toBe(401);
  });
});

// ─── GET /:listId/translations ────────────────────────────────────────────────

describe('GET /:listId/translations', () => {
  const url = `/v1/selection-lists/${LIST_ID}/translations`;

  it('404 when list not found', async () => {
    mockDb
      .mockReturnValueOnce(chain(undefined)); // getListByOrg → not found

    const app = createApp();
    const res = await request(app)
      .get(url)
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('returns empty array when no non-source translations exist', async () => {
    mockDb
      .mockReturnValueOnce(chain(mockList))            // getListByOrg
      .mockReturnValueOnce(chain(mockSourceListTrans)) // source translation
      .mockReturnValueOnce(chain([]))                  // all translations (whereNot source)
      .mockReturnValueOnce(chain([{ count: '0' }]))   // active item count
      .mockReturnValueOnce(chain([]));                 // item translation counts

    const app = createApp();
    const res = await request(app)
      .get(url)
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns translation status with correct completeness_pct and source_changed=false', async () => {
    const sourceHash = computeSourceHash(
      mockSourceListTrans.name,
      mockSourceListTrans.description
    );
    const translation = { ...mockFrListTrans, source_hash: sourceHash };

    mockDb
      .mockReturnValueOnce(chain(mockList))
      .mockReturnValueOnce(chain(mockSourceListTrans))
      .mockReturnValueOnce(chain([translation]))          // translations list
      .mockReturnValueOnce(chain([{ count: '1' }]))      // 1 active item
      .mockReturnValueOnce(chain([{ locale: 'fr', count: '1' }])); // 1 item translated in fr

    const app = createApp();
    const res = await request(app)
      .get(url)
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const stat = res.body[0];
    expect(stat.locale).toBe('fr');
    // 1 list + 1 item translated out of 1 (list) + 1 (item) = 100%
    expect(stat.completeness_pct).toBe(100);
    expect(stat.machine_translated).toBe(true);
    expect(stat.source_changed).toBe(false);
  });

  it('source_changed=true when stored hash differs from current source hash', async () => {
    const staleTranslation = { ...mockFrListTrans, source_hash: 'stale-hash-abc123' };

    mockDb
      .mockReturnValueOnce(chain(mockList))
      .mockReturnValueOnce(chain(mockSourceListTrans))
      .mockReturnValueOnce(chain([staleTranslation]))
      .mockReturnValueOnce(chain([{ count: '0' }]))
      .mockReturnValueOnce(chain([]));

    const app = createApp();
    const res = await request(app)
      .get(url)
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body[0].source_changed).toBe(true);
  });

  it('completeness_pct is partial when not all items are translated', async () => {
    // 1 list translated + 2 items translated out of 1 list + 4 items = 60%
    const translation = { ...mockFrListTrans };

    mockDb
      .mockReturnValueOnce(chain(mockList))
      .mockReturnValueOnce(chain(mockSourceListTrans))
      .mockReturnValueOnce(chain([translation]))
      .mockReturnValueOnce(chain([{ count: '4' }]))         // 4 active items
      .mockReturnValueOnce(chain([{ locale: 'fr', count: '2' }])); // 2 fr item translations

    const app = createApp();
    const res = await request(app)
      .get(url)
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    // (1 + 2) / (1 + 4) = 3/5 = 60%
    expect(res.body[0].completeness_pct).toBe(60);
  });
});

// ─── PUT /:listId/translations/:locale ───────────────────────────────────────

describe('PUT /:listId/translations/:locale', () => {
  const url = `/v1/selection-lists/${LIST_ID}/translations/fr`;

  it('400 for unsupported locale', async () => {
    const app = createApp();
    const res = await request(app)
      .put(`/v1/selection-lists/${LIST_ID}/translations/xx`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ name: 'Pays' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('400 when name is missing', async () => {
    const app = createApp();
    const res = await request(app)
      .put(url)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ description: 'something' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('404 when list not found', async () => {
    mockDb.mockReturnValueOnce(chain(undefined)); // getListByOrg → null

    const app = createApp();
    const res = await request(app)
      .put(url)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ name: 'Pays' });
    expect(res.status).toBe(404);
  });

  it('400 when locale === source_locale', async () => {
    mockDb.mockReturnValueOnce(chain(mockList)); // getListByOrg

    const app = createApp();
    const res = await request(app)
      .put(`/v1/selection-lists/${LIST_ID}/translations/en`) // en is source_locale
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ name: 'Countries' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toMatch(/source_locale/);
  });

  it('200 happy path — upserts translation and returns it', async () => {
    const saved = {
      list_id: LIST_ID,
      locale: 'fr',
      name: 'Pays',
      description: null,
      source_hash: computeSourceHash('Countries', 'A list of countries.'),
      is_machine: false,
      updated_at: '2026-08-10T12:00:00.000Z',
    };

    // getListByOrg
    mockDb.mockReturnValueOnce(chain(mockList));
    // source translation fetch
    mockDb.mockReturnValueOnce(chain(mockSourceListTrans));
    // insert + onConflict + merge chain (returns self until resolved)
    const insertChain = {
      insert: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      merge: jest.fn().mockResolvedValue(undefined),
    };
    mockDb.mockReturnValueOnce(insertChain);
    // re-fetch saved translation
    mockDb.mockReturnValueOnce(chain(saved));

    const app = createApp();
    const res = await request(app)
      .put(url)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ name: 'Pays' });

    expect(res.status).toBe(200);
    expect(res.body.locale).toBe('fr');
    expect(res.body.name).toBe('Pays');
    expect(res.body.is_machine).toBe(false);
    expect(res.body.source_hash).toBeTruthy();
  });
});

// ─── DELETE /:listId/translations/:locale ────────────────────────────────────

describe('DELETE /:listId/translations/:locale', () => {
  const url = `/v1/selection-lists/${LIST_ID}/translations/fr`;

  it('400 for unsupported locale', async () => {
    const app = createApp();
    const res = await request(app)
      .delete(`/v1/selection-lists/${LIST_ID}/translations/xx`)
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(400);
  });

  it('404 when list not found', async () => {
    mockDb.mockReturnValueOnce(chain(undefined));
    const app = createApp();
    const res = await request(app).delete(url).set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('400 when locale === source_locale', async () => {
    mockDb.mockReturnValueOnce(chain(mockList));
    const app = createApp();
    const res = await request(app)
      .delete(`/v1/selection-lists/${LIST_ID}/translations/en`)
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/source_locale/);
  });

  it('204 happy path', async () => {
    const deleteChain = {
      where: jest.fn().mockReturnThis(),
      delete: jest.fn().mockResolvedValue(1),
    };
    mockDb
      .mockReturnValueOnce(chain(mockList)) // getListByOrg
      .mockReturnValueOnce(deleteChain);    // delete

    const app = createApp();
    const res = await request(app).delete(url).set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(204);
  });
});

// ─── GET /:listId/items/:itemId/translations ──────────────────────────────────

describe('GET /:listId/items/:itemId/translations', () => {
  const url = `/v1/selection-lists/${LIST_ID}/items/${ITEM_ID}/translations`;

  it('404 when list not found', async () => {
    mockDb.mockReturnValueOnce(chain(undefined));
    const app = createApp();
    const res = await request(app).get(url).set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('404 when item not found in list', async () => {
    mockDb
      .mockReturnValueOnce(chain(mockList))    // getListByOrg
      .mockReturnValueOnce(chain(undefined)); // getItemByList → not found

    const app = createApp();
    const res = await request(app).get(url).set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/Item/);
  });

  it('200 returns item translation status list', async () => {
    const sourceHash = computeSourceHash('United States', null);
    const frItemTrans = {
      item_id: ITEM_ID,
      locale: 'fr',
      label: '[MT] United States',
      description: null,
      source_hash: sourceHash,
      is_machine: true,
    };

    mockDb
      .mockReturnValueOnce(chain(mockList))
      .mockReturnValueOnce(chain(mockItem))
      .mockReturnValueOnce(chain(mockSourceItemTrans))  // source item translation
      .mockReturnValueOnce(chain([frItemTrans]));        // non-source translations

    const app = createApp();
    const res = await request(app).get(url).set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].locale).toBe('fr');
    expect(res.body[0].machine_translated).toBe(true);
    expect(res.body[0].source_changed).toBe(false); // hash matches
  });

  it('source_changed=true when item hash is stale', async () => {
    const frItemTrans = {
      item_id: ITEM_ID,
      locale: 'fr',
      label: '[MT] United States',
      description: null,
      source_hash: 'old-hash',
      is_machine: true,
    };

    mockDb
      .mockReturnValueOnce(chain(mockList))
      .mockReturnValueOnce(chain(mockItem))
      .mockReturnValueOnce(chain(mockSourceItemTrans))
      .mockReturnValueOnce(chain([frItemTrans]));

    const app = createApp();
    const res = await request(app).get(url).set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body[0].source_changed).toBe(true);
  });
});

// ─── PUT /:listId/items/:itemId/translations/:locale ─────────────────────────

describe('PUT /:listId/items/:itemId/translations/:locale', () => {
  const url = `/v1/selection-lists/${LIST_ID}/items/${ITEM_ID}/translations/fr`;

  it('400 when label missing', async () => {
    const app = createApp();
    const res = await request(app)
      .put(url)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ description: 'something' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('400 when locale === source_locale', async () => {
    mockDb.mockReturnValueOnce(chain(mockList));
    const app = createApp();
    const res = await request(app)
      .put(`/v1/selection-lists/${LIST_ID}/items/${ITEM_ID}/translations/en`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ label: 'États-Unis' });
    expect(res.status).toBe(400);
  });

  it('404 when item not found', async () => {
    mockDb
      .mockReturnValueOnce(chain(mockList))    // getListByOrg
      .mockReturnValueOnce(chain(undefined)); // getItemByList

    const app = createApp();
    const res = await request(app)
      .put(url)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ label: 'États-Unis' });
    expect(res.status).toBe(404);
  });

  it('200 happy path — upserts item translation', async () => {
    const saved = {
      item_id: ITEM_ID,
      locale: 'fr',
      label: 'États-Unis',
      description: null,
      source_hash: computeSourceHash('United States', null),
      is_machine: false,
      updated_at: '2026-08-10T12:00:00.000Z',
    };

    mockDb
      .mockReturnValueOnce(chain(mockList))
      .mockReturnValueOnce(chain(mockItem))
      .mockReturnValueOnce(chain(mockSourceItemTrans)); // source item trans for hash

    const insertChain = {
      insert: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      merge: jest.fn().mockResolvedValue(undefined),
    };
    mockDb
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(chain(saved));

    const app = createApp();
    const res = await request(app)
      .put(url)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ label: 'États-Unis' });

    expect(res.status).toBe(200);
    expect(res.body.locale).toBe('fr');
    expect(res.body.label).toBe('États-Unis');
    expect(res.body.is_machine).toBe(false);
  });
});

// ─── DELETE /:listId/items/:itemId/translations/:locale ───────────────────────

describe('DELETE /:listId/items/:itemId/translations/:locale', () => {
  const url = `/v1/selection-lists/${LIST_ID}/items/${ITEM_ID}/translations/fr`;

  it('400 when locale === source_locale', async () => {
    mockDb.mockReturnValueOnce(chain(mockList));
    const app = createApp();
    const res = await request(app)
      .delete(`/v1/selection-lists/${LIST_ID}/items/${ITEM_ID}/translations/en`)
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(400);
  });

  it('404 when item not found', async () => {
    mockDb
      .mockReturnValueOnce(chain(mockList))
      .mockReturnValueOnce(chain(undefined)); // item not found

    const app = createApp();
    const res = await request(app).delete(url).set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('204 happy path', async () => {
    const deleteChain = {
      where: jest.fn().mockReturnThis(),
      delete: jest.fn().mockResolvedValue(1),
    };
    mockDb
      .mockReturnValueOnce(chain(mockList))
      .mockReturnValueOnce(chain(mockItem))
      .mockReturnValueOnce(deleteChain);

    const app = createApp();
    const res = await request(app).delete(url).set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(204);
  });
});

// ─── POST /:listId/translations/:locale/autofill ──────────────────────────────

describe('POST /:listId/translations/:locale/autofill', () => {
  const url = `/v1/selection-lists/${LIST_ID}/translations/fr/autofill`;

  it('400 when locale === source_locale', async () => {
    mockDb.mockReturnValueOnce(chain(mockList));
    const app = createApp();
    const res = await request(app)
      .post(`/v1/selection-lists/${LIST_ID}/translations/en/autofill`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/source_locale/);
  });

  it('400 when source translation missing', async () => {
    mockDb
      .mockReturnValueOnce(chain(mockList))
      .mockReturnValueOnce(chain(undefined)); // no source list translation

    const app = createApp();
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('200 — translates list when no existing fr translation', async () => {
    // No items for simplicity.
    const insertListChain = {
      insert: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      merge: jest.fn().mockResolvedValue(undefined),
    };

    mockDb
      .mockReturnValueOnce(chain(mockList))           // getListByOrg
      .mockReturnValueOnce(chain(mockSourceListTrans)) // source list trans
      .mockReturnValueOnce(chain(undefined))           // existingListTrans → none
      .mockReturnValueOnce(insertListChain)            // insert list trans
      .mockReturnValueOnce(chain([]));                 // items query

    const app = createApp();
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.list_translated).toBe(true);
    expect(res.body.items_translated).toBe(0);
    expect(res.body.locale).toBe('fr');
    expect(res.body.source_locale).toBe('en');
  });

  it('skips human translation (is_machine=false)', async () => {
    const humanListTrans = { ...mockFrListTrans, is_machine: false };

    mockDb
      .mockReturnValueOnce(chain(mockList))
      .mockReturnValueOnce(chain(mockSourceListTrans))
      .mockReturnValueOnce(chain(humanListTrans)) // existing human translation → skip
      .mockReturnValueOnce(chain([]));             // items

    const app = createApp();
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.list_translated).toBe(false);
  });

  it('skips fresh machine translation when overwrite_machine=false', async () => {
    // The stored hash matches the current source hash → skip.
    const currentHash = computeSourceHash(
      mockSourceListTrans.name,
      mockSourceListTrans.description
    );
    const freshMachineTrans = { ...mockFrListTrans, source_hash: currentHash, is_machine: true };

    mockDb
      .mockReturnValueOnce(chain(mockList))
      .mockReturnValueOnce(chain(mockSourceListTrans))
      .mockReturnValueOnce(chain(freshMachineTrans)) // existing machine, same hash
      .mockReturnValueOnce(chain([]));               // items

    const app = createApp();
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ overwrite_machine: false });

    expect(res.status).toBe(200);
    expect(res.body.list_translated).toBe(false);
  });

  it('overwrites stale machine translation (source changed)', async () => {
    // Hash stored on the existing translation does NOT match the current source.
    const staleHash = 'old-stale-hash-000';
    const staleMachineTrans = { ...mockFrListTrans, source_hash: staleHash, is_machine: true };

    const insertChain = {
      insert: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      merge: jest.fn().mockResolvedValue(undefined),
    };

    mockDb
      .mockReturnValueOnce(chain(mockList))
      .mockReturnValueOnce(chain(mockSourceListTrans))
      .mockReturnValueOnce(chain(staleMachineTrans)) // existing but stale
      .mockReturnValueOnce(insertChain)              // upsert
      .mockReturnValueOnce(chain([]));               // items

    const app = createApp();
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.list_translated).toBe(true);
  });

  it('overwrites fresh machine translation when overwrite_machine=true', async () => {
    const currentHash = computeSourceHash(
      mockSourceListTrans.name,
      mockSourceListTrans.description
    );
    const freshMachineTrans = { ...mockFrListTrans, source_hash: currentHash, is_machine: true };
    const insertChain = {
      insert: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      merge: jest.fn().mockResolvedValue(undefined),
    };

    mockDb
      .mockReturnValueOnce(chain(mockList))
      .mockReturnValueOnce(chain(mockSourceListTrans))
      .mockReturnValueOnce(chain(freshMachineTrans))
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(chain([])); // items

    const app = createApp();
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ overwrite_machine: true });

    expect(res.status).toBe(200);
    expect(res.body.list_translated).toBe(true);
  });

  it('translates items and returns counts', async () => {
    // One item, no existing fr translation → gets translated.
    const insertListChain = {
      insert: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      merge: jest.fn().mockResolvedValue(undefined),
    };
    const insertItemChain = {
      insert: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      merge: jest.fn().mockResolvedValue(undefined),
    };

    mockDb
      .mockReturnValueOnce(chain(mockList))             // getListByOrg
      .mockReturnValueOnce(chain(mockSourceListTrans))   // source list trans
      .mockReturnValueOnce(chain(undefined))             // no existing list trans → translate
      .mockReturnValueOnce(insertListChain)              // insert list trans
      .mockReturnValueOnce(chain([{ id: ITEM_ID }]))    // items query
      .mockReturnValueOnce(chain(mockSourceItemTrans))   // source item trans
      .mockReturnValueOnce(chain(undefined))             // no existing item trans
      .mockReturnValueOnce(insertItemChain);             // insert item trans

    const app = createApp();
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.items_translated).toBe(1);
    expect(res.body.items_skipped).toBe(0);
  });

  it('skips items with human translation', async () => {
    const insertListChain = {
      insert: jest.fn().mockReturnThis(),
      onConflict: jest.fn().mockReturnThis(),
      merge: jest.fn().mockResolvedValue(undefined),
    };

    const humanItemTrans = {
      item_id: ITEM_ID,
      locale: 'fr',
      label: 'États-Unis (human)',
      description: null,
      source_hash: computeSourceHash('United States', null),
      is_machine: false,
    };

    mockDb
      .mockReturnValueOnce(chain(mockList))
      .mockReturnValueOnce(chain(mockSourceListTrans))
      .mockReturnValueOnce(chain(undefined))           // no existing list trans
      .mockReturnValueOnce(insertListChain)
      .mockReturnValueOnce(chain([{ id: ITEM_ID }]))  // items
      .mockReturnValueOnce(chain(mockSourceItemTrans)) // source item trans
      .mockReturnValueOnce(chain(humanItemTrans));     // existing human → skip

    const app = createApp();
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.items_translated).toBe(0);
    expect(res.body.items_skipped).toBe(1);
  });

  it('404 when list not found', async () => {
    mockDb.mockReturnValueOnce(chain(undefined));
    const app = createApp();
    const res = await request(app)
      .post(url)
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});
    expect(res.status).toBe(404);
  });
});
