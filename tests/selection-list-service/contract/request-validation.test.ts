/**
 * Request validation against the frozen schemas (openapi.yaml 4.0.0): every request-body schema is
 * `additionalProperties: false`, and `POST /v1/resolve` constrains `ids` to
 * `^front_sli_[0-9a-z]+$`, `minItems: 1`, `uniqueItems: true` and `locale` to the supported enum.
 *
 * Why this matters beyond tidiness (governance/identifier-standard.md): a body that quietly accepts
 * an undeclared `id` is the "client-chosen identity" door the standard closes, and a route that
 * treats a list/user/org id as a (missing) item id is the cross-type confusion it exists to stop.
 *
 * These were two DEFECTS, pinned as `it.failing` until the service was fixed (SL8); the pins are
 * now plain tests that must stay green. Do NOT weaken the assertions.
 *
 *   D1  PUT .../translations/{locale}, PUT .../items/{itemId}/translations/{locale},
 *       PUT .../items/reorder, POST .../translations/{locale}/autofill and POST /v1/resolve used to
 *       accept undeclared properties (incl. `id`, `organization_id`) and answer 2xx; the spec says 400.
 *   D2  POST /v1/resolve used to accept ids that do not match `^front_sli_[0-9a-z]+$` — a `front_sl_`,
 *       `usr_` or `org_` id, upper-case, even a JSON number — and answer 200 with them listed in
 *       `missing`; the spec says 400 VALIDATION_ERROR. It also accepted duplicate ids (`uniqueItems`),
 *       an unsupported `locale`, and an empty `ids` (`minItems: 1`) with 200.
 *   D3  `limit=0` on the paginated GETs (spec `minimum: 1`) was silently treated as the default.
 */
import { mintTestToken } from '../helpers/auth';
import { rawFetch } from '../helpers/client';
import { assertSchema, requestBodyErrors } from '../helpers/openapi';
import { closeDb } from '../helpers/db';

const ORG = 'org_01test0000000reqval000000000';
const USER = 'usr_01test0000000reqvaluser00000';
const tok = () => mintTestToken({ userId: USER, organizationId: ORG });
const call = (method: string, path: string, body?: unknown) =>
  rawFetch(path, { method, token: tok(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const rnd = () => Math.random().toString(16).slice(2, 8);

let listId: string;
let itemId: string;
const L = () => `/v1/selection-lists/${listId}`;

beforeAll(async () => {
  const l = await call('POST', '/v1/selection-lists', { key: `rv-${rnd()}-${rnd()}`, name: 'Validation' });
  expect(l.status).toBe(201);
  listId = (l.body as { id: string }).id;
  const i = await call('POST', `${L()}/items`, { code: 'V1', label: 'One' });
  expect(i.status).toBe(201);
  itemId = (i.body as { id: string }).id;
});

afterAll(async () => {
  await closeDb();
});

const expect400 = (res: { status: number; body: unknown }) => {
  expect(res.status).toBe(400);
  assertSchema('Error', res.body);
  expect((res.body as { code: string }).code).toBe('VALIDATION_ERROR');
};

describe('the spec itself declares these constraints (guards against the tests below asserting something the contract does not say)', () => {
  it('the undeclared-property bodies and the resolve ids violate the request schemas', () => {
    expect(requestBodyErrors('PUT', '/v1/selection-lists/{listId}/translations/{locale}', { name: 'x', id: 'front_sl_x' })).not.toEqual([]);
    expect(requestBodyErrors('PUT', '/v1/selection-lists/{listId}/items/reorder', { item_ids: ['front_sli_x'], id: 'y' })).not.toEqual([]);
    expect(requestBodyErrors('POST', '/v1/resolve', { ids: ['front_sl_01h455vb4pex5vsknk084sn02q'] })).not.toEqual([]);
    expect(requestBodyErrors('POST', '/v1/resolve', { ids: ['front_sli_a', 'front_sli_a'] })).not.toEqual([]);
    expect(requestBodyErrors('POST', '/v1/resolve', { ids: [] })).not.toEqual([]);
    expect(requestBodyErrors('POST', '/v1/resolve', { ids: ['front_sli_a'], locale: 'xx' })).not.toEqual([]);
    expect(requestBodyErrors('POST', '/v1/resolve', { ids: ['front_sli_a'], locale: 'fr' })).toEqual([]);
  });
});

describe('D1: undeclared properties must be rejected with 400 VALIDATION_ERROR (additionalProperties: false)', () => {
  it('PUT list translation with an extra `id`', async () => {
    expect400(await call('PUT', `${L()}/translations/fr`, { name: 'x', id: 'front_sl_01h455vb4pex5vsknk084sn02q' }));
  });
  it('PUT list translation with an arbitrary extra property', async () => {
    expect400(await call('PUT', `${L()}/translations/de`, { name: 'x', bogus: 1 }));
  });
  it('PUT item translation with an extra `id`', async () => {
    expect400(await call('PUT', `${L()}/items/${itemId}/translations/fr`, { label: 'x', id: 'front_sli_01h455vb4pex5vsknk084sn02q' }));
  });
  it('PUT reorder with an extra `id`', async () => {
    expect400(await call('PUT', `${L()}/items/reorder`, { item_ids: [itemId], id: 'front_sli_01h455vb4pex5vsknk084sn02q' }));
  });
  it('POST autofill with an undeclared property', async () => {
    expect400(await call('POST', `${L()}/translations/es/autofill`, { bogus: 1 }));
  });
  it('POST resolve with an undeclared property (e.g. a client-supplied organization_id)', async () => {
    expect400(await call('POST', '/v1/resolve', { ids: [itemId], organization_id: 'org_01h455vb4pex5vsknk084sn02q' }));
  });
});

describe('D2: POST /v1/resolve enforces the ids schema', () => {
  it.each([
    ['a list id', 'front_sl_01h455vb4pex5vsknk084sn02q'],
    ['a user id', 'usr_01h455vb4pex5vsknk084sn02q'],
    ['an org id', 'org_01h455vb4pex5vsknk084sn02q'],
    ['an upper-case suffix', 'front_sli_ABC'],
    ['a bare UUID', '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7d00'],
    ['a JSON number', 123],
  ])('rejects %s in ids (cross-type / malformed id)', async (_name, bad) => {
    expect400(await call('POST', '/v1/resolve', { ids: [bad] }));
  });
  it('rejects duplicate ids (uniqueItems)', async () => {
    expect400(await call('POST', '/v1/resolve', { ids: [itemId, itemId] }));
  });
  it('rejects an unsupported locale', async () => {
    expect400(await call('POST', '/v1/resolve', { ids: [itemId], locale: 'xx' }));
  });
  it('rejects an empty ids array (minItems: 1)', async () => {
    expect400(await call('POST', '/v1/resolve', { ids: [] }));
  });
});

describe('D3: limit must be an integer >= 1 on every paginated GET (over-max is clamped, never honoured unbounded)', () => {
  const paths = (): Array<[string, string]> => [
    ['GET /v1/selection-lists', '/v1/selection-lists'],
    ['GET .../items', `${L()}/items`],
    ['GET .../access', `${L()}/access`],
  ];
  it.each([['0'], ['-1'], ['abc'], ['1.5'], ['']])('rejects limit=%p with 400 VALIDATION_ERROR on all three collections', async (bad) => {
    for (const [name, path] of paths()) {
      const res = await call('GET', `${path}?limit=${encodeURIComponent(bad)}`);
      expect({ name, status: res.status }).toEqual({ name, status: 400 });
      expect400(res);
    }
  });
  it('clamps limit=100000 to the max (200) instead of rejecting or honouring it', async () => {
    for (const [name, path] of paths()) {
      const res = await call('GET', `${path}?limit=100000`);
      expect({ name, status: res.status }).toEqual({ name, status: 200 });
    }
  });
});

describe('what the service already enforces (regression pins)', () => {
  it('rejects more than 500 ids and a non-array ids with 400', async () => {
    const many = Array.from({ length: 501 }, (_v, i) => `front_sli_${String(i).padStart(26, '0')}`);
    expect400(await call('POST', '/v1/resolve', { ids: many }));
    expect400(await call('POST', '/v1/resolve', { ids: 'front_sli_a' }));
    expect400(await call('POST', '/v1/resolve', {}));
  });
  it('a valid request still resolves', async () => {
    const res = await call('POST', '/v1/resolve', { ids: [itemId], locale: 'en' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ results: { [itemId]: { label: 'One', status: 'active' } }, missing: [] });
  });
});
