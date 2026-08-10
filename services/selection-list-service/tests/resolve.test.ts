// resolve.test.ts — Unit/integration tests for POST /v1/resolve.
//
// Coverage:
//   - Feature flag OFF  → 404 (both states tested per governance)
//   - Feature flag ON   → 200 / 400 / 401 per spec
//   - Hard limit: ids > 500 → 400; exactly 500 → allowed
//   - Pagination-exempt note: resolve is NOT paginated (it's a bulk lookup, not
//     an unbounded collection endpoint; the 500-id hard cap makes it bounded).
//   - Empty ids: 200 with { results: {}, missing: [] }
//   - Security scoping: items from other orgs silently appear in missing
//   - Locale resolution: body.locale > Accept-Language > source_locale (SQL) > 'en'
//   - Archived items resolve normally (status: 'archived' is not missing)
//   - Missing ids: appear in `missing`, not 404
//   - Response shape matches OpenAPI ResolvedSelectionListItem (label, locale,
//     is_machine, status only — no list_id, no extra fields)
//   - No token → 401 (handled by authMiddleware before the route)
//   - Token with no orgId claim → 401 (route-level check)
//
// DB is fully mocked — no Postgres required. Flag is mocked via setFlagClient().

// ─── Module mocks — MUST be hoisted before any imports ─────────────────────────────────────────────
jest.mock('../src/db', () => ({
  db: {
    raw: jest.fn(),
  },
}));

// flags is mocked here; individual tests override via setFlagClient().
// We keep the real module shape so setFlagClient works.
jest.mock('../src/flags', () => {
  let _client: { getBooleanValue: jest.Mock } | null = null;

  const isSelectionListsEnabled = jest.fn(async (_ctx?: unknown) => {
    if (!_client) return false; // default OFF (release flag fail-safe)
    try {
      return await _client.getBooleanValue('fuzefront.selection-lists.service', false, {});
    } catch {
      return false;
    }
  });

  return {
    isSelectionListsEnabled,
    setFlagClient: (c: { getBooleanValue: jest.Mock } | null) => {
      _client = c;
      // Re-implement the mock to use the new client
      (isSelectionListsEnabled as jest.Mock).mockImplementation(async () => {
        if (!_client) return false;
        try {
          return await _client.getBooleanValue('fuzefront.selection-lists.service', false, {});
        } catch {
          return false;
        }
      });
    },
    FLAGS: { SELECTION_LISTS_SERVICE: 'fuzefront.selection-lists.service' },
  };
});

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { db } from '../src/db';
import { isSelectionListsEnabled } from '../src/flags';

// ─── Typed mock references ────────────────────────────────────────────────────────────────────────────────────
const mockDbRaw = db.raw as jest.Mock;
const mockFlagEnabled = isSelectionListsEnabled as jest.Mock;

// ─── JWT helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const UNIT_TEST_SIGNING_KEY = 'sl-resolve-unit-tests';

function makeToken(orgId: string, userId = 'usr_testuser01h455vb'): string {
  return jwt.sign({ userId, orgId }, UNIT_TEST_SIGNING_KEY);
}

function makeTokenNoOrg(userId = 'usr_testuser01h455vb'): string {
  return jwt.sign({ userId }, UNIT_TEST_SIGNING_KEY);
}

// ─── DB mock helpers ────────────────────────────────────────────────────────────────────────────────────────────────────────
type DbRow = {
  id: string;
  list_id: string;
  status: string;
  label: string | null;
  is_machine: boolean;
  resolved_locale: string | null;
};

function mockDbRows(rows: DbRow[]): void {
  mockDbRaw.mockResolvedValue({ rows });
}

function makeRow(
  id: string,
  overrides: Partial<DbRow> = {}
): DbRow {
  return {
    id,
    list_id: 'front_sl_01h455vb4pex5vsknk084sn02q',
    status: 'active',
    label: 'Test Label',
    is_machine: false,
    resolved_locale: 'en',
    ...overrides,
  };
}

// ─── Test setup ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('POST /v1/resolve', () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    process.env.JWT_SECRET = UNIT_TEST_SIGNING_KEY;
    app = createApp();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Feature flag OFF path ──────────────────────────────────────────────────────────────────────────────────
  describe('feature flag OFF (both states tested)', () => {
    it('returns 404 when service-enabled flag is OFF', async () => {
      mockFlagEnabled.mockResolvedValue(false);

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${makeToken('org_test01h455vb4pex5vs')}`)
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'] });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('does not query the DB when flag is OFF', async () => {
      mockFlagEnabled.mockResolvedValue(false);

      await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${makeToken('org_test01h455vb4pex5vs')}`)
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'] });

      expect(mockDbRaw).not.toHaveBeenCalled();
    });

    it('processes requests normally when flag is ON', async () => {
      mockFlagEnabled.mockResolvedValue(true);
      mockDbRows([]);

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${makeToken('org_test01h455vb4pex5vs')}`)
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'] });

      expect(res.status).toBe(200);
    });
  });

  // ── Authentication ────────────────────────────────────────────────────────────────────────────────────
  describe('authentication', () => {
    it('returns 401 when Authorization header is absent', async () => {
      // authMiddleware runs before the route, handles this.
      const res = await request(app)
        .post('/v1/resolve')
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'] });

      expect(res.status).toBe(401);
    });

    it('returns 401 when token is invalid', async () => {
      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', 'Bearer not-a-valid-token')
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'] });

      expect(res.status).toBe(401);
    });

    it('returns 401 when token has no orgId claim', async () => {
      mockFlagEnabled.mockResolvedValue(true);

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${makeTokenNoOrg()}`)
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'] });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });
  });

  // ── Input validation ────────────────────────────────────────────────────────────────────────────────────
  describe('input validation', () => {
    const AUTH = () => makeToken('org_test01h455vb4pex5vs');

    beforeEach(() => {
      mockFlagEnabled.mockResolvedValue(true);
    });

    it('returns 400 when ids field is absent', async () => {
      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when ids is a string (not an array)', async () => {
      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids: 'front_sli_01h455vb4pex5vsknk084sn02q' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when ids is an object (not an array)', async () => {
      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids: { id: 'front_sli_01h455vb4pex5vsknk084sn02q' } });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when ids exceeds the 500-item hard limit', async () => {
      const ids = Array.from({ length: 501 }, () => 'front_sli_01h455vb4pex5vsknk084sn02q');

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.message).toContain('500');
    });

    it('allows exactly 500 ids (the maximum)', async () => {
      mockDbRows([]);
      // 500 identical ids: DB returns nothing, all go to missing — that is fine.
      const ids = Array.from({ length: 500 }, () => 'front_sli_01h455vb4pex5vsknk084sn02q');

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids });

      expect(res.status).toBe(200);
    });
  });

  // ── Empty ids array ────────────────────────────────────────────────────────────────────────────────────
  describe('empty ids array', () => {
    it('returns 200 with empty results and missing for an empty array', async () => {
      mockFlagEnabled.mockResolvedValue(true);

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${makeToken('org_test01h455vb4pex5vs')}`)
        .send({ ids: [] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ results: {}, missing: [] });
    });

    it('does not query the DB for an empty ids array', async () => {
      mockFlagEnabled.mockResolvedValue(true);

      await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${makeToken('org_test01h455vb4pex5vs')}`)
        .send({ ids: [] });

      expect(mockDbRaw).not.toHaveBeenCalled();
    });
  });

  // ── Successful resolution ──────────────────────────────────────────────────────────────────────────────────
  describe('successful resolution', () => {
    const ORG = 'org_test01h455vb4pex5vs';
    const AUTH = () => makeToken(ORG);

    beforeEach(() => {
      mockFlagEnabled.mockResolvedValue(true);
    });

    it('returns results map and empty missing when all ids resolve', async () => {
      const itemId = 'front_sli_01h455vb4pex5vsknk084sn02q';
      mockDbRows([makeRow(itemId, { label: 'France', resolved_locale: 'fr', is_machine: false })]);

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids: [itemId], locale: 'fr' });

      expect(res.status).toBe(200);
      expect(res.body.results[itemId]).toEqual({
        label: 'France',
        locale: 'fr',
        is_machine: false,
        status: 'active',
      });
      expect(res.body.missing).toEqual([]);
    });

    it('places unfound ids in missing without 404', async () => {
      const missingId = 'front_sli_notfound01h455vb4pex000';
      mockDbRows([]); // DB returns nothing

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids: [missingId] });

      expect(res.status).toBe(200);
      expect(res.body.results).toEqual({});
      expect(res.body.missing).toContain(missingId);
    });

    it('handles a mixed batch: some resolved, some missing', async () => {
      const foundId = 'front_sli_01h455vb4pex5vsknk084sn02q';
      const missingId = 'front_sli_missingonexxxxxxxxxxxxxxxx';
      mockDbRows([makeRow(foundId, { label: 'United States', resolved_locale: 'en' })]);

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids: [foundId, missingId] });

      expect(res.status).toBe(200);
      expect(res.body.results[foundId]).toBeDefined();
      expect(res.body.missing).toContain(missingId);
      expect(res.body.missing).not.toContain(foundId);
    });

    it('resolves multiple items in a single DB call', async () => {
      const id1 = 'front_sli_01h455vb4pex5vsknk084sn02q';
      const id2 = 'front_sli_02h455vb4pex5vsknk084sn02q';
      mockDbRows([
        makeRow(id1, { label: 'Alpha', resolved_locale: 'en' }),
        makeRow(id2, { label: 'Beta', resolved_locale: 'en' }),
      ]);

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids: [id1, id2] });

      expect(res.status).toBe(200);
      expect(Object.keys(res.body.results)).toHaveLength(2);
      expect(mockDbRaw).toHaveBeenCalledTimes(1); // single DB call
    });
  });

  // ── Archived items ────────────────────────────────────────────────────────────────────────────────────
  describe('archived items resolve normally', () => {
    it('returns archived item in results (not missing)', async () => {
      mockFlagEnabled.mockResolvedValue(true);
      const archivedId = 'front_sli_01h455vb4pex5vsknk084sn02q';
      mockDbRows([makeRow(archivedId, { status: 'archived', label: 'Legacy Choice' })]);

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${makeToken('org_test01h455vb4pex5vs')}`)
        .send({ ids: [archivedId] });

      expect(res.status).toBe(200);
      expect(res.body.results[archivedId].status).toBe('archived');
      expect(res.body.missing).toEqual([]);
    });
  });

  // ── Security scoping ───────────────────────────────────────────────────────────────────────────────────
  describe('security scoping (org boundary)', () => {
    beforeEach(() => {
      mockFlagEnabled.mockResolvedValue(true);
    });

    it('queries DB with the caller\'s orgId as the org boundary', async () => {
      const callersOrg = 'org_callerorgid01h455vb4pex5vs';
      mockDbRows([]);

      await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${makeToken(callersOrg)}`)
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'] });

      // The raw SQL call's binding array must contain the caller's orgId.
      expect(mockDbRaw).toHaveBeenCalledTimes(1);
      const [_sql, bindings] = mockDbRaw.mock.calls[0];
      expect(bindings).toContain(callersOrg);
    });

    it('SQL query contains organization_id filter', async () => {
      mockDbRows([]);

      await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${makeToken('org_test01h455vb4pex5vs')}`)
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'] });

      const [sql] = mockDbRaw.mock.calls[0];
      // Verify the WHERE clause scopes to organization_id.
      expect(sql.toLowerCase()).toContain('organization_id');
    });

    it('items from other orgs are silently placed in missing (DB returns no rows)', async () => {
      // DB returns empty — item belongs to a different org, org-scoped query finds nothing.
      mockDbRows([]);

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${makeToken('org_other_org_id')}`)
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'] });

      expect(res.status).toBe(200);
      expect(res.body.results).toEqual({});
      expect(res.body.missing).toContain('front_sli_01h455vb4pex5vsknk084sn02q');
      // No 403, no existence leak.
      expect(res.status).not.toBe(403);
    });

    it('ids with a wrong TypeID prefix go to missing without hitting DB', async () => {
      // 'front_sl_…' is a list id, not an item id — invalid for this endpoint.
      const wrongTypeId = 'front_sl_01h455vb4pex5vsknk084sn02q';
      const validId = 'front_sli_01h455vb4pex5vsknk084sn02q';
      mockDbRows([makeRow(validId)]);

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${makeToken('org_test01h455vb4pex5vs')}`)
        .send({ ids: [wrongTypeId, validId] });

      expect(res.status).toBe(200);
      expect(res.body.missing).toContain(wrongTypeId);
      expect(res.body.results[validId]).toBeDefined();
    });
  });

  // ── Locale resolution ────────────────────────────────────────────────────────────────────────────────────
  describe('locale resolution', () => {
    const ORG = 'org_test01h455vb4pex5vs';
    const AUTH = () => makeToken(ORG);

    beforeEach(() => {
      mockFlagEnabled.mockResolvedValue(true);
      mockDbRows([]);
    });

    it('uses body.locale when provided', async () => {
      await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'], locale: 'fr' });

      const [, bindings] = mockDbRaw.mock.calls[0];
      // First two bindings are effectiveLocale (CASE WHEN branch + LEFT JOIN locale).
      expect(bindings[0]).toBe('fr');
      expect(bindings[1]).toBe('fr');
    });

    it('falls back to Accept-Language header when body.locale is absent', async () => {
      await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .set('Accept-Language', 'de-DE, de;q=0.9, en;q=0.8')
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'] });

      const [, bindings] = mockDbRaw.mock.calls[0];
      expect(bindings[0]).toBe('de');
      expect(bindings[1]).toBe('de');
    });

    it('parses the first supported tag in Accept-Language, ignoring region subtag', async () => {
      await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .set('Accept-Language', 'zh-TW;q=0.9, ja;q=0.8')
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'] });

      const [, bindings] = mockDbRaw.mock.calls[0];
      expect(bindings[0]).toBe('zh');
    });

    it('uses null effectiveLocale (source_locale SQL fallback) when neither body.locale nor Accept-Language', async () => {
      await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'] });

      const [, bindings] = mockDbRaw.mock.calls[0];
      expect(bindings[0]).toBeNull();
      expect(bindings[1]).toBeNull();
    });

    it('body.locale takes priority over Accept-Language header', async () => {
      await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .set('Accept-Language', 'de')
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'], locale: 'fr' });

      const [, bindings] = mockDbRaw.mock.calls[0];
      expect(bindings[0]).toBe('fr');
    });

    it('ignores unsupported locale values from body (falls through to Accept-Language)', async () => {
      await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .set('Accept-Language', 'es')
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'], locale: 'klingon' });

      const [, bindings] = mockDbRaw.mock.calls[0];
      // 'klingon' is not in SUPPORTED_LOCALES; falls back to Accept-Language 'es'
      expect(bindings[0]).toBe('es');
    });
  });

  // ── Response shape conformance ────────────────────────────────────────────────────────────────────────────────
  describe('response schema conformance (OpenAPI: ResolveResponse)', () => {
    const ORG = 'org_test01h455vb4pex5vs';
    const AUTH = () => makeToken(ORG);

    beforeEach(() => {
      mockFlagEnabled.mockResolvedValue(true);
    });

    it('response always has { results, missing } envelope', async () => {
      mockDbRows([]);

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'] });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('results');
      expect(res.body).toHaveProperty('missing');
      expect(typeof res.body.results).toBe('object');
      expect(Array.isArray(res.body.missing)).toBe(true);
    });

    it('resolved item has exactly { label, locale, is_machine, status } — no extra fields', async () => {
      const itemId = 'front_sli_01h455vb4pex5vsknk084sn02q';
      mockDbRows([
        makeRow(itemId, {
          label: 'España',
          resolved_locale: 'es',
          is_machine: true,
          status: 'active',
        }),
      ]);

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids: [itemId], locale: 'es' });

      const item = res.body.results[itemId];
      expect(item).toEqual({
        label: 'España',
        locale: 'es',
        is_machine: true,
        status: 'active',
      });

      // list_id must NOT appear (OpenAPI: additionalProperties: false)
      expect(item).not.toHaveProperty('list_id');
      expect(item).not.toHaveProperty('organization_id');
    });

    it('missing array contains unique ids (deduped)', async () => {
      // Two identical ids → query returns nothing → missing should not duplicate.
      mockDbRows([]);
      const id = 'front_sli_01h455vb4pex5vsknk084sn02q';

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids: [id, id] }); // duplicate

      expect(res.status).toBe(200);
      const missingCount = res.body.missing.filter((m: string) => m === id).length;
      expect(missingCount).toBe(1); // deduped
    });

    it('is_machine is a boolean (not a truthy integer from Postgres)', async () => {
      const itemId = 'front_sli_01h455vb4pex5vsknk084sn02q';
      // Postgres can return is_machine as the integer 1 in some drivers.
      mockDbRows([makeRow(itemId, { is_machine: 1 as unknown as boolean })]);

      const res = await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids: [itemId] });

      expect(typeof res.body.results[itemId].is_machine).toBe('boolean');
      expect(res.body.results[itemId].is_machine).toBe(true);
    });
  });

  // ── DB query correctness ───────────────────────────────────────────────────────────────────────────────────────
  describe('DB query structure', () => {
    const ORG = 'org_test01h455vb4pex5vs';
    const AUTH = () => makeToken(ORG);

    beforeEach(() => {
      mockFlagEnabled.mockResolvedValue(true);
      mockDbRows([]);
    });

    it('passes the requested ids as the binding for the ANY(?) clause', async () => {
      const ids = [
        'front_sli_01h455vb4pex5vsknk084sn02q',
        'front_sli_02h455vb4pex5vsknk084sn02q',
      ];

      await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids });

      const [, bindings] = mockDbRaw.mock.calls[0];
      // The ids array must appear as one of the bindings.
      const idsBinding = bindings.find(
        (b: unknown) => Array.isArray(b) && (b as string[]).includes(ids[0])
      );
      expect(idsBinding).toBeDefined();
    });

    it('SQL query joins selection_list_items to selection_lists', async () => {
      await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'] });

      const [sql] = mockDbRaw.mock.calls[0];
      expect(sql.toLowerCase()).toContain('selection_list_items');
      expect(sql.toLowerCase()).toContain('selection_lists');
    });

    it('SQL query includes LEFT JOINs to selection_list_item_translations', async () => {
      await request(app)
        .post('/v1/resolve')
        .set('Authorization', `Bearer ${AUTH()}`)
        .send({ ids: ['front_sli_01h455vb4pex5vsknk084sn02q'] });

      const [sql] = mockDbRaw.mock.calls[0];
      expect(sql.toLowerCase()).toContain('selection_list_item_translations');
      // Three LEFT JOINs for locale fallback.
      const leftJoinCount = (sql.toLowerCase().match(/left join/g) || []).length;
      expect(leftJoinCount).toBeGreaterThanOrEqual(3);
    });
  });
});
