/**
 * Published events — outbox-observable behaviour (docs/planning/selection-lists-events.md
 * §4 topics, §5 conventions, §6 delivery, §13.0.1; plan §14 test plan P1-P6 + the per-org
 * ordering guarantee).
 *
 * Black box: every action is an HTTP request to the running service; every assertion is a
 * query against the service's own database (`event_outbox`). Payloads are validated with the
 * FROZEN shared Zod schemas (`schemaForTopic`), never with implementation types.
 *
 * Own org => the org's outbox rows are exactly this file's events (jest runs files in
 * parallel workers; other files use other orgs).
 */
import { mintTestToken } from '../helpers/auth';
import { rawFetch } from '../helpers/client';
import { closeDb } from '../helpers/db';
import { allEvents, eventsFrom, OutboxRow, payloadErrors, TOPICS, topicsOf } from '../helpers/outbox';

const ORG = 'org_01test0000000outbox00000000';
const USER_A = 'usr_01test0000000outboxusera000';
const USER_B = 'usr_01test0000000outboxuserb000';

const tokenA = () => mintTestToken({ userId: USER_A, organizationId: ORG });
const tokenB = () => mintTestToken({ userId: USER_B, organizationId: ORG });

const rnd = () => Math.random().toString(16).slice(2, 8);

const call = (method: string, path: string, body?: unknown, token = tokenA()) =>
  rawFetch(path, { method, token, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

type Created = { id: string };
const L = (id: string) => `/v1/selection-lists/${encodeURIComponent(id)}`;

async function newList(over: Record<string, unknown> = {}): Promise<{ id: string; key: string }> {
  const key = `ob-${rnd()}-${rnd()}`;
  const res = await call('POST', '/v1/selection-lists', { key, name: 'Outbox list', source_locale: 'en', ...over });
  expect(res.status).toBe(201);
  return { id: (res.body as Created).id, key: (over['key'] as string) ?? key };
}

async function newItem(listId: string, code = `C${rnd()}`): Promise<string> {
  const res = await call('POST', `${L(listId)}/items`, { code, label: `Label ${code}` });
  expect(res.status).toBe(201);
  return (res.body as Created).id;
}

/** Every row validates against its frozen schema and carries the right org + actor + a fresh eventId. */
function expectValid(rows: OutboxRow[], actorUser: string | null = USER_A): void {
  for (const r of rows) {
    expect(payloadErrors(r.topic, r.payload)).toEqual([]);
    expect(r.organization_id).toBe(ORG);
    expect(r.payload['organizationId']).toBe(ORG);
    expect(r.payload['eventId']).toBe(r.id);
    if (actorUser && r.payload['actor']) {
      expect(r.payload['actor']).toEqual({ type: 'user', userId: actorUser });
    }
  }
}

afterAll(async () => {
  await closeDb();
});

const revisions = (rows: OutboxRow[]) => rows.filter((r) => r.payload['listRevision'] !== undefined).map((r) => r.payload['listRevision'] as number);

describe('every enqueued payload validates against the frozen schema, with the wire envelope facts (P2, §5)', () => {
  it('a full list lifecycle produces only schema-valid events, each with a unique UUID eventId', async () => {
    const { id } = await newList();
    const item = await newItem(id);
    await call('PATCH', L(id), { name: 'Renamed' });
    await call('PUT', `${L(id)}/translations/fr`, { name: 'Liste' });
    await call('PUT', `${L(id)}/items/${item}/translations/fr`, { label: 'Libelle' });
    await call('PUT', `${L(id)}/access/${USER_B}`, { role: 'list-viewer' });
    await call('DELETE', `${L(id)}/items/${item}`);
    await call('POST', `${L(id)}/archive`);
    await call('DELETE', `${L(id)}?purge=true`);
    const rows = (await allEvents(ORG)).filter((r) => r.payload['listId'] === id);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expectValid(rows);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    // every produced topic is one of the 13 published change topics, never seed.requested
    for (const r of rows) {
      expect(r.topic).toMatch(/^selection-lists\./);
      expect(r.topic).not.toBe(TOPICS.SELECTION_LISTS_SEED_REQUESTED);
    }
  });
});

describe('list mutations -> exactly the events of §4', () => {
  it('POST /lists emits list.created (revision 1) then access.granted(list-owner) — and nothing else', async () => {
    const key = `ob-c-${rnd()}`;
    const { events, result } = await eventsFrom(ORG, () => call('POST', '/v1/selection-lists', { key, name: 'Created', source_locale: 'en' }));
    expect(result.status).toBe(201);
    expect(topicsOf(events)).toEqual([TOPICS.SELECTION_LISTS_LIST_CREATED, TOPICS.SELECTION_LISTS_ACCESS_GRANTED]);
    expectValid(events);
    const listId = (result.body as Created).id;
    const [created, granted] = events;
    expect(created.payload['listId']).toBe(listId);
    expect(created.payload['listKey']).toBe(key);
    expect(created.payload['listRevision']).toBe(1);
    expect(created.payload['list']).toMatchObject({ listId, key, sourceLocale: 'en', status: 'active', name: 'Created', seed: null });
    expect(granted.payload).toMatchObject({ listId, userId: USER_A, role: 'list-owner', previousRole: null });
  });

  it('PATCH name emits one list.updated with changedFields [name] and a greater revision', async () => {
    const { id } = await newList();
    const { events, result } = await eventsFrom(ORG, () => call('PATCH', L(id), { name: 'New name' }));
    expect(result.status).toBe(200);
    expect(topicsOf(events)).toEqual([TOPICS.SELECTION_LISTS_LIST_UPDATED]);
    expectValid(events);
    expect(events[0].payload['changedFields']).toEqual(['name']);
    expect(events[0].payload['previousKey']).toBeNull();
    expect(events[0].payload['listRevision']).toBeGreaterThan(1);
    expect(events[0].payload['list']).toMatchObject({ name: 'New name' });
  });

  it('P4: a key rename emits list.updated with previousKey and "key" in changedFields', async () => {
    const { id, key } = await newList();
    const newKey = `ob-r-${rnd()}-${rnd()}`;
    const { events, result } = await eventsFrom(ORG, () => call('PATCH', L(id), { key: newKey }));
    expect(result.status).toBe(200);
    expect(topicsOf(events)).toEqual([TOPICS.SELECTION_LISTS_LIST_UPDATED]);
    expectValid(events);
    expect(events[0].payload['changedFields']).toContain('key');
    expect(events[0].payload['previousKey']).toBe(key);
    expect(events[0].payload['listKey']).toBe(newKey);
  });

  it('P4: archive emits list.archived (never list.updated{status}); restore emits list.updated with status in changedFields', async () => {
    const { id } = await newList();
    const a = await eventsFrom(ORG, () => call('PATCH', L(id), { status: 'archived' }));
    expect(a.result.status).toBe(200);
    expect(topicsOf(a.events)).toEqual([TOPICS.SELECTION_LISTS_LIST_ARCHIVED]);
    expectValid(a.events);
    expect(a.events[0].payload['list']).toMatchObject({ status: 'archived' });

    const r = await eventsFrom(ORG, () => call('PATCH', L(id), { status: 'active' }));
    expect(r.result.status).toBe(200);
    expect(topicsOf(r.events)).toEqual([TOPICS.SELECTION_LISTS_LIST_UPDATED]);
    expectValid(r.events);
    expect(r.events[0].payload['changedFields']).toContain('status');
    expect(r.events[0].payload['list']).toMatchObject({ status: 'active' });
  });

  it('§13.0.1: PATCH {name, status:"archived"} emits list.updated (name, no status) THEN list.archived, each with its own greater revision', async () => {
    const { id } = await newList();
    const { events, result } = await eventsFrom(ORG, () => call('PATCH', L(id), { name: 'Renamed and archived', status: 'archived' }));
    expect(result.status).toBe(200);
    expect(topicsOf(events)).toEqual([TOPICS.SELECTION_LISTS_LIST_UPDATED, TOPICS.SELECTION_LISTS_LIST_ARCHIVED]);
    expectValid(events);
    expect(events[0].payload['changedFields']).toEqual(['name']);
    expect(events[1].payload['list']).toMatchObject({ status: 'archived', name: 'Renamed and archived' });
    expect(events[1].payload['listRevision']).toBeGreaterThan(events[0].payload['listRevision']);

    const restore = await eventsFrom(ORG, () => call('PATCH', L(id), { name: 'Back', status: 'active' }));
    expect(topicsOf(restore.events)).toEqual([TOPICS.SELECTION_LISTS_LIST_UPDATED]);
    expect([...(restore.events[0].payload['changedFields'] as string[])].sort()).toEqual(['name', 'status']);
  });

  it('§13.0.1: the same split holds for items — item.updated (label) THEN item.archived', async () => {
    const { id } = await newList();
    const item = await newItem(id);
    const { events, result } = await eventsFrom(ORG, () => call('PATCH', `${L(id)}/items/${item}`, { label: 'Relabelled', status: 'archived' }));
    expect(result.status).toBe(200);
    expect(topicsOf(events)).toEqual([TOPICS.SELECTION_LISTS_ITEM_UPDATED, TOPICS.SELECTION_LISTS_ITEM_ARCHIVED]);
    expectValid(events);
    expect(events[0].payload['changedFields']).toEqual(['label']);
    expect(events[1].payload['listRevision']).toBeGreaterThan(events[0].payload['listRevision']);
  });

  it('POST /archive and DELETE (archive form) each emit one list.archived', async () => {
    const a = await newList();
    const viaPost = await eventsFrom(ORG, () => call('POST', `${L(a.id)}/archive`));
    expect(viaPost.result.status).toBe(200);
    expect(topicsOf(viaPost.events)).toEqual([TOPICS.SELECTION_LISTS_LIST_ARCHIVED]);
    expectValid(viaPost.events);

    const b = await newList();
    const viaDelete = await eventsFrom(ORG, () => call('DELETE', L(b.id)));
    expect([200, 204]).toContain(viaDelete.result.status);
    expect(topicsOf(viaDelete.events)).toEqual([TOPICS.SELECTION_LISTS_LIST_ARCHIVED]);
    expectValid(viaDelete.events);
  });

  it('P5: purge emits only list.deleted — no cascade events for the items/translations/grants inside', async () => {
    const { id } = await newList();
    const item = await newItem(id);
    await call('PUT', `${L(id)}/translations/fr`, { name: 'Liste' });
    await call('PUT', `${L(id)}/items/${item}/translations/fr`, { label: 'Libelle' });
    await call('PUT', `${L(id)}/access/${USER_B}`, { role: 'list-viewer' });
    const { events, result } = await eventsFrom(ORG, () => call('DELETE', `${L(id)}?purge=true`));
    expect([200, 204]).toContain(result.status);
    expect(topicsOf(events)).toEqual([TOPICS.SELECTION_LISTS_LIST_DELETED]);
    expectValid(events);
    expect(events[0].payload['listId']).toBe(id);
  });
});

describe('item mutations', () => {
  it('create / update / archive / purge / reorder each emit their own single topic', async () => {
    const { id } = await newList();

    const created = await eventsFrom(ORG, () => call('POST', `${L(id)}/items`, { code: 'ALPHA', label: 'Alpha' }));
    expect(created.result.status).toBe(201);
    const itemId = (created.result.body as Created).id;
    expect(topicsOf(created.events)).toEqual([TOPICS.SELECTION_LISTS_ITEM_CREATED]);
    expectValid(created.events);
    expect(created.events[0].payload['item']).toMatchObject({ itemId, code: 'ALPHA', label: 'Alpha', status: 'active', seed: null });

    const second = await newItem(id, 'BETA');

    const upd = await eventsFrom(ORG, () => call('PATCH', `${L(id)}/items/${itemId}`, { label: 'Alpha 2' }));
    expect(upd.result.status).toBe(200);
    expect(topicsOf(upd.events)).toEqual([TOPICS.SELECTION_LISTS_ITEM_UPDATED]);
    expectValid(upd.events);
    expect(upd.events[0].payload['changedFields']).toEqual(['label']);

    const re = await eventsFrom(ORG, () => call('PUT', `${L(id)}/items/reorder`, { item_ids: [second, itemId] }));
    expect(re.result.status).toBe(200);
    expect(topicsOf(re.events)).toEqual([TOPICS.SELECTION_LISTS_ITEM_REORDERED]);
    expectValid(re.events);
    const order = re.events[0].payload['order'] as Array<{ itemId: string; sortOrder: number }>;
    expect(order.map((o) => o.itemId)).toEqual([second, itemId]);
    expect(order[0].sortOrder).toBeLessThan(order[1].sortOrder);

    const arch = await eventsFrom(ORG, () => call('DELETE', `${L(id)}/items/${itemId}`));
    expect([200, 204]).toContain(arch.result.status);
    expect(topicsOf(arch.events)).toEqual([TOPICS.SELECTION_LISTS_ITEM_ARCHIVED]);
    expectValid(arch.events);
    expect(arch.events[0].payload['item']).toMatchObject({ status: 'archived' });

    const purge = await eventsFrom(ORG, () => call('DELETE', `${L(id)}/items/${second}?purge=true`));
    expect([200, 204]).toContain(purge.result.status);
    expect(topicsOf(purge.events)).toEqual([TOPICS.SELECTION_LISTS_ITEM_DELETED]);
    expectValid(purge.events);
  });

  it('P5: purging an item emits only item.deleted (no translation events for its translations)', async () => {
    const { id } = await newList();
    const item = await newItem(id);
    await call('PUT', `${L(id)}/items/${item}/translations/fr`, { label: 'Libelle' });
    const { events } = await eventsFrom(ORG, () => call('DELETE', `${L(id)}/items/${item}?purge=true`));
    expect(topicsOf(events)).toEqual([TOPICS.SELECTION_LISTS_ITEM_DELETED]);
  });

  it('item restore (archived -> active) emits item.updated with status in changedFields', async () => {
    const { id } = await newList();
    const item = await newItem(id);
    await call('POST', `${L(id)}/items/${item}/archive`);
    const { events, result } = await eventsFrom(ORG, () => call('PATCH', `${L(id)}/items/${item}`, { status: 'active' }));
    expect(result.status).toBe(200);
    expect(topicsOf(events)).toEqual([TOPICS.SELECTION_LISTS_ITEM_UPDATED]);
    expect(events[0].payload['changedFields']).toContain('status');
    expectValid(events);
  });
});

describe('translation and access events', () => {
  it('a non-source-locale list translation emits translation.upserted (kind list); deleting it emits translation.deleted', async () => {
    const { id } = await newList();
    const up = await eventsFrom(ORG, () => call('PUT', `${L(id)}/translations/fr`, { name: 'Liste en français' }));
    expect(up.result.status).toBe(200);
    expect(topicsOf(up.events)).toEqual([TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED]);
    expectValid(up.events);
    expect(up.events[0].payload).toMatchObject({ locale: 'fr', isMachine: false, target: { kind: 'list', name: 'Liste en français' } });

    const del = await eventsFrom(ORG, () => call('DELETE', `${L(id)}/translations/fr`));
    expect(del.result.status).toBe(204);
    expect(topicsOf(del.events)).toEqual([TOPICS.SELECTION_LISTS_TRANSLATION_DELETED]);
    expectValid(del.events);
  });

  it('an item translation emits translation.upserted (kind item) naming the item', async () => {
    const { id } = await newList();
    const item = await newItem(id, 'TRX');
    const { events, result } = await eventsFrom(ORG, () => call('PUT', `${L(id)}/items/${item}/translations/de`, { label: 'Beschriftung' }));
    expect(result.status).toBe(200);
    expect(topicsOf(events)).toEqual([TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED]);
    expectValid(events);
    expect(events[0].payload['target']).toMatchObject({ kind: 'item', itemId: item, itemCode: 'TRX', label: 'Beschriftung' });
  });

  it('autofill emits one translation.upserted (isMachine: true) per translation it wrote (§4)', async () => {
    const { id } = await newList();
    await newItem(id, 'AF1');
    await newItem(id, 'AF2');
    const { events, result } = await eventsFrom(ORG, () => call('POST', `${L(id)}/translations/es/autofill`, {}));
    expect(result.status).toBe(200);
    const body = result.body as { list_translated: boolean; items_translated: number };
    const expected = (body.list_translated ? 1 : 0) + body.items_translated;
    expect(expected).toBeGreaterThan(0);
    expect(topicsOf(events)).toEqual(Array(expected).fill(TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED));
    expectValid(events);
    for (const e of events) expect(e.payload).toMatchObject({ locale: 'es', isMachine: true });
    const kinds = events.map((e) => e.payload['target'].kind).sort();
    expect(kinds).toEqual([...(body.list_translated ? ['list'] : []), ...Array(body.items_translated).fill('item')].sort());
    // and a second autofill that finds nothing missing writes (and emits) nothing
    const again = await eventsFrom(ORG, () => call('POST', `${L(id)}/translations/es/autofill`, {}));
    expect(again.result.status).toBe(200);
    expect((again.result.body as { items_translated: number; list_translated: boolean }).items_translated).toBe(0);
    expect(again.events).toEqual([]);
  });

  it('P6: source-locale text never produces translation.* — the translation route refuses it (400), PATCH emits list.updated', async () => {
    const { id } = await newList({ source_locale: 'en' });
    const viaTranslation = await eventsFrom(ORG, () => call('PUT', `${L(id)}/translations/en`, { name: 'Source locale rename' }));
    expect(viaTranslation.result.status).toBe(400);
    expect(viaTranslation.events).toEqual([]);

    const viaPatch = await eventsFrom(ORG, () => call('PATCH', L(id), { name: 'Source locale rename' }));
    expect(viaPatch.result.status).toBe(200);
    expect(topicsOf(viaPatch.events)).toEqual([TOPICS.SELECTION_LISTS_LIST_UPDATED]);
    expect(viaPatch.events[0].payload['changedFields']).toEqual(['name']);
  });

  it('access: grant (previousRole null) -> role change (previousRole set) -> revoke', async () => {
    const { id } = await newList();
    const g = await eventsFrom(ORG, () => call('PUT', `${L(id)}/access/${USER_B}`, { role: 'list-viewer' }));
    expect(g.result.status).toBe(200);
    expect(topicsOf(g.events)).toEqual([TOPICS.SELECTION_LISTS_ACCESS_GRANTED]);
    expectValid(g.events);
    expect(g.events[0].payload).toMatchObject({ userId: USER_B, role: 'list-viewer', previousRole: null });
    expect(g.events[0].payload).not.toHaveProperty('listRevision'); // access events carry no revision (§5)

    const c = await eventsFrom(ORG, () => call('PUT', `${L(id)}/access/${USER_B}`, { role: 'list-editor' }));
    expect(topicsOf(c.events)).toEqual([TOPICS.SELECTION_LISTS_ACCESS_GRANTED]);
    expect(c.events[0].payload).toMatchObject({ role: 'list-editor', previousRole: 'list-viewer' });

    const r = await eventsFrom(ORG, () => call('DELETE', `${L(id)}/access/${USER_B}`));
    expect(r.result.status).toBe(204);
    expect(topicsOf(r.events)).toEqual([TOPICS.SELECTION_LISTS_ACCESS_REVOKED]);
    expectValid(r.events);
    expect(r.events[0].payload).toMatchObject({ userId: USER_B });
  });
});

describe('P1: no event for a rejected request, and none for a request that changes nothing', () => {
  it('rejected requests (400/403/404/409) leave the outbox untouched', async () => {
    const { id, key } = await newList();
    await call('PUT', `${L(id)}/access/${USER_B}`, { role: 'list-viewer' });
    const item = await newItem(id, 'REJ');
    const { events } = await eventsFrom(ORG, async () => {
      const results: number[] = [];
      // 400: invalid bodies
      results.push((await call('POST', '/v1/selection-lists', { key: 'x', name: 'too-short-key' })).status);
      results.push((await call('POST', '/v1/selection-lists', { key: `ob-${rnd()}-${rnd()}`, name: '' })).status);
      results.push((await call('PATCH', L(id), {})).status);
      results.push((await call('POST', `${L(id)}/items`, { code: 'has space', label: 'x' })).status);
      results.push((await call('PUT', `${L(id)}/translations/xx`, { name: 'unsupported locale' })).status);
      // 409: duplicate key / duplicate code
      results.push((await call('POST', '/v1/selection-lists', { key, name: 'dup' })).status);
      results.push((await call('POST', `${L(id)}/items`, { code: 'REJ', label: 'dup' })).status);
      // 403: a list-viewer may not write
      results.push((await call('PATCH', L(id), { name: 'nope' }, tokenB())).status);
      results.push((await call('POST', `${L(id)}/items`, { code: 'NOPE', label: 'nope' }, tokenB())).status);
      results.push((await call('PUT', `${L(id)}/access/${USER_B}`, { role: 'list-owner' }, tokenB())).status);
      // 404: missing list / missing item
      results.push((await call('PATCH', L('front_sl_00000000000000000000000000'), { name: 'ghost' })).status);
      results.push((await call('PATCH', `${L(id)}/items/front_sli_00000000000000000000000000`, { label: 'ghost' })).status);
      return results;
    });
    expect(events).toEqual([]);
    void item;
  });

  it('the last-owner guard (409) emits nothing', async () => {
    const { id } = await newList();
    const { events, result } = await eventsFrom(ORG, () => call('DELETE', `${L(id)}/access/${USER_A}`));
    expect(result.status).toBe(409);
    expect(events).toEqual([]);
  });

  it('no-op mutations are 2xx with no event: identical PATCH, repeat archive, identical access PUT, missing-grant DELETE', async () => {
    const { id } = await newList({ name: 'Stable' });
    const item = await newItem(id, 'NOOP');
    await call('PUT', `${L(id)}/access/${USER_B}`, { role: 'list-viewer' });

    const { events, result } = await eventsFrom(ORG, async () => {
      const out: Record<string, number> = {};
      out['patchSame'] = (await call('PATCH', L(id), { name: 'Stable' })).status;
      out['itemPatchSame'] = (await call('PATCH', `${L(id)}/items/${item}`, { label: 'Label NOOP' })).status;
      out['accessSame'] = (await call('PUT', `${L(id)}/access/${USER_B}`, { role: 'list-viewer' })).status;
      out['revokeMissing'] = (await call('DELETE', `${L(id)}/access/usr_01test0000000outboxnogrant00`)).status;
      out['translationMissing'] = (await call('DELETE', `${L(id)}/translations/ja`)).status;
      return out;
    });
    expect(events).toEqual([]);
    expect(result['patchSame']).toBe(200);
    expect(result['itemPatchSame']).toBe(200);
    expect(result['accessSame']).toBe(200);
    // not-there deletes are either idempotent 204 or 404 — never an event
    expect([204, 404]).toContain(result['revokeMissing']);
    expect([204, 404]).toContain(result['translationMissing']);
  });

  it('archiving an already-archived list or item is a 2xx no-op with no event', async () => {
    const { id } = await newList();
    const item = await newItem(id, 'ARCH');
    await call('POST', `${L(id)}/items/${item}/archive`);
    await call('POST', `${L(id)}/archive`);
    const { events, result } = await eventsFrom(ORG, async () => ({
      list: (await call('POST', `${L(id)}/archive`)).status,
      item: (await call('POST', `${L(id)}/items/${item}/archive`)).status,
    }));
    expect(events).toEqual([]);
    expect(result.list).toBeLessThan(300);
    expect(result.item).toBeLessThan(300);
  });
});

describe('P3: listRevision is strictly increasing per list across list/item/translation events', () => {
  it('a mixed sequence on one list yields strictly increasing revisions in seq order', async () => {
    const mark = (await allEvents(ORG)).length;
    void mark;
    const { id } = await newList();
    const i1 = await newItem(id, 'R1');
    const i2 = await newItem(id, 'R2');
    await call('PATCH', L(id), { name: 'Rev 2' });
    await call('PATCH', `${L(id)}/items/${i1}`, { label: 'R1 changed' });
    await call('PUT', `${L(id)}/translations/fr`, { name: 'Rév' });
    await call('PUT', `${L(id)}/items/${i2}/translations/fr`, { label: 'R2 fr' });
    await call('PUT', `${L(id)}/items/reorder`, { item_ids: [i2, i1] });
    await call('DELETE', `${L(id)}/items/${i1}`);
    await call('PATCH', L(id), { status: 'archived' });

    const rows = (await allEvents(ORG)).filter((r) => r.payload['listId'] === id);
    const revs = revisions(rows);
    expect(revs.length).toBeGreaterThanOrEqual(9);
    for (let i = 1; i < revs.length; i++) expect(revs[i]).toBeGreaterThan(revs[i - 1]);
    expect(revs[0]).toBe(1);
    // access events are the only ones without a revision
    for (const r of rows.filter((x) => x.payload['listRevision'] === undefined)) expect(r.topic).toBe(TOPICS.SELECTION_LISTS_ACCESS_GRANTED);
  });

  it('concurrent mutations of one list never share a revision, and seq order agrees with revision order', async () => {
    const { id } = await newList();
    const codes = Array.from({ length: 12 }, (_v, i) => `P${i}${rnd()}`);
    const results = await Promise.all(codes.map((code) => call('POST', `${L(id)}/items`, { code, label: code })));
    for (const r of results) expect(r.status).toBe(201);
    const rows = (await allEvents(ORG)).filter((r) => r.payload['listId'] === id && r.topic === TOPICS.SELECTION_LISTS_ITEM_CREATED);
    expect(rows).toHaveLength(12);
    const revs = rows.map((r) => r.payload['listRevision'] as number);
    expect(new Set(revs).size).toBe(12);
    // rows are ordered by seq; commit order == seq order means revisions ascend along seq
    for (let i = 1; i < revs.length; i++) expect(revs[i]).toBeGreaterThan(revs[i - 1]);
  });
});

describe('per-org ordering: seq reflects the order the org\'s requests committed (§6 step 4)', () => {
  it('sequential requests from two users in one org get strictly ascending seq in request order', async () => {
    const { id } = await newList();
    await call('PUT', `${L(id)}/access/${USER_B}`, { role: 'list-editor' });
    const marks: string[] = [];
    const codes = ['S1', 'S2', 'S3', 'S4'];
    for (let i = 0; i < codes.length; i++) {
      const who = i % 2 === 0 ? tokenA() : tokenB();
      const res = await call('POST', `${L(id)}/items`, { code: codes[i], label: codes[i] }, who);
      expect(res.status).toBe(201);
      marks.push((res.body as Created).id);
    }
    const rows = (await allEvents(ORG)).filter((r) => r.topic === TOPICS.SELECTION_LISTS_ITEM_CREATED && marks.includes(r.payload['item'].itemId));
    expect(rows.map((r) => r.payload['item'].itemId)).toEqual(marks);
    const seqs = rows.map((r) => BigInt(r.seq));
    for (let i = 1; i < seqs.length; i++) expect(seqs[i] > seqs[i - 1]).toBe(true);
    // the actor on each is the user who made the request
    expect(rows.map((r) => r.payload['actor'].userId)).toEqual([USER_A, USER_B, USER_A, USER_B]);
  });

  it('events of another org never appear under this org\'s key (organization_id is the ordering key)', async () => {
    const other = 'org_01test0000000outbox00000001';
    const tok = mintTestToken({ userId: USER_A, organizationId: other });
    const res = await rawFetch('/v1/selection-lists', { method: 'POST', token: tok, body: JSON.stringify({ key: `ob-o-${rnd()}-${rnd()}`, name: 'Other org' }) });
    expect(res.status).toBe(201);
    const mine = (await allEvents(ORG)).filter((r) => r.payload['listId'] === (res.body as Created).id);
    expect(mine).toEqual([]);
    const theirs = await allEvents(other);
    expect(theirs.length).toBeGreaterThanOrEqual(2);
    for (const r of theirs) {
      expect(r.organization_id).toBe(other);
      expect(r.payload['organizationId']).toBe(other);
    }
  });
});
