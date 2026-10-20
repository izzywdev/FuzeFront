import * as fs from 'fs';
import * as path from 'path';
import {
  TOPICS,
  SCHEMA_BY_TOPIC,
  schemaForTopic,
  partitionKeyForPayload,
  dlqTopic,
  selectionListsSeedRequestedSchemaV1,
  selectionListsSeedCompletedSchemaV1,
  selectionListsSeedFailedSchemaV1,
  selectionListsListUpdatedSchemaV1,
  selectionListsListArchivedSchemaV1,
  selectionListsItemArchivedSchemaV1,
  selectionListsTranslationUpsertedSchemaV1,
  selectionListSeedPackSchemaV1,
  selectionListsListForkedSchemaV1,
  selectionListsVisibilityChangedSchemaV1,
  slListSnapshotV1,
  slActorV1,
  SELECTION_LIST_LIMITS,
} from '../../src/kafka';

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'selection-lists');
const load = (name: string): any => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const EXAMPLES: Record<string, any> = load('published-examples.json');
const SEED_REQUEST: any = load('seed-request.expected.json');

const SL_TOPICS = Object.values(TOPICS).filter((t) => t.startsWith('selection-lists.'));

describe('selection-lists topics', () => {
  it('declares exactly the 18 contract topics, named domain.entity.verb', () => {
    expect(SL_TOPICS.sort()).toEqual(
      [
        'selection-lists.access.granted',
        'selection-lists.access.revoked',
        'selection-lists.item.archived',
        'selection-lists.item.created',
        'selection-lists.item.deleted',
        'selection-lists.item.reordered',
        'selection-lists.item.updated',
        'selection-lists.list.archived',
        'selection-lists.list.created',
        'selection-lists.list.deleted',
        'selection-lists.list.forked',
        'selection-lists.list.updated',
        'selection-lists.seed.completed',
        'selection-lists.seed.failed',
        'selection-lists.seed.requested',
        'selection-lists.translation.deleted',
        'selection-lists.translation.upserted',
        'selection-lists.visibility.changed',
      ].sort(),
    );
    for (const t of SL_TOPICS) expect(t.split('.')).toHaveLength(3);
  });

  it('registers a validating schema for every selection-lists topic', () => {
    for (const t of SL_TOPICS) {
      expect(SCHEMA_BY_TOPIC[t]).toBeDefined();
      expect(typeof schemaForTopic(t)!.safeParse).toBe('function');
    }
  });

  it('dead-letters to <topic>.dlq', () => {
    expect(dlqTopic(TOPICS.SELECTION_LISTS_SEED_REQUESTED)).toBe('selection-lists.seed.requested.dlq');
  });
});

describe('published examples (fixtures/selection-lists/published-examples.json)', () => {
  const published = SL_TOPICS.filter((t) => t !== TOPICS.SELECTION_LISTS_SEED_REQUESTED);

  it('has an example for every produced topic', () => {
    for (const t of published) expect(EXAMPLES[t]).toBeDefined();
  });

  it.each(published)('%s example validates via the registry', (topic) => {
    const result = schemaForTopic(topic)!.safeParse(EXAMPLES[topic]);
    if (!result.success) throw new Error(`${topic}: ${result.error.message}`);
  });

  it.each(published)('%s partitions by organizationId', (topic) => {
    expect(partitionKeyForPayload(EXAMPLES[topic])).toBe(EXAMPLES[topic].organizationId);
  });

  it.each(published)('%s rejects a bare-UUID organizationId (wire TypeIDs only)', (topic) => {
    const bad = clone(EXAMPLES[topic]);
    bad.organizationId = '0195a8f2-7c1e-7b3a-9f00-1a2b3c4d5e6f';
    expect(schemaForTopic(topic)!.safeParse(bad).success).toBe(false);
  });

  it.each(published)('%s requires eventId', (topic) => {
    const bad = clone(EXAMPLES[topic]);
    delete bad.eventId;
    expect(schemaForTopic(topic)!.safeParse(bad).success).toBe(false);
  });

  it('tolerates an additive unknown field on a published event (forward compatible)', () => {
    const extra = { ...clone(EXAMPLES[TOPICS.SELECTION_LISTS_LIST_CREATED]), futureField: 1 };
    expect(schemaForTopic(TOPICS.SELECTION_LISTS_LIST_CREATED)!.safeParse(extra).success).toBe(true);
  });
});

describe('shared lists and forks (shared 1.3.0 / HTTP 4.1.0)', () => {
  it('list snapshots without visibility/forkedFrom still validate (additive, pre-1.3.0 producers)', () => {
    const snap = clone(EXAMPLES[TOPICS.SELECTION_LISTS_LIST_CREATED].list);
    delete snap.visibility;
    delete snap.forkedFrom;
    expect(slListSnapshotV1.safeParse(snap).success).toBe(true);
    expect(slListSnapshotV1.safeParse({ ...snap, visibility: 'public' }).success).toBe(false);
  });

  it('list.forked: source org differs, key is kept, fork is never platform, item map is 1:1', () => {
    const ex = clone(EXAMPLES[TOPICS.SELECTION_LISTS_LIST_FORKED]);
    expect(selectionListsListForkedSchemaV1.safeParse(ex).success).toBe(true);
    expect(selectionListsListForkedSchemaV1.safeParse({ ...ex, source: { ...ex.source, organizationId: ex.organizationId } }).success).toBe(false);
    expect(selectionListsListForkedSchemaV1.safeParse({ ...ex, source: { ...ex.source, listKey: 'other' } }).success).toBe(false);
    expect(selectionListsListForkedSchemaV1.safeParse({ ...ex, list: { ...ex.list, visibility: 'platform' } }).success).toBe(false);
    const dup = clone(ex);
    dup.itemMap[1].originItemId = dup.itemMap[0].originItemId;
    expect(selectionListsListForkedSchemaV1.safeParse(dup).success).toBe(false);
  });

  it('visibility.changed: must change, platform is one-way, snapshot agrees', () => {
    const ex = clone(EXAMPLES[TOPICS.SELECTION_LISTS_VISIBILITY_CHANGED]);
    expect(selectionListsVisibilityChangedSchemaV1.safeParse(ex).success).toBe(true);
    expect(selectionListsVisibilityChangedSchemaV1.safeParse({ ...ex, previousVisibility: 'org' }).success).toBe(false);
    expect(
      selectionListsVisibilityChangedSchemaV1.safeParse({ ...ex, previousVisibility: 'platform', visibility: 'org' }).success,
    ).toBe(false);
    expect(
      selectionListsVisibilityChangedSchemaV1.safeParse({ ...ex, list: { ...ex.list, visibility: 'private' } }).success,
    ).toBe(false);
    expect(
      selectionListsVisibilityChangedSchemaV1.safeParse({
        ...ex,
        previousVisibility: 'org',
        visibility: 'platform',
        list: { ...ex.list, visibility: 'platform' },
      }).success,
    ).toBe(true);
  });

  it('seed.requested: an app may seed org/private lists but never a platform (common) list', () => {
    const org = clone(SEED_REQUEST);
    org.lists[0].visibility = 'org';
    expect(selectionListsSeedRequestedSchemaV1.safeParse(org).success).toBe(true);
    const platform = clone(SEED_REQUEST);
    platform.lists[0].visibility = 'platform';
    expect(selectionListsSeedRequestedSchemaV1.safeParse(platform).success).toBe(false);
  });

  it('platform seed pack: a list may declare platform visibility (one common instance)', () => {
    const pack = {
      packKey: 'platform-defaults',
      version: 2,
      appliesTo: ['organization', 'personal'],
      lists: [{ key: 'priority', sourceLocale: 'en', name: 'Priority', visibility: 'platform', items: [{ code: 'LOW', label: 'Low' }] }],
    };
    expect(selectionListSeedPackSchemaV1.safeParse(pack).success).toBe(true);
  });
});

describe('published event rules', () => {
  it('list.updated: previousKey iff key changed', () => {
    const ex = clone(EXAMPLES[TOPICS.SELECTION_LISTS_LIST_UPDATED]);
    expect(selectionListsListUpdatedSchemaV1.safeParse({ ...ex, previousKey: null }).success).toBe(false);
    expect(
      selectionListsListUpdatedSchemaV1.safeParse({ ...ex, changedFields: ['name'], previousKey: 'priority' }).success,
    ).toBe(false);
    expect(selectionListsListUpdatedSchemaV1.safeParse({ ...ex, changedFields: ['name'], previousKey: null }).success).toBe(
      true,
    );
  });

  it('list.archived / item.archived must carry status archived', () => {
    const l = clone(EXAMPLES[TOPICS.SELECTION_LISTS_LIST_ARCHIVED]);
    l.list.status = 'active';
    expect(selectionListsListArchivedSchemaV1.safeParse(l).success).toBe(false);
    const i = clone(EXAMPLES[TOPICS.SELECTION_LISTS_ITEM_ARCHIVED]);
    i.item.status = 'active';
    expect(selectionListsItemArchivedSchemaV1.safeParse(i).success).toBe(false);
  });

  it('translation target is discriminated by kind (item needs itemId)', () => {
    const ex = clone(EXAMPLES[TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED]);
    delete ex.target.itemId;
    expect(selectionListsTranslationUpsertedSchemaV1.safeParse(ex).success).toBe(false);
    const unknownKind = clone(EXAMPLES[TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED]);
    unknownKind.target.kind = 'org';
    expect(selectionListsTranslationUpsertedSchemaV1.safeParse(unknownKind).success).toBe(false);
  });

  it('actor is user(usr_) or the system principal', () => {
    expect(slActorV1.safeParse({ type: 'user', userId: 'usr_01h455vb4pex5vsknk084sn02q' }).success).toBe(true);
    expect(slActorV1.safeParse({ type: 'user', userId: 'org_01h455vb4pex5vsknk084sn02q' }).success).toBe(false);
    expect(
      slActorV1.safeParse({ type: 'system', principal: 'selection-list-service', seedSource: null }).success,
    ).toBe(true);
    expect(slActorV1.safeParse({ type: 'system', principal: 'billing-service', seedSource: null }).success).toBe(false);
  });

  it('seed.failed reason must be a known code; seed.completed outcome must be known', () => {
    const f = clone(EXAMPLES[TOPICS.SELECTION_LISTS_SEED_FAILED]);
    expect(selectionListsSeedFailedSchemaV1.safeParse({ ...f, reason: 'NOPE' }).success).toBe(false);
    const c = clone(EXAMPLES[TOPICS.SELECTION_LISTS_SEED_COMPLETED]);
    expect(selectionListsSeedCompletedSchemaV1.safeParse({ ...c, outcome: 'partial' }).success).toBe(false);
  });

  it('seed outcomes allow a null requestId (platform seed from identity.org.created)', () => {
    const c = clone(EXAMPLES[TOPICS.SELECTION_LISTS_SEED_COMPLETED]);
    c.requestId = null;
    c.source = { app: 'platform', service: 'selection-list-service' };
    c.trigger = 'org-created';
    expect(selectionListsSeedCompletedSchemaV1.safeParse(c).success).toBe(true);
  });
});

describe('selection-lists.seed.requested', () => {
  const parse = (p: unknown) => selectionListsSeedRequestedSchemaV1.safeParse(p);

  it('accepts the golden helper output', () => {
    const r = parse(SEED_REQUEST);
    if (!r.success) throw new Error(r.error.message);
    expect(partitionKeyForPayload(SEED_REQUEST)).toBe(SEED_REQUEST.organizationId);
  });

  it('is registered under its topic', () => {
    expect(schemaForTopic(TOPICS.SELECTION_LISTS_SEED_REQUESTED)!.safeParse(SEED_REQUEST).success).toBe(true);
  });

  it('rejects a client-supplied id on a list or an item (strict, identifier standard §1)', () => {
    const l = clone(SEED_REQUEST);
    l.lists[0].id = 'front_sl_01h455vb4pex5vsknk084sn02q';
    expect(parse(l).success).toBe(false);
    const i = clone(SEED_REQUEST);
    i.lists[0].items[0].id = 'front_sli_01h455vb4pex5vsknk084sn02q';
    expect(parse(i).success).toBe(false);
  });

  it('rejects unknown top-level fields', () => {
    expect(parse({ ...clone(SEED_REQUEST), overwrite: true }).success).toBe(false);
  });

  it('reserves the "platform" source', () => {
    const p = clone(SEED_REQUEST);
    p.source.app = 'platform';
    expect(parse(p).success).toBe(false);
  });

  it('scope user requires userId; scope org forbids it', () => {
    const u = clone(SEED_REQUEST);
    u.scope = 'user';
    expect(parse(u).success).toBe(false);
    u.userId = 'usr_01h455vb4pex5vsknk084sn02q';
    expect(parse(u).success).toBe(true);
    const o = clone(SEED_REQUEST);
    o.userId = 'usr_01h455vb4pex5vsknk084sn02q';
    expect(parse(o).success).toBe(false);
  });

  it('requires a service-token attestation', () => {
    const p = clone(SEED_REQUEST);
    delete p.attestation;
    expect(parse(p).success).toBe(false);
    const k = clone(SEED_REQUEST);
    k.attestation.kind = 'none';
    expect(parse(k).success).toBe(false);
  });

  it('rejects duplicate list keys and duplicate item codes', () => {
    const dk = clone(SEED_REQUEST);
    dk.lists[1].key = dk.lists[0].key;
    expect(parse(dk).success).toBe(false);
    const dc = clone(SEED_REQUEST);
    dc.lists[0].items[1].code = dc.lists[0].items[0].code;
    expect(parse(dc).success).toBe(false);
  });

  it('rejects a translation for the source locale and duplicate locales', () => {
    const src = clone(SEED_REQUEST);
    src.lists[0].translations = [{ locale: 'en', name: 'Deal stages' }];
    expect(parse(src).success).toBe(false);
    const dup = clone(SEED_REQUEST);
    dup.lists[0].translations = [
      { locale: 'es', name: 'a' },
      { locale: 'es', name: 'b' },
    ];
    expect(parse(dup).success).toBe(false);
  });

  it('rejects an unsupported locale, a bad key and a bad item code', () => {
    const loc = clone(SEED_REQUEST);
    loc.lists[0].sourceLocale = 'xx';
    expect(parse(loc).success).toBe(false);
    const key = clone(SEED_REQUEST);
    key.lists[0].key = 'Deal_Stages';
    expect(parse(key).success).toBe(false);
    const code = clone(SEED_REQUEST);
    code.lists[0].items[0].code = '-bad';
    expect(parse(code).success).toBe(false);
  });

  it('enforces list/item count ceilings', () => {
    const tooManyLists = clone(SEED_REQUEST);
    tooManyLists.lists = Array.from({ length: SELECTION_LIST_LIMITS.MAX_LISTS_PER_SEED + 1 }, (_, i) => ({
      key: `fuzecrm-l${i}`,
      sourceLocale: 'en',
      name: `L${i}`,
      items: [],
    }));
    expect(parse(tooManyLists).success).toBe(false);

    const tooManyItemsInList = clone(SEED_REQUEST);
    tooManyItemsInList.lists[0].items = Array.from({ length: SELECTION_LIST_LIMITS.MAX_ITEMS_PER_LIST + 1 }, (_, i) => ({
      code: `C${i}`,
      label: `C${i}`,
    }));
    expect(parse(tooManyItemsInList).success).toBe(false);

    const tooManyItemsTotal = clone(SEED_REQUEST);
    tooManyItemsTotal.lists = Array.from({ length: 5 }, (_, l) => ({
      key: `fuzecrm-l${l}`,
      sourceLocale: 'en',
      name: `L${l}`,
      items: Array.from({ length: 401 }, (_, i) => ({ code: `C${i}`, label: `C${i}` })),
    }));
    expect(parse(tooManyItemsTotal).success).toBe(false);
  });

  it('requires at least one list', () => {
    expect(parse({ ...clone(SEED_REQUEST), lists: [] }).success).toBe(false);
  });
});

describe('platform seed pack format', () => {
  const pack = {
    packKey: 'platform-defaults',
    version: 1,
    appliesTo: ['organization', 'personal'],
    lists: [
      {
        key: 'yes-no',
        sourceLocale: 'en',
        name: 'Yes / No',
        items: [
          { code: 'YES', label: 'Yes' },
          { code: 'NO', label: 'No' },
        ],
      },
    ],
  };

  it('accepts a well-formed pack', () => {
    expect(selectionListSeedPackSchemaV1.safeParse(pack).success).toBe(true);
  });

  it('applies the same cross-field rules as seed.requested', () => {
    const dup = clone(pack);
    dup.lists[0].items[1].code = 'YES';
    expect(selectionListSeedPackSchemaV1.safeParse(dup).success).toBe(false);
    expect(selectionListSeedPackSchemaV1.safeParse({ ...clone(pack), appliesTo: [] }).success).toBe(false);
  });
});
