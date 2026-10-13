/**
 * Events of shared lists, common lists and forks — outbox-observable (SL9, D11).
 * Written against the FROZEN event contract (@fuzefront/shared 1.3.0: `selection-lists.list.forked`,
 * `selection-lists.visibility.changed`, the additive snapshot fields `visibility` / `forkedFrom` / `originItemId`;
 * validated through `schemaForTopic` = SCHEMA_BY_TOPIC) and docs/planning/selection-lists-shared-and-fork.md D11 +
 * docs/planning/selection-lists-events.md §5/§6 (one outbox row per event, written in the SAME transaction as the
 * change; one `listRevision` per event; a change that changes nothing emits nothing). Needs the shared-lists flag
 * ON (helpers/shared-lists.ts). Black box: HTTP in, `event_outbox` rows out, same database as the service.
 *
 * Design-record rows pinned (§11.10):
 *   fork          one transaction emits `list.created` (snapshot visibility "org"|"private" + forkedFrom),
 *                 `item.created` x every copied item (archived ones included; snapshot originItemId),
 *                 `translation.upserted` x every non-source translation, `access.granted` (list-owner) and
 *                 `selection-lists.list.forked` {source {listId, organizationId, listKey, listRevision}, itemMap[]};
 *                 all rows of the transaction share the transaction timestamp; listRevision strictly increases;
 *   visibility    `selection-lists.visibility.changed` {previousVisibility, visibility, list}; a combined PATCH also
 *                 emits `list.updated` for the OTHER fields (never `visibility` in changedFields), same transaction;
 *                 a same-visibility PATCH emits nothing;
 *   keying        a common list's events are keyed by the PLATFORM org (`organizationId`);
 *   nothing       refused / idempotent / no-op requests (200 repeat fork, 409, 403, 400, 404) emit nothing.
 */
import { actor, call, createList, createPlatformList, forkList, L, newOrg, PLATFORM_ORG_ID, assertSharedListsOn, walkItems } from '../helpers/shared-lists';
import { closeDb, dbQuery } from '../helpers/db';
import { eventsFrom, eventsSince, maxSeq, payloadErrors, topicsOf, TOPICS, transactionIds, type OutboxRow } from '../helpers/outbox';

const ORG_E = newOrg('evt');
const owner = actor('own', ORG_E, 'admin');
const editor = actor('ed', ORG_E, 'editor');
const viewer = actor('vw', ORG_E, 'viewer');

beforeAll(async () => {
  await assertSharedListsOn();
});
afterAll(async () => {
  await closeDb();
});

const forList = (rows: OutboxRow[], listId: string): OutboxRow[] => rows.filter((r) => r.payload['listId'] === listId);
const valid = (rows: OutboxRow[]): void => {
  for (const r of rows) expect({ topic: r.topic, errors: payloadErrors(r.topic, r.payload) }).toEqual({ topic: r.topic, errors: [] });
};

describe('creating lists: snapshots carry visibility; a common list\'s events are keyed by the platform org', () => {
  it('a platform operator publishing a common list emits list.created (visibility "platform") + access.granted under the PLATFORM org', async () => {
    const op = actor('op', PLATFORM_ORG_ID, 'admin');
    const mark = await maxSeq();
    const res = await call(op, 'POST', '/v1/selection-lists', { key: `evp-${Math.random().toString(36).slice(2, 8)}`, name: 'Common', visibility: 'platform' });
    expect(res.status).toBe(201);
    const rows = forList(await eventsSince(PLATFORM_ORG_ID, mark), res.body.id);
    expect(topicsOf(rows)).toEqual([TOPICS.SELECTION_LISTS_LIST_CREATED, TOPICS.SELECTION_LISTS_ACCESS_GRANTED]);
    valid(rows);
    for (const r of rows) expect(r.payload['organizationId']).toBe(PLATFORM_ORG_ID);
    expect(rows[0].payload['list']).toMatchObject({ visibility: 'platform', forkedFrom: null });
    expect(rows[1].payload).toMatchObject({ userId: op.userId, role: 'list-owner' });
  });

  it.each([['private', undefined], ['org', 'org']] as const)('a %s list: list.created snapshot says visibility "%s"', async (expected, requested) => {
    const { result, events } = await eventsFrom(ORG_E, () =>
      call(owner, 'POST', '/v1/selection-lists', { key: `evc-${Math.random().toString(36).slice(2, 8)}`, name: 'Plain', ...(requested ? { visibility: requested } : {}) }),
    );
    expect(result.status).toBe(201);
    const created = events.find((e) => e.topic === TOPICS.SELECTION_LISTS_LIST_CREATED)!;
    valid(events);
    expect(created.payload['list']).toMatchObject({ visibility: expected });
  });
});

describe('fork: one transaction, the documented topics, a complete itemMap', () => {
  let p: Awaited<ReturnType<typeof createPlatformList>>;
  let fork: any;
  let rows: OutboxRow[];
  let expectedTranslations: number;

  beforeAll(async () => {
    p = await createPlatformList({ itemCodes: ['A', 'B', 'C'] });
    expect((await call(p.owner, 'PUT', `${L(p.list.id)}/translations/fr`, { name: 'Commun' })).status).toBe(200);
    expect((await call(p.owner, 'PUT', `${L(p.list.id)}/items/${p.items[0].id}/translations/fr`, { label: 'Un' })).status).toBe(200);
    expect((await call(p.owner, 'DELETE', `${L(p.list.id)}/items/${p.items[1].id}`)).status).toBe(200); // B archived
    const mark = await maxSeq();
    const res = await forkList(owner, p.list.id);
    expect(res.status).toBe(201);
    fork = res.body;
    rows = await eventsSince(ORG_E, mark);
    const n = await dbQuery<{ n: string }>(
      `SELECT (SELECT count(*) FROM selection_list_translations t JOIN selection_lists l ON l.id = t.list_id WHERE t.list_id = $1 AND t.locale <> l.source_locale)
            + (SELECT count(*) FROM selection_list_item_translations t JOIN selection_list_items i ON i.id = t.item_id JOIN selection_lists l ON l.id = i.list_id
                WHERE i.list_id = $1 AND t.locale <> l.source_locale) AS n`,
      [fork.id],
    );
    expectedTranslations = Number(n[0].n);
  });

  it('emits exactly: list.created x1, item.created x3 (archived item included), translation.upserted x(non-source translations), access.granted x1, list.forked x1', () => {
    expect(expectedTranslations).toBeGreaterThanOrEqual(2); // non-vacuous: list fr + item fr were copied
    const count = (t: string) => rows.filter((r) => r.topic === t).length;
    expect(count(TOPICS.SELECTION_LISTS_LIST_CREATED)).toBe(1);
    expect(count(TOPICS.SELECTION_LISTS_ITEM_CREATED)).toBe(3);
    expect(count(TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED)).toBe(expectedTranslations);
    expect(count(TOPICS.SELECTION_LISTS_ACCESS_GRANTED)).toBe(1);
    expect(count(TOPICS.SELECTION_LISTS_LIST_FORKED)).toBe(1);
    expect(rows).toHaveLength(1 + 3 + expectedTranslations + 1 + 1); // and nothing else (no item.archived, no list.updated ...)
    valid(rows);
    for (const r of rows) {
      expect(r.organization_id).toBe(ORG_E); // keyed by the FORKING org
      expect(r.payload['organizationId']).toBe(ORG_E);
      expect(r.payload['actor']).toEqual({ type: 'user', userId: owner.userId });
    }
  });

  it('all rows were written in ONE transaction (same writer xid), with strictly increasing listRevision (one per event)', async () => {
    expect(await transactionIds(rows)).toHaveLength(1);
    // control: the xid really discriminates - the common list's own earlier events came from different requests
    const earlier = await dbQuery<{ id: string }>(`SELECT id FROM event_outbox WHERE organization_id = $1 AND payload->>'listId' = $2`, [PLATFORM_ORG_ID, p.list.id]);
    expect(earlier.length).toBeGreaterThan(3);
    expect((await transactionIds(earlier)).length).toBeGreaterThan(1);
    const revs = rows.filter((r) => r.payload['listRevision'] !== undefined).map((r) => r.payload['listRevision'] as number);
    expect(revs.length).toBe(rows.length - 1); // access.granted carries none
    for (let i = 1; i < revs.length; i++) expect(revs[i]).toBeGreaterThan(revs[i - 1]);
    const seqs = rows.map((r) => BigInt(r.seq));
    for (let i = 1; i < seqs.length; i++) expect(seqs[i] > seqs[i - 1]).toBe(true);
  });

  it('list.created carries the fork snapshot: visibility "org", forkedFrom = the source, same revision the HTTP forked_from reports', () => {
    const created = rows.find((r) => r.topic === TOPICS.SELECTION_LISTS_LIST_CREATED)!;
    expect(created.payload['listId']).toBe(fork.id);
    expect(created.payload['listKey']).toBe(p.list.key);
    expect(created.payload['list']).toMatchObject({
      listId: fork.id, key: p.list.key, visibility: 'org', status: 'active', seed: null,
      forkedFrom: { listId: p.list.id, organizationId: PLATFORM_ORG_ID, listRevision: fork.forked_from.revision },
    });
  });

  it('item.created snapshots carry originItemId = the source item, status preserved (the archived one is created archived)', () => {
    const byCode = new Map(p.items.map((i) => [i.code, i]));
    const created = rows.filter((r) => r.topic === TOPICS.SELECTION_LISTS_ITEM_CREATED).map((r) => r.payload['item']);
    expect(created).toHaveLength(3);
    for (const item of created) expect(item.originItemId).toBe(byCode.get(item.code)!.id);
    expect(created.find((i) => i.code === 'B').status).toBe('archived');
    expect(created.find((i) => i.code === 'A').status).toBe('active');
  });

  it('access.granted names the forking user as list-owner (previousRole null)', () => {
    const granted = rows.find((r) => r.topic === TOPICS.SELECTION_LISTS_ACCESS_GRANTED)!;
    expect(granted.payload).toMatchObject({ listId: fork.id, userId: owner.userId, role: 'list-owner', previousRole: null });
  });

  it('list.forked: source {listId, organizationId, listKey, listRevision} + an itemMap that is exactly the HTTP origin_item_id mapping', async () => {
    const forked = rows.find((r) => r.topic === TOPICS.SELECTION_LISTS_LIST_FORKED)!;
    expect(forked.payload).toMatchObject({
      organizationId: ORG_E,
      listId: fork.id,
      listKey: p.list.key,
      source: { listId: p.list.id, organizationId: PLATFORM_ORG_ID, listKey: p.list.key, listRevision: fork.forked_from.revision },
      list: { listId: fork.id, visibility: 'org', forkedFrom: { listId: p.list.id } },
    });
    const items = await walkItems(owner, fork.id, 'all');
    const expectedPairs = items.map((i) => `${i.origin_item_id}->${i.id}`).sort();
    expect(expectedPairs).toHaveLength(3);
    const actualPairs = (forked.payload['itemMap'] as Array<{ originItemId: string; itemId: string }>).map((m) => `${m.originItemId}->${m.itemId}`).sort();
    expect(actualPairs).toEqual(expectedPairs);
    // the common list's own history is untouched by being forked (no event on the source)
    const onSource = await dbQuery(
      `SELECT 1 FROM event_outbox WHERE organization_id = $1 AND topic = $2 AND payload->>'listId' = $3`,
      [PLATFORM_ORG_ID, TOPICS.SELECTION_LISTS_LIST_FORKED, p.list.id],
    );
    expect(onSource).toEqual([]);
  });

  it('a private fork emits list.forked with list.visibility "private" (and still the ordinary created events)', async () => {
    const q = await createPlatformList({ itemCodes: ['A'] });
    const { result, events } = await eventsFrom(ORG_E, () => forkList(owner, q.list.id, { visibility: 'private' }));
    expect(result.status).toBe(201);
    valid(events);
    expect(events.find((e) => e.topic === TOPICS.SELECTION_LISTS_LIST_FORKED)!.payload['list']).toMatchObject({ visibility: 'private' });
    expect(events.find((e) => e.topic === TOPICS.SELECTION_LISTS_LIST_CREATED)!.payload['list']).toMatchObject({ visibility: 'private' });
  });
});

describe('refused, idempotent and no-op requests emit nothing', () => {
  it('a repeat fork (200), fork_not_applicable, key conflict, quota-free 400/404/403 refusals: no event for the forking org, none for the source', async () => {
    const p = await createPlatformList({ itemCodes: ['A'] });
    expect((await forkList(owner, p.list.id)).status).toBe(201); // control: the first fork DOES emit (see above)
    const own = await createList(owner, { name: 'Own list' });
    const squatKey = `evsq-${Math.random().toString(36).slice(2, 8)}`;
    const q = await createPlatformList({ itemCodes: [], key: squatKey });
    await createList(owner, { key: squatKey, name: 'Squatter' });

    const attempts: Array<[string, () => Promise<{ status: number }>, number]> = [
      ['repeat fork', () => forkList(owner, p.list.id), 200],
      ['fork_not_applicable', () => forkList(owner, own.id), 409],
      ['key taken', () => forkList(owner, q.list.id), 409],
      ['body with id', () => forkList(owner, p.list.id, { id: 'front_sl_01h455vb4pex5vsknk084sn02q' }), 400],
      ['unknown list', () => forkList(owner, 'front_sl_01sl9neverexisted00000'), 404],
      ['no create (viewer)', () => forkList(viewer, p.list.id), 403],
    ];
    for (const [name, run, status] of attempts) {
      const markPlatform = await maxSeq();
      const { result, events } = await eventsFrom(ORG_E, run);
      expect({ name, status: result.status }).toEqual({ name, status });
      expect({ name, events: topicsOf(events) }).toEqual({ name, events: [] });
      expect({ name, source: forList(await eventsSince(PLATFORM_ORG_ID, markPlatform), p.list.id).length }).toEqual({ name, source: 0 });
    }
  });

  it('a mutation refused with fork_required (409) or 403 emits nothing — neither for the caller\'s org nor for the platform org', async () => {
    const p = await createPlatformList({ itemCodes: ['A'] });
    const mark = await maxSeq();
    const refused = await eventsFrom(ORG_E, async () => [
      await call(editor, 'PATCH', L(p.list.id), { name: 'x' }),
      await call(editor, 'POST', `${L(p.list.id)}/items`, { code: 'Z', label: 'Z' }),
      await call(viewer, 'DELETE', L(p.list.id)),
    ]);
    expect(refused.result.map((r) => r.status)).toEqual([409, 409, 403]);
    expect(refused.events).toEqual([]);
    expect(forList(await eventsSince(PLATFORM_ORG_ID, mark), p.list.id)).toEqual([]);
  });

  it('the platform operator\'s own mutation on the common list DOES emit — under the platform org, snapshot visibility "platform"', async () => {
    const p = await createPlatformList({ itemCodes: ['A'] });
    const mark = await maxSeq();
    const res = await call(p.owner, 'PATCH', L(p.list.id), { name: 'Renamed common list' });
    expect(res.status).toBe(200);
    const rows = forList(await eventsSince(PLATFORM_ORG_ID, mark), p.list.id);
    expect(topicsOf(rows)).toEqual([TOPICS.SELECTION_LISTS_LIST_UPDATED]);
    valid(rows);
    expect(rows[0].payload['organizationId']).toBe(PLATFORM_ORG_ID);
    expect(rows[0].payload['list']).toMatchObject({ name: 'Renamed common list', visibility: 'platform' });
  });
});

describe('visibility changes emit selection-lists.visibility.changed', () => {
  it('private -> org -> private: one visibility.changed each (and nothing else), previous / new visibility, snapshot, increasing revision', async () => {
    const l = await createList(owner, { name: 'Vis events' });
    const up = await eventsFrom(ORG_E, () => call(owner, 'PATCH', L(l.id), { visibility: 'org' }));
    expect(up.result.status).toBe(200);
    expect(topicsOf(up.events)).toEqual([TOPICS.SELECTION_LISTS_VISIBILITY_CHANGED]);
    valid(up.events);
    expect(up.events[0].payload).toMatchObject({ listId: l.id, previousVisibility: 'private', visibility: 'org', list: { visibility: 'org' } });
    const down = await eventsFrom(ORG_E, () => call(owner, 'PATCH', L(l.id), { visibility: 'private' }));
    expect(topicsOf(down.events)).toEqual([TOPICS.SELECTION_LISTS_VISIBILITY_CHANGED]);
    expect(down.events[0].payload).toMatchObject({ previousVisibility: 'org', visibility: 'private', list: { visibility: 'private' } });
    expect(down.events[0].payload['listRevision']).toBeGreaterThan(up.events[0].payload['listRevision']);
  });

  it('a combined PATCH {visibility, name} emits list.updated (changedFields has name, never visibility) AND visibility.changed in one transaction, distinct revisions', async () => {
    const l = await createList(owner, { name: 'Combined' });
    const { result, events } = await eventsFrom(ORG_E, () => call(owner, 'PATCH', L(l.id), { visibility: 'org', name: 'Combined renamed' }));
    expect(result.status).toBe(200);
    expect(events.map((e) => e.topic).sort()).toEqual([TOPICS.SELECTION_LISTS_LIST_UPDATED, TOPICS.SELECTION_LISTS_VISIBILITY_CHANGED].sort());
    valid(events);
    const updated = events.find((e) => e.topic === TOPICS.SELECTION_LISTS_LIST_UPDATED)!;
    expect(updated.payload['changedFields']).toContain('name');
    expect(updated.payload['changedFields']).not.toContain('visibility');
    expect(await transactionIds(events)).toHaveLength(1);
    expect(new Set(events.map((e) => e.payload['listRevision'])).size).toBe(2);
  });

  it('the same visibility, and a refused change (editor 403, invalid 400), emit nothing', async () => {
    const l = await createList(owner, { name: 'No-op events', visibility: 'org' });
    expect(await eventsFrom(ORG_E, () => call(owner, 'PATCH', L(l.id), { visibility: 'org' })).then((r) => ({ s: r.result.status, e: r.events }))).toEqual({ s: 200, e: [] });
    const editorGrant = await call(owner, 'PUT', `${L(l.id)}/access/${editor.userId}`, { role: 'list-editor' });
    expect(editorGrant.status).toBe(200);
    const denied = await eventsFrom(ORG_E, () => call(editor, 'PATCH', L(l.id), { visibility: 'private' }));
    expect(denied.result.status).toBe(403);
    expect(denied.events).toEqual([]);
    const invalid = await eventsFrom(ORG_E, () => call(owner, 'PATCH', L(l.id), { visibility: 'public' }));
    expect(invalid.result.status).toBe(400);
    expect(invalid.events).toEqual([]);
  });

  it('promotion to platform by the operator emits visibility.changed under the PLATFORM org; a refused demotion (409) emits nothing', async () => {
    const op = actor('op2', PLATFORM_ORG_ID, 'admin');
    const l = await createList(op, { name: 'Promoted', visibility: 'org' });
    const mark = await maxSeq();
    expect((await call(op, 'PATCH', L(l.id), { visibility: 'platform' })).status).toBe(200);
    const rows = forList(await eventsSince(PLATFORM_ORG_ID, mark), l.id);
    expect(topicsOf(rows)).toEqual([TOPICS.SELECTION_LISTS_VISIBILITY_CHANGED]);
    valid(rows);
    expect(rows[0].payload).toMatchObject({ organizationId: PLATFORM_ORG_ID, previousVisibility: 'org', visibility: 'platform' });
    const mark2 = await maxSeq();
    expect((await call(op, 'PATCH', L(l.id), { visibility: 'org' })).status).toBe(409);
    expect(forList(await eventsSince(PLATFORM_ORG_ID, mark2), l.id)).toEqual([]);
  });
});
