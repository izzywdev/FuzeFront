/**
 * Seeding acceptance — docs/planning/selection-lists-events.md §7 (consumed events), §8 (trust
 * model), §9 (seed algorithm), §10 (platform packs), §14 test plan S1-S7 and R1-R14.
 *
 * Kafka-free: the only seeding entry points the service exposes without a broker are the
 * compiled consumer handlers (`dist/events/{org-created,seed-requested,org-deleted,user-deleted}
 * .handler.js`) and the public seed library (`dist/seed`). They are driven here against the SAME
 * Postgres the running service uses; the HTTP-visible half (what a client sees of a seeded row)
 * goes through the running service. See helpers/seed-harness.ts for what is real and what is
 * faked (the Kafka transport and the Security API's introspection endpoint only).
 *
 * Every assertion is against the frozen docs/schemas: outcome events are validated with the
 * shared Zod schemas, ledger/rows through SQL.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mintTestToken } from '../helpers/auth';
import { closeDb, dbQuery } from '../helpers/db';
import { rawFetch } from '../helpers/client';
import { assertResponse } from '../helpers/openapi';
import { allEvents, payloadErrors, TOPICS, topicsOf, OutboxRow } from '../helpers/outbox';
import {
  allowSource,
  countTopic,
  FakeIntrospection,
  itemRows,
  ledgerRows,
  listRows,
  listSpec,
  newOrg,
  newUser,
  nowS,
  orgCreatedEnvelope,
  orgDeletedEnvelope,
  projectionRow,
  seedEnvelope,
  seedPayload,
  setOrgQuota,
  SOURCE_APP,
  SOURCE_SUBJECT,
  supportGrantOwner,
  userDeletedEnvelope,
} from '../helpers/seed-harness';

// ---- capture EVERYTHING the service code logs (debug and up), to prove the token never reaches a log
const mockLogLines: string[] = [];
jest.mock('../../../services/selection-list-service/dist/lib/logger', () => {
  const actual = jest.requireActual('../../../services/selection-list-service/dist/lib/logger');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Writable } = require('stream');
  const dest = new Writable({
    write(chunk: Buffer, _enc: string, cb: () => void) {
      mockLogLines.push(chunk.toString());
      cb();
    },
  });
  return { ...actual, logger: actual.createLogger('debug', dest) };
});

import { handleOrgCreated } from '../../../services/selection-list-service/dist/events/org-created.handler';
import { handleOrgDeleted } from '../../../services/selection-list-service/dist/events/org-deleted.handler';
import { handleSeedRequested } from '../../../services/selection-list-service/dist/events/seed-requested.handler';
import { handleUserDeleted } from '../../../services/selection-list-service/dist/events/user-deleted.handler';
import { _setGrantTokenProviderForTesting } from '../../../services/selection-list-service/dist/lib/machineIdentity';
import { applyPlatformDefaults } from '../../../services/selection-list-service/dist/seed';
import { db } from '../../../services/selection-list-service/dist/db';

const introspection = new FakeIntrospection();
const FLAG_ON = async () => true;
const FLAG_OFF = async () => false;
const deadLetter = jest.fn().mockResolvedValue(undefined);

const PACK_FILE = path.resolve(__dirname, '../../../services/selection-list-service/seed-packs/platform/platform-defaults.v1.json');
const SYSTEM = 'system:selection-list-service';
const nonce = () => Math.random().toString(16).slice(2, 10);

let tokenSeq = 0;
function mintToken(kind: string, entry: Parameters<FakeIntrospection['tokens']['set']>[1]): string {
  const t = `sl7-tok-${kind}-${nonce()}-${++tokenSeq}`;
  introspection.tokens.set(t, entry);
  return t;
}
const validToken = () => mintToken('valid', { active: true, subject: SOURCE_SUBJECT, scope: 'selection-lists:seed', expiresAt: nowS() + 300 });

const ALL_TOKENS = () => [...introspection.tokens.keys()];

beforeAll(async () => {
  await introspection.start();
  // the service under test reads this lazily at first attestation; the harness owns the endpoint
  process.env['SECURITY_SERVICE_URL'] = introspection.url;
  delete process.env['FLAGS_FORCE_ON'];
  await allowSource(SOURCE_APP);
});

afterAll(async () => {
  await introspection.stop();
  await db.destroy();
  await closeDb();
});

const projectOnly = (org: { uuid: string }, over: Record<string, unknown> = {}) =>
  handleOrgCreated(orgCreatedEnvelope(org, over) as never, { isSeedingEnabled: FLAG_OFF });

const seed = (org: { wire: string }, token: string, over: Record<string, unknown> = {}, deps: Record<string, unknown> = {}) =>
  handleSeedRequested(seedEnvelope(seedPayload(org.wire, token, over)) as never, { isSeedingEnabled: FLAG_ON, deadLetter, ...deps });

type SeedResultView = {
  kind: string;
  result: { status: string; outcome?: string; reason?: string; retryable?: boolean; details?: any[]; lists?: any[]; appliedVersion?: number; eventId: string };
};

/** Unwrap a handler outcome that must be a `result`. */
const resultOf = (r: unknown): SeedResultView['result'] => {
  const v = r as SeedResultView;
  expect(v.kind).toBe('result');
  return v.result;
};

const validOutcomeEvents = (rows: OutboxRow[]) => {
  for (const r of rows) expect(payloadErrors(r.topic, r.payload)).toEqual([]);
};

const outcomeEvents = (rows: OutboxRow[]) => rows.filter((r) => r.topic === TOPICS.SELECTION_LISTS_SEED_COMPLETED || r.topic === TOPICS.SELECTION_LISTS_SEED_FAILED);

const lastOutcome = async (org: { wire: string }) => {
  const rows = outcomeEvents(await allEvents(org.wire));
  return rows[rows.length - 1];
};

const noSeedRows = async (org: { wire: string }) => {
  expect(await listRows(org.wire)).toEqual([]);
  expect(await itemRows(org.wire)).toEqual([]);
  expect(await ledgerRows(org.wire)).toEqual([]);
};

const pack = JSON.parse(fs.readFileSync(PACK_FILE, 'utf8')) as {
  packKey: string;
  version: number;
  appliesTo: string[];
  lists: Array<{ key: string; translations?: unknown[]; items: Array<{ translations?: unknown[] }> }>;
};

// =============================================================================================
// Platform defaults — identity.org.created (§7.1, §10; S1-S6)
// =============================================================================================

describe('platform defaults on identity.org.created', () => {
  it('S1: a new organization gets the shipped pack: 3 lists, 10 items, translations, ledger row, seed.completed(applied)', async () => {
    expect(pack.lists.map((l) => l.key).sort()).toEqual(['priority', 'work-status', 'yes-no']);
    expect(pack.lists.reduce((n, l) => n + l.items.length, 0)).toBe(10);
    const org = newOrg();
    const out = await handleOrgCreated(orgCreatedEnvelope(org) as never, { isSeedingEnabled: FLAG_ON });
    expect(out).toMatchObject({ projected: true, seeding: 'attempted' });

    const lists = await listRows(org.wire);
    expect(lists.map((l) => l.key)).toEqual(['priority', 'work-status', 'yes-no']);
    expect(await itemRows(org.wire)).toHaveLength(10);
    for (const l of lists) {
      expect(l).toMatchObject({ status: 'active', created_by: SYSTEM, seed_source: 'platform', seed_key: 'platform-defaults', seed_version: 1, seed_user_modified: false });
    }

    const ledger = await ledgerRows(org.wire);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ seed_source: 'platform', seed_key: 'platform-defaults', version: 1, trigger: 'org-created', applied_by: SYSTEM, request_id: null, attested_subject: null });

    const events = await allEvents(org.wire);
    validOutcomeEvents(events);
    expect(countTopic(events, TOPICS.SELECTION_LISTS_LIST_CREATED)).toBe(3);
    expect(countTopic(events, TOPICS.SELECTION_LISTS_ITEM_CREATED)).toBe(10);
    const expectedTranslations = pack.lists.reduce((n, l) => n + (l.translations?.length ?? 0) + l.items.reduce((m, i) => m + (i.translations?.length ?? 0), 0), 0);
    expect(expectedTranslations).toBeGreaterThan(0);
    expect(countTopic(events, TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED)).toBe(expectedTranslations);
    // no human owner is invented for a seeded list (§9.2)
    expect(countTopic(events, TOPICS.SELECTION_LISTS_ACCESS_GRANTED)).toBe(0);
    expect(await dbQuery('SELECT 1 FROM selection_list_access a JOIN selection_lists l ON l.id = a.list_id WHERE l.organization_id = $1', [org.wire])).toEqual([]);

    // seed.completed is last, and says what happened
    const last = events[events.length - 1];
    expect(last.topic).toBe(TOPICS.SELECTION_LISTS_SEED_COMPLETED);
    expect(last.payload).toMatchObject({ outcome: 'applied', appliedVersion: 1, requestId: null, scope: 'org', trigger: 'org-created', source: { app: 'platform' }, pack: { key: 'platform-defaults', version: 1 } });
    expect((last.payload['lists'] as Array<{ action: string }>).map((l) => l.action)).toEqual(['created', 'created', 'created']);
    // every list event is attributed to the system principal, with the source
    for (const e of events.filter((x) => x.topic === TOPICS.SELECTION_LISTS_LIST_CREATED)) {
      expect(e.payload['actor']).toEqual({ type: 'system', principal: 'selection-list-service', seedSource: 'platform' });
      expect(e.payload['list']['seed']).toMatchObject({ source: 'platform', packKey: 'platform-defaults', packVersion: 1, userModified: false });
    }
    // sort_order = (index + 1) * 100, items in array order (§9 step 2)
    const yesNo = (await itemRows(org.wire)).filter((i) => i.list_id === lists.find((l) => l.key === 'yes-no')!.id);
    expect(yesNo.map((i) => [i.code, i.sort_order])).toEqual([['YES', 100], ['NO', 200]]);
  });

  it('a personal organization is also seeded (appliesTo includes personal)', async () => {
    const org = newOrg();
    await handleOrgCreated(orgCreatedEnvelope(org, { type: 'personal' }) as never, { isSeedingEnabled: FLAG_ON });
    expect(await listRows(org.wire)).toHaveLength(3);
  });

  it('S2: a duplicate delivery is already-applied: same result, no new rows, no duplicate list/item events', async () => {
    const org = newOrg();
    await handleOrgCreated(orgCreatedEnvelope(org) as never, { isSeedingEnabled: FLAG_ON });
    const firstEvents = await allEvents(org.wire);
    const firstOutcome = firstEvents[firstEvents.length - 1];
    const firstLists = await listRows(org.wire);

    await handleOrgCreated(orgCreatedEnvelope(org, {}, 'redelivery') as never, { isSeedingEnabled: FLAG_ON });
    await handleOrgCreated(orgCreatedEnvelope(org, {}, 'redelivery-2') as never, { isSeedingEnabled: FLAG_ON });

    expect(await listRows(org.wire)).toEqual(firstLists);
    expect(await itemRows(org.wire)).toHaveLength(10);
    expect(await ledgerRows(org.wire)).toHaveLength(1);
    const after = (await allEvents(org.wire)).slice(firstEvents.length);
    expect(topicsOf(after)).toEqual([TOPICS.SELECTION_LISTS_SEED_COMPLETED, TOPICS.SELECTION_LISTS_SEED_COMPLETED]);
    for (const e of after) {
      expect(e.payload).toMatchObject({ outcome: 'already-applied', appliedVersion: 1 });
      expect(e.payload['lists']).toEqual(firstOutcome.payload['lists']); // the stored per-list result is replayed
    }
    validOutcomeEvents(after);
  });

  it('S3: isActive:false is projected but nothing is seeded (no ledger row, no events)', async () => {
    const org = newOrg();
    const out = await handleOrgCreated(orgCreatedEnvelope(org, { isActive: false }) as never, { isSeedingEnabled: FLAG_ON });
    expect(out).toMatchObject({ projected: true, seeding: 'skipped-inactive' });
    expect(await projectionRow(org.uuid)).toMatchObject({ status: 'active', is_active: false, org_type: 'organization', wire_id: org.wire });
    await noSeedRows(org);
    expect(await allEvents(org.wire)).toEqual([]);
  });

  it('S4: type platform (the root org) is not seeded — pack appliesTo excludes it', async () => {
    const org = newOrg();
    const out = await handleOrgCreated(orgCreatedEnvelope(org, { type: 'platform' }) as never, { isSeedingEnabled: FLAG_ON });
    expect(out).toMatchObject({ projected: true, seeding: 'attempted' });
    await noSeedRows(org);
    expect(await allEvents(org.wire)).toEqual([]);
  });

  it('S5: flag OFF is projection-only; flag ON + the reconciler entry point seeds with trigger backfill', async () => {
    const org = newOrg();
    const out = await handleOrgCreated(orgCreatedEnvelope(org) as never, { isSeedingEnabled: FLAG_OFF });
    expect(out).toMatchObject({ projected: true, seeding: 'skipped-flag-off' });
    expect(await projectionRow(org.uuid)).toMatchObject({ status: 'active', is_active: true, wire_id: org.wire });
    await noSeedRows(org);
    expect(await allEvents(org.wire)).toEqual([]);

    const outcomes = await applyPlatformDefaults(db, org.wire, { trigger: 'backfill' });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].result).toMatchObject({ status: 'completed', outcome: 'applied' });
    expect((await ledgerRows(org.wire))[0]).toMatchObject({ trigger: 'backfill' });
    expect(await listRows(org.wire)).toHaveLength(3);
    const last = await lastOutcome(org);
    expect(last.payload).toMatchObject({ outcome: 'applied', trigger: 'backfill', requestId: null });
  });

  it('the seeding flag fails closed: with no flag source the real gate is OFF, so the org is only projected', async () => {
    delete process.env['FLAGS_FORCE_ON'];
    const org = newOrg();
    const out = await handleOrgCreated(orgCreatedEnvelope(org) as never); // real isSeedingEnabled, no override
    expect(out).toMatchObject({ projected: true, seeding: 'skipped-flag-off' });
    await noSeedRows(org);
  });

  it('S6: org.deleted processed BEFORE org.created -> no lists, seed.failed ORG_INACTIVE (non-retryable); never resurrected', async () => {
    const org = newOrg();
    await handleOrgDeleted(orgDeletedEnvelope(org, 'soft') as never);
    expect(await projectionRow(org.uuid)).toMatchObject({ status: 'deleted' });

    await handleOrgCreated(orgCreatedEnvelope(org) as never, { isSeedingEnabled: FLAG_ON });
    expect(await listRows(org.wire)).toEqual([]);
    expect(await ledgerRows(org.wire)).toEqual([]);
    expect((await projectionRow(org.uuid))?.status).toBe('deleted'); // tombstone survives the late create
    const events = await allEvents(org.wire);
    expect(topicsOf(events)).toEqual([TOPICS.SELECTION_LISTS_SEED_FAILED]);
    expect(events[0].payload).toMatchObject({ reason: 'ORG_INACTIVE', retryable: false, requestId: null });
    validOutcomeEvents(events);
  });

  it('org.deleted (hard) removes the org\'s ledger rows; (soft) keeps them so a restore does not re-seed', async () => {
    const soft = newOrg();
    await handleOrgCreated(orgCreatedEnvelope(soft) as never, { isSeedingEnabled: FLAG_ON });
    await handleOrgDeleted(orgDeletedEnvelope(soft, 'soft') as never);
    expect(await ledgerRows(soft.wire)).toHaveLength(1);
    expect((await listRows(soft.wire)).every((l) => l.status === 'archived')).toBe(true);

    const hard = newOrg();
    await handleOrgCreated(orgCreatedEnvelope(hard) as never, { isSeedingEnabled: FLAG_ON });
    await handleOrgDeleted(orgDeletedEnvelope(hard, 'hard') as never);
    expect(await ledgerRows(hard.wire)).toEqual([]);
    expect(await listRows(hard.wire)).toEqual([]);
  });

  it('P5: the org-wide cascade emits no per-list events (consumers subscribe to identity.org.deleted themselves)', async () => {
    const org = newOrg();
    await handleOrgCreated(orgCreatedEnvelope(org) as never, { isSeedingEnabled: FLAG_ON });
    const before = (await allEvents(org.wire)).length;
    await handleOrgDeleted(orgDeletedEnvelope(org, 'soft') as never);
    expect((await allEvents(org.wire)).length).toBe(before);
    await handleOrgDeleted(orgDeletedEnvelope(org, 'hard') as never);
    expect((await allEvents(org.wire)).length).toBe(before);
  });
});

// =============================================================================================
// Pack upgrade (§9 step 2; S7) — user-edited protected, user-purged not recreated, dropped archived
// =============================================================================================

describe('S7: pack version upgrade respects the humans who took ownership', () => {
  const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'sl7-packs1-'));
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sl7-packs2-'));
  const L = (key: string, items: Array<[string, string]>, name = `Name ${key}`) => ({
    key,
    sourceLocale: 'en',
    name,
    items: items.map(([code, label]) => ({ code, label })),
  });
  const v1 = {
    packKey: 'sl7-upgrade',
    version: 1,
    appliesTo: ['organization'],
    lists: [
      L('up-plain', [['A1', 'One'], ['A2', 'Two'], ['A3', 'Three']]),
      L('up-edited', [['B1', 'One']]),
      L('up-purged', [['C1', 'One']]),
      L('up-dropped', [['D1', 'One']]),
    ],
  };
  const v2 = {
    packKey: 'sl7-upgrade',
    version: 2,
    appliesTo: ['organization'],
    lists: [
      // A1 relabelled, A2 removed from the pack, A4 added
      L('up-plain', [['A1', 'One (v2)'], ['A3', 'Three'], ['A4', 'Four']], 'Name up-plain v2'),
      L('up-edited', [['B1', 'One'], ['B2', 'Two']], 'Name up-edited v2'),
      L('up-purged', [['C1', 'One']], 'Name up-purged v2'),
      L('up-new', [['E1', 'One']]),
    ],
  };
  beforeAll(() => {
    fs.writeFileSync(path.join(dir1, 'sl7-upgrade.v1.json'), JSON.stringify(v1));
    fs.writeFileSync(path.join(dir2, 'sl7-upgrade.v1.json'), JSON.stringify(v1));
    fs.writeFileSync(path.join(dir2, 'sl7-upgrade.v2.json'), JSON.stringify(v2));
  });

  it('applies v1, a human edits one list and purges another, then v2 upgrades only what is still the seed\'s', async () => {
    const org = newOrg();
    const user = newUser();
    await projectOnly(org);
    const first = await applyPlatformDefaults(db, org.wire, { packDir: dir1 });
    expect(first[0].result).toMatchObject({ status: 'completed', outcome: 'applied' });
    const byKey = async () => Object.fromEntries((await listRows(org.wire)).map((l) => [l.key, l]));
    const v1Lists = await byKey();
    const v1Items = await itemRows(org.wire);
    const sortOf = (rows: any[], listId: string) => Object.fromEntries(rows.filter((i) => i.list_id === listId).map((i) => [i.code, i.sort_order]));
    expect(sortOf(v1Items, v1Lists['up-plain'].id)).toEqual({ A1: 100, A2: 200, A3: 300 });

    // humans act through the real HTTP API (support-path owner grants: seeded lists have no owner)
    const tok = () => mintTestToken({ userId: user.wire, organizationId: org.wire });
    await supportGrantOwner(org.wire, user.wire, v1Lists['up-edited'].id);
    await supportGrantOwner(org.wire, user.wire, v1Lists['up-purged'].id);
    const edit = await rawFetch(`/v1/selection-lists/${v1Lists['up-edited'].id}`, { method: 'PATCH', token: tok(), body: JSON.stringify({ name: 'My own name' }) });
    expect(edit.status).toBe(200);
    expect((edit.body as { seed: unknown }).seed).toMatchObject({ source: 'platform', pack_key: 'sl7-upgrade', pack_version: 1, user_modified: true });
    const purge = await rawFetch(`/v1/selection-lists/${v1Lists['up-purged'].id}?purge=true`, { method: 'DELETE', token: tok() });
    expect([200, 204]).toContain(purge.status);

    const mark = (await allEvents(org.wire)).length;
    const second = await applyPlatformDefaults(db, org.wire, { packDir: dir2 });
    expect(second[0].result).toMatchObject({ status: 'completed', outcome: 'upgraded', appliedVersion: 2 });
    const perList = Object.fromEntries((second[0].result as { lists: Array<{ key: string; action: string }> }).lists.map((l) => [l.key, l]));
    expect(perList['up-plain']).toMatchObject({ action: 'updated', itemsCreated: 1, itemsArchived: 1 });
    expect(perList['up-edited'].action).toBe('skipped-user-edited');
    expect(perList['up-purged'].action).toBe('skipped-user-deleted');
    expect(perList['up-dropped'].action).toBe('archived');
    expect(perList['up-new'].action).toBe('created');

    const v2Lists = await byKey();
    // user-edited: untouched, INCLUDING the item new in v2
    expect(v2Lists['up-edited']).toBeDefined();
    const editedView = await rawFetch(`/v1/selection-lists/${v2Lists['up-edited'].id}`, { method: 'GET', token: tok() });
    expect((editedView.body as { name: string }).name).toBe('My own name');
    const itemsNow = await itemRows(org.wire);
    expect(itemsNow.filter((i) => i.list_id === v2Lists['up-edited'].id).map((i) => i.code)).toEqual(['B1']);
    // user-purged: never recreated
    expect(v2Lists['up-purged']).toBeUndefined();
    // dropped from the pack, unmodified: archived (still there, still resolves)
    expect(v2Lists['up-dropped']).toMatchObject({ status: 'archived' });
    // plain: updated in place — new item appended after max, removed item archived not deleted, existing order untouched
    const plainItems = itemsNow.filter((i) => i.list_id === v2Lists['up-plain'].id);
    const byCode = Object.fromEntries(plainItems.map((i) => [i.code, i]));
    expect(byCode['A1'].sort_order).toBe(100);
    expect(byCode['A3'].sort_order).toBe(300);
    expect(byCode['A2']).toMatchObject({ status: 'archived', sort_order: 200 });
    expect(byCode['A4'].sort_order).toBeGreaterThan(300);
    expect(v2Lists['up-plain']).toMatchObject({ seed_version: 2, status: 'active' });
    // a new list in v2 is created
    expect(v2Lists['up-new']).toMatchObject({ seed_version: 2 });

    const delta = (await allEvents(org.wire)).slice(mark);
    validOutcomeEvents(delta);
    expect(delta[delta.length - 1].topic).toBe(TOPICS.SELECTION_LISTS_SEED_COMPLETED);
    expect(delta[delta.length - 1].payload).toMatchObject({ outcome: 'upgraded', appliedVersion: 2 });
    // nothing was emitted for the lists that were left alone
    for (const e of delta.filter((x) => x.payload['listKey'])) {
      expect(['up-edited', 'up-purged']).not.toContain(e.payload['listKey']);
    }
    // a second delivery of the same upgrade is already-applied
    const again = await applyPlatformDefaults(db, org.wire, { packDir: dir2 });
    expect(again[0].result).toMatchObject({ status: 'completed', outcome: 'already-applied' });
  });
});

// =============================================================================================
// App seeding — selection-lists.seed.requested (§7.2, §8; R1-R14)
// =============================================================================================

describe('app seeding: happy path, idempotency, versioning', () => {
  it('R1: allowlisted source + valid attestation -> applied; rows carry provenance and the system principal', async () => {
    const org = newOrg();
    await projectOnly(org);
    const payload = seedPayload(org.wire, validToken(), { requestId: 'sl7:r1' });
    const r = resultOf(await handleSeedRequested(seedEnvelope(payload) as never, { isSeedingEnabled: FLAG_ON, deadLetter }));
    expect(r).toMatchObject({ status: 'completed', outcome: 'applied', appliedVersion: 1 });

    const lists = await listRows(org.wire);
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ key: 'sl7app-stages', created_by: SYSTEM, status: 'active', seed_source: SOURCE_APP, seed_key: 'sl7-pack', seed_list_key: 'sl7app-stages', seed_version: 1, seed_user_modified: false });
    const items = await itemRows(org.wire);
    expect(items.map((i) => [i.code, i.sort_order, i.created_by, i.seed_source])).toEqual([['LEAD', 100, SYSTEM, SOURCE_APP], ['WON', 200, SYSTEM, SOURCE_APP]]);
    expect((await ledgerRows(org.wire))[0]).toMatchObject({ seed_source: SOURCE_APP, seed_key: 'sl7-pack', version: 1, request_id: 'sl7:r1', trigger: 'app-installed', applied_by: SYSTEM, attested_subject: SOURCE_SUBJECT });

    const events = await allEvents(org.wire);
    validOutcomeEvents(events);
    expect(topicsOf(events).filter((t) => t !== TOPICS.SELECTION_LISTS_TRANSLATION_UPSERTED)).toEqual([
      TOPICS.SELECTION_LISTS_LIST_CREATED,
      TOPICS.SELECTION_LISTS_ITEM_CREATED,
      TOPICS.SELECTION_LISTS_ITEM_CREATED,
      TOPICS.SELECTION_LISTS_SEED_COMPLETED,
    ]);
    expect(events[0].payload['actor']).toEqual({ type: 'system', principal: 'selection-list-service', seedSource: SOURCE_APP });
    expect(events[events.length - 1].payload).toMatchObject({ requestId: 'sl7:r1', outcome: 'applied', source: { app: SOURCE_APP, service: SOURCE_SUBJECT }, pack: { key: 'sl7-pack', version: 1 }, trigger: 'app-installed' });
    // audit rows name the seeding action and the system principal
    const audit = await dbQuery("SELECT action, actor_id FROM selection_list_audit WHERE list_id = $1", [lists[0].id]);
    expect(audit.some((a) => a.action === 'seed.applied' && a.actor_id === SYSTEM)).toBe(true);
  });

  it('R2: a duplicate (same requestId, same content) is already-applied with an identical lists result; writes nothing', async () => {
    const org = newOrg();
    await projectOnly(org);
    const payload = seedPayload(org.wire, validToken(), { requestId: 'sl7:r2' });
    const first = resultOf(await handleSeedRequested(seedEnvelope(payload) as never, { isSeedingEnabled: FLAG_ON, deadLetter }));
    const before = await allEvents(org.wire);
    const rowsBefore = await listRows(org.wire);
    const dup = resultOf(await handleSeedRequested(seedEnvelope({ ...payload, attestation: { kind: 'service-token', token: validToken() } }) as never, { isSeedingEnabled: FLAG_ON, deadLetter }));
    expect(dup).toMatchObject({ status: 'completed', outcome: 'already-applied' });
    expect(dup.lists).toEqual(first.lists);
    expect(await listRows(org.wire)).toEqual(rowsBefore);
    const after = (await allEvents(org.wire)).slice(before.length);
    expect(topicsOf(after)).toEqual([TOPICS.SELECTION_LISTS_SEED_COMPLETED]);
  });

  it('R3: same version, different content -> PACK_CONTENT_MISMATCH (non-retryable); nothing written', async () => {
    const org = newOrg();
    await projectOnly(org);
    await seed(org, validToken(), { requestId: 'sl7:r3a' });
    const rows = await listRows(org.wire);
    const items = await itemRows(org.wire);
    const r = resultOf(await seed(org, validToken(), { requestId: 'sl7:r3b', lists: [listSpec(`${SOURCE_APP}-stages`, ['LEAD', 'WON', 'LOST'])] }));
    expect(r).toMatchObject({ status: 'failed', reason: 'PACK_CONTENT_MISMATCH', retryable: false });
    expect(await listRows(org.wire)).toEqual(rows);
    expect(await itemRows(org.wire)).toEqual(items);
    expect((await lastOutcome(org)).topic).toBe(TOPICS.SELECTION_LISTS_SEED_FAILED);
  });

  it('R4: an older version after a newer one is superseded; a newer version upgrades', async () => {
    const org = newOrg();
    await projectOnly(org);
    await seed(org, validToken(), { requestId: 'sl7:r4a', pack: { key: 'sl7-pack', version: 2 }, lists: [listSpec(`${SOURCE_APP}-stages`, ['LEAD', 'WON'])] });
    const old = resultOf(await seed(org, validToken(), { requestId: 'sl7:r4b', pack: { key: 'sl7-pack', version: 1 } }));
    expect(old).toMatchObject({ status: 'completed', outcome: 'superseded', appliedVersion: 2 });
    expect(await listRows(org.wire)).toHaveLength(1);
    const up = resultOf(await seed(org, validToken(), { requestId: 'sl7:r4c', pack: { key: 'sl7-pack', version: 3 }, lists: [listSpec(`${SOURCE_APP}-stages`, ['LEAD', 'WON', 'LOST'])] }));
    expect(up).toMatchObject({ status: 'completed', outcome: 'upgraded', appliedVersion: 3 });
    expect((await itemRows(org.wire)).map((i) => i.code)).toEqual(['LEAD', 'WON', 'LOST']);
  });

  it('R14: concurrent duplicates serialise on the advisory lock: one applied, one already-applied, one set of rows', async () => {
    const org = newOrg();
    await projectOnly(org);
    const base = seedPayload(org.wire, '', { requestId: 'sl7:r14' });
    const run = () => handleSeedRequested(seedEnvelope({ ...base, attestation: { kind: 'service-token', token: validToken() } }) as never, { isSeedingEnabled: FLAG_ON, deadLetter });
    const results = (await Promise.all([run(), run(), run()])).map((r) => resultOf(r));
    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes).toEqual(['already-applied', 'already-applied', 'applied']);
    expect(await listRows(org.wire)).toHaveLength(1);
    expect(await itemRows(org.wire)).toHaveLength(2);
    expect(await ledgerRows(org.wire)).toHaveLength(1);
    expect(countTopic(await allEvents(org.wire), TOPICS.SELECTION_LISTS_LIST_CREATED)).toBe(1);
  });
});

describe('app seeding: refusals leave nothing behind', () => {
  it('R5: scope "user" -> SCOPE_UNSUPPORTED (non-retryable), no rows, outcome event carries scope/userId', async () => {
    const org = newOrg();
    await projectOnly(org);
    const user = newUser();
    const r = resultOf(await seed(org, validToken(), { requestId: 'sl7:r5', scope: 'user', userId: user.wire }));
    expect(r).toMatchObject({ status: 'failed', reason: 'SCOPE_UNSUPPORTED', retryable: false });
    await noSeedRows(org);
    const last = await lastOutcome(org);
    expect(last.payload).toMatchObject({ reason: 'SCOPE_UNSUPPORTED', scope: 'user', userId: user.wire, requestId: 'sl7:r5' });
    validOutcomeEvents([last]);
  });

  it('SEEDING_DISABLED: flag OFF -> retryable seed.failed, the token is not even introspected, nothing written', async () => {
    const org = newOrg();
    await projectOnly(org);
    const token = validToken();
    const asked = introspection.asked.length;
    const r = resultOf(await handleSeedRequested(seedEnvelope(seedPayload(org.wire, token, { requestId: 'sl7:off' })) as never, { isSeedingEnabled: FLAG_OFF, deadLetter }));
    expect(r).toMatchObject({ status: 'failed', reason: 'SEEDING_DISABLED', retryable: true });
    expect(introspection.asked.slice(asked)).not.toContain(token);
    await noSeedRows(org);
  });

  describe('R6: attestation failure matrix', () => {
    const cases: Array<[string, string, boolean, () => string]> = [
      ['inactive / unknown token', 'ATTESTATION_INVALID', true, () => mintToken('inactive', { active: false })],
      ['expired token', 'ATTESTATION_INVALID', true, () => mintToken('expired', { active: true, subject: SOURCE_SUBJECT, scope: 'selection-lists:seed', expiresAt: nowS() - 30 })],
      ['wrong scope (authz:admin, not selection-lists:seed)', 'ATTESTATION_INVALID', true, () => mintToken('scope', { active: true, subject: SOURCE_SUBJECT, scope: 'authz:admin', expiresAt: nowS() + 300 })],
      ['no scope at all', 'ATTESTATION_INVALID', true, () => mintToken('noscope', { active: true, subject: SOURCE_SUBJECT, expiresAt: nowS() + 300 })],
      ['valid token for a subject NOT in allowed_subjects', 'SOURCE_NOT_ALLOWED', false, () => mintToken('subject', { active: true, subject: 'some-other-service', scope: 'selection-lists:seed', expiresAt: nowS() + 300 })],
    ];
    it.each(cases)('%s -> %s (retryable: %s), nothing written, token never echoed', async (_name, reason, retryable, mk) => {
      const org = newOrg();
      await projectOnly(org);
      const token = mk();
      const requestId = `sl7:r6:${nonce()}`;
      const r = resultOf(await handleSeedRequested(seedEnvelope(seedPayload(org.wire, token, { requestId })) as never, { isSeedingEnabled: FLAG_ON, deadLetter }));
      expect(r).toMatchObject({ status: 'failed', reason, retryable });
      await noSeedRows(org);
      const events = await allEvents(org.wire);
      expect(topicsOf(events)).toEqual([TOPICS.SELECTION_LISTS_SEED_FAILED]);
      validOutcomeEvents(events);
      expect(events[0].payload).toMatchObject({ requestId, reason, retryable });
      expect(JSON.stringify(events)).not.toContain(token);
      expect(JSON.stringify(r)).not.toContain(token);
    });

    it('an introspection outage / non-200 cannot decide: the handler throws (consumer retries), nothing is written (fail closed)', async () => {
      const org = newOrg();
      await projectOnly(org);
      for (const kind of ['outage', 'http500'] as const) {
        const token = mintToken(kind, kind);
        await expect(
          handleSeedRequested(seedEnvelope(seedPayload(org.wire, token, { requestId: `sl7:${kind}` })) as never, { isSeedingEnabled: FLAG_ON, deadLetter }),
        ).rejects.toBeDefined();
      }
      await noSeedRows(org);
      expect(await allEvents(org.wire)).toEqual([]);
    });
  });

  it('R7: unknown source, disabled source and the reserved source "platform" are all refused', async () => {
    const org = newOrg();
    await projectOnly(org);
    const unknown = resultOf(await seed(org, validToken(), { requestId: 'sl7:r7a', source: { app: 'sl7-unknown', service: SOURCE_SUBJECT }, lists: [listSpec('sl7-unknown-x', ['A'])] }));
    expect(unknown).toMatchObject({ status: 'failed', reason: 'SOURCE_NOT_ALLOWED', retryable: false });

    await allowSource('sl7off', { enabled: false });
    const disabled = resultOf(await seed(org, validToken(), { requestId: 'sl7:r7b', source: { app: 'sl7off', service: SOURCE_SUBJECT }, lists: [listSpec('sl7off-x', ['A'])] }));
    expect(disabled).toMatchObject({ status: 'failed', reason: 'SOURCE_NOT_ALLOWED' });

    // `platform` is reserved (§8): refused either at the schema (best-effort VALIDATION_ERROR) or by the allowlist
    const platformOut = (await seed(org, validToken(), { requestId: 'sl7:r7c', source: { app: 'platform', service: SOURCE_SUBJECT }, lists: [listSpec('platform-x', ['A'])] })) as { kind: string; result?: { status: string; reason?: string } };
    if (platformOut.kind === 'invalid') {
      expect(platformOut.kind).toBe('invalid');
    } else {
      expect(platformOut.result).toMatchObject({ status: 'failed' });
      expect(['SOURCE_NOT_ALLOWED', 'NAMESPACE_VIOLATION']).toContain(platformOut.result?.reason);
    }
    await noSeedRows(org);
  });

  it('R8: a list key outside the source\'s key_prefixes -> NAMESPACE_VIOLATION, nothing written', async () => {
    const org = newOrg();
    await projectOnly(org);
    const r = resultOf(await seed(org, validToken(), { requestId: 'sl7:r8a', lists: [listSpec(`${SOURCE_APP}-ok`, ['A']), listSpec('someone-elses-list', ['A'])] }));
    expect(r).toMatchObject({ status: 'failed', reason: 'NAMESPACE_VIOLATION', retryable: false });
    expect(r.details?.some((d) => d.listKey === 'someone-elses-list')).toBe(true);
    await noSeedRows(org);
  });

  it('R8: over the per-source caps -> LIMIT_EXCEEDED (lists and items), nothing written', async () => {
    await allowSource('sl7tiny', { subjects: [SOURCE_SUBJECT], prefixes: ['sl7tiny-'], maxLists: 1, maxItems: 3 });
    const org = newOrg();
    await projectOnly(org);
    const tooManyLists = resultOf(await seed(org, validToken(), { requestId: 'sl7:r8b', source: { app: 'sl7tiny', service: SOURCE_SUBJECT }, lists: [listSpec('sl7tiny-a', ['A']), listSpec('sl7tiny-b', ['A'])] }));
    expect(tooManyLists).toMatchObject({ status: 'failed', reason: 'LIMIT_EXCEEDED', retryable: false });
    expect(tooManyLists.details?.some((d) => d.quotaScope === 'request_lists')).toBe(true);
    const tooManyItems = resultOf(await seed(org, validToken(), { requestId: 'sl7:r8c', source: { app: 'sl7tiny', service: SOURCE_SUBJECT }, lists: [listSpec('sl7tiny-a', ['A', 'B', 'C', 'D'])] }));
    expect(tooManyItems).toMatchObject({ status: 'failed', reason: 'LIMIT_EXCEEDED' });
    expect(tooManyItems.details?.some((d) => d.quotaScope === 'request_items')).toBe(true);
    await noSeedRows(org);
  });

  it('R9: partial failure is impossible — a 3rd list over the item quota writes nothing for lists 1-2 (QUOTA_EXCEEDED, details populated)', async () => {
    const org = newOrg();
    await projectOnly(org);
    await setOrgQuota(org.wire, 100, 2);
    const r = resultOf(await seed(org, validToken(), {
      requestId: 'sl7:r9',
      lists: [listSpec(`${SOURCE_APP}-one`, ['A']), listSpec(`${SOURCE_APP}-two`, ['A']), listSpec(`${SOURCE_APP}-three`, ['A', 'B', 'C'])],
    }));
    expect(r).toMatchObject({ status: 'failed', reason: 'QUOTA_EXCEEDED', retryable: true });
    expect(r.details?.length).toBeGreaterThan(0);
    expect(r.details?.[0]).toMatchObject({ quotaScope: 'list_items', limit: 2, requested: 3, listKey: `${SOURCE_APP}-three` });
    await noSeedRows(org);
    const events = await allEvents(org.wire);
    expect(topicsOf(events)).toEqual([TOPICS.SELECTION_LISTS_SEED_FAILED]);
    validOutcomeEvents(events);
  });

  it('R10: org list quota — the request that does not fit writes nothing; seeded lists then count toward the quota', async () => {
    const org = newOrg();
    await projectOnly(org);
    await setOrgQuota(org.wire, 2, 500);
    const tooMany = resultOf(await seed(org, validToken(), {
      requestId: 'sl7:r10a',
      lists: [listSpec(`${SOURCE_APP}-a`, ['A']), listSpec(`${SOURCE_APP}-b`, ['A']), listSpec(`${SOURCE_APP}-c`, ['A'])],
    }));
    expect(tooMany).toMatchObject({ status: 'failed', reason: 'QUOTA_EXCEEDED' });
    expect(tooMany.details?.[0]).toMatchObject({ quotaScope: 'org_lists', limit: 2, requested: 3 });
    await noSeedRows(org);

    const fits = resultOf(await seed(org, validToken(), { requestId: 'sl7:r10b', lists: [listSpec(`${SOURCE_APP}-a`, ['A']), listSpec(`${SOURCE_APP}-b`, ['A'])] }));
    expect(fits.status).toBe('completed');
    // the org is now AT its ceiling: a human create over HTTP is refused (403 QUOTA_EXCEEDED)
    const user = newUser();
    const human = await rawFetch('/v1/selection-lists', {
      method: 'POST',
      token: mintTestToken({ userId: user.wire, organizationId: org.wire }),
      body: JSON.stringify({ key: 'human-list', name: 'Human' }),
    });
    expect(human.status).toBe(403);
    expect((human.body as { code: string }).code).toBe('QUOTA_EXCEEDED');
  });

  it('R11: a key taken by a user list -> KEY_CONFLICT (retryable); after the user renames theirs the retry succeeds', async () => {
    const org = newOrg();
    await projectOnly(org);
    const user = newUser();
    const tok = () => mintTestToken({ userId: user.wire, organizationId: org.wire });
    const mine = await rawFetch('/v1/selection-lists', { method: 'POST', token: tok(), body: JSON.stringify({ key: `${SOURCE_APP}-stages`, name: 'Mine' }) });
    expect(mine.status).toBe(201);
    const myId = (mine.body as { id: string }).id;

    const conflict = resultOf(await seed(org, validToken(), { requestId: 'sl7:r11' }));
    expect(conflict).toMatchObject({ status: 'failed', reason: 'KEY_CONFLICT', retryable: true });
    expect((await listRows(org.wire)).map((l) => l.id)).toEqual([myId]);
    expect(await ledgerRows(org.wire)).toEqual([]);

    const rename = await rawFetch(`/v1/selection-lists/${myId}`, { method: 'PATCH', token: tok(), body: JSON.stringify({ key: 'my-stages' }) });
    expect(rename.status).toBe(200);
    const retry = resultOf(await seed(org, validToken(), { requestId: 'sl7:r11' }));
    expect(retry).toMatchObject({ status: 'completed', outcome: 'applied' });
    expect((await listRows(org.wire)).map((l) => l.key).sort()).toEqual(['my-stages', `${SOURCE_APP}-stages`]);
    // the user's list was never touched by seeding
    expect((await listRows(org.wire)).find((l) => l.id === myId)).toMatchObject({ seed_source: null, created_by: user.wire });
  });

  it('R12: an unknown org -> ORG_UNKNOWN (retryable); after org.created arrives the retry succeeds', async () => {
    const org = newOrg();
    const first = resultOf(await seed(org, validToken(), { requestId: 'sl7:r12' }));
    expect(first).toMatchObject({ status: 'failed', reason: 'ORG_UNKNOWN', retryable: true });
    await noSeedRows(org);
    await projectOnly(org);
    const retry = resultOf(await seed(org, validToken(), { requestId: 'sl7:r12' }));
    expect(retry).toMatchObject({ status: 'completed', outcome: 'applied' });
  });

  it('an org the projection marks deleted/inactive -> ORG_INACTIVE (non-retryable)', async () => {
    const deleted = newOrg();
    await handleOrgDeleted(orgDeletedEnvelope(deleted) as never);
    expect(resultOf(await seed(deleted, validToken(), { requestId: 'sl7:inactive1' }))).toMatchObject({ status: 'failed', reason: 'ORG_INACTIVE', retryable: false });
    const inactive = newOrg();
    await projectOnly(inactive, { isActive: false });
    expect(resultOf(await seed(inactive, validToken(), { requestId: 'sl7:inactive2' }))).toMatchObject({ status: 'failed', reason: 'ORG_INACTIVE', retryable: false });
    await noSeedRows(deleted);
    await noSeedRows(inactive);
  });
});

describe('R13: schema-invalid messages are dead-lettered (token redacted) with a best-effort VALIDATION_ERROR', () => {
  it('a smuggled `id` on a list (strict schema) -> kind invalid, VALIDATION_ERROR recorded, DLQ copy has no token', async () => {
    const org = newOrg();
    await projectOnly(org);
    const token = validToken();
    const dlq = jest.fn().mockResolvedValue(undefined);
    const bad = seedPayload(org.wire, token, { requestId: 'sl7:r13', lists: [{ ...listSpec(`${SOURCE_APP}-x`, ['A']), id: 'front_sl_smuggled0000000000000000' }] });
    const out = (await handleSeedRequested(seedEnvelope(bad) as never, { isSeedingEnabled: FLAG_ON, deadLetter: dlq })) as { kind: string; failureRecorded: boolean };
    expect(out).toMatchObject({ kind: 'invalid', failureRecorded: true });
    await noSeedRows(org);
    const events = await allEvents(org.wire);
    expect(topicsOf(events)).toEqual([TOPICS.SELECTION_LISTS_SEED_FAILED]);
    expect(events[0].payload).toMatchObject({ reason: 'VALIDATION_ERROR', retryable: false, requestId: 'sl7:r13' });
    validOutcomeEvents(events);
    expect(dlq).toHaveBeenCalledTimes(1);
    const dead = JSON.stringify(dlq.mock.calls[0]);
    expect(dead).not.toContain(token);
    expect(dead).toContain('[REDACTED]');
    expect(dlq.mock.calls[0][0]).toBe(TOPICS.SELECTION_LISTS_SEED_REQUESTED);
    expect(JSON.stringify(events)).not.toContain(token);
  });

  it('an invalid message whose header is unreadable is dead-lettered only (no outcome event can be addressed)', async () => {
    const dlq = jest.fn().mockResolvedValue(undefined);
    const out = (await handleSeedRequested(seedEnvelope({ hello: 'world', attestation: { kind: 'service-token', token: 'not-a-real-token' } }) as never, { isSeedingEnabled: FLAG_ON, deadLetter: dlq })) as { kind: string; failureRecorded: boolean };
    expect(out).toMatchObject({ kind: 'invalid', failureRecorded: false });
    expect(JSON.stringify(dlq.mock.calls)).not.toContain('not-a-real-token');
  });
});

describe('the attestation token never leaves the verifier', () => {
  it('across every seeding path above, no token appears in any outbox row, DLQ copy, ledger row, or log line', async () => {
    const tokens = ALL_TOKENS();
    expect(tokens.length).toBeGreaterThan(10);
    const outbox = JSON.stringify(await dbQuery('SELECT payload, correlation_id FROM event_outbox'));
    const ledger = JSON.stringify(await dbQuery('SELECT * FROM selection_list_seed_ledger'));
    const audit = JSON.stringify(await dbQuery('SELECT * FROM selection_list_audit'));
    const logs = mockLogLines.join('\n');
    expect(logs.length).toBeGreaterThan(0); // the capture is live: the handlers did log
    expect(logs).toContain('selection-lists.seed.requested received');
    for (const t of tokens) {
      for (const [where, hay] of [['event_outbox', outbox], ['ledger', ledger], ['audit', audit], ['logs', logs]] as const) {
        if (hay.includes(t)) throw new Error(`token ${t.slice(0, 20)}... leaked into ${where}`);
      }
    }
    for (const call of deadLetter.mock.calls) {
      for (const t of tokens) expect(JSON.stringify(call)).not.toContain(t);
    }
  });
});

// =============================================================================================
// Ownership edge cases (§9 step 2, §9.1) and ordering/concurrency of seed vs HTTP writes
// =============================================================================================

describe('ownership edge cases on upgrade', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl7-edge-'));
  const mkList = (key: string, items: string[], name = `Name ${key}`) => ({ key, sourceLocale: 'en', name, items: items.map((c) => ({ code: c, label: `Label ${c}` })) });
  const v1 = { packKey: 'sl7-edge', version: 1, appliesTo: ['organization'], lists: [mkList('edge-archived', ['A']), mkList('edge-renamed', ['A']), mkList('edge-items', ['A', 'B', 'C'])] };
  const v2 = {
    packKey: 'sl7-edge',
    version: 2,
    appliesTo: ['organization'],
    lists: [mkList('edge-archived', ['A', 'Z'], 'edge-archived v2'), mkList('edge-renamed', ['A', 'Z'], 'edge-renamed v2'), mkList('edge-items', ['A', 'B', 'C', 'USERCODE'], 'edge-items v2')],
  };
  beforeAll(() => {
    fs.writeFileSync(path.join(dir, 'sl7-edge.v1.json'), JSON.stringify(v1));
  });

  async function setup() {
    const org = newOrg();
    const user = newUser();
    await projectOnly(org);
    await applyPlatformDefaults(db, org.wire, { packDir: dir });
    const lists = Object.fromEntries((await listRows(org.wire)).map((l) => [l.key, l]));
    for (const l of Object.values(lists) as Array<{ id: string }>) await supportGrantOwner(org.wire, user.wire, l.id);
    const tok = () => mintTestToken({ userId: user.wire, organizationId: org.wire });
    return { org, user, lists, tok };
  }
  const upgrade = async (orgWire: string) => {
    fs.writeFileSync(path.join(dir, 'sl7-edge.v2.json'), JSON.stringify(v2));
    const out = await applyPlatformDefaults(db, orgWire, { packDir: dir });
    fs.rmSync(path.join(dir, 'sl7-edge.v2.json'), { force: true });
    return out[0].result as { status: string; outcome?: string; reason?: string; lists?: Array<{ key: string; action: string }> };
  };

  it('a human archive of a seeded list counts as taking ownership: the upgrade leaves it archived and untouched', async () => {
    const { org, lists, tok } = await setup();
    const res = await rawFetch(`/v1/selection-lists/${lists['edge-archived'].id}/archive`, { method: 'POST', token: tok() });
    expect(res.status).toBe(200);
    const out = await upgrade(org.wire);
    expect(out).toMatchObject({ status: 'completed', outcome: 'upgraded' });
    expect(out.lists?.find((l) => l.key === 'edge-archived')?.action).toBe('skipped-user-edited');
    const now = (await listRows(org.wire)).find((l) => l.key === 'edge-archived');
    expect(now).toMatchObject({ status: 'archived', seed_version: 1 });
    expect((await itemRows(org.wire)).filter((i) => i.list_id === lists['edge-archived'].id).map((i) => i.code)).toEqual(['A']);
  });

  it('a human key rename is tracked by provenance, not key: the renamed list is left alone and no duplicate is created', async () => {
    const { org, lists, tok } = await setup();
    const res = await rawFetch(`/v1/selection-lists/${lists['edge-renamed'].id}`, { method: 'PATCH', token: tok(), body: JSON.stringify({ key: 'my-renamed' }) });
    expect(res.status).toBe(200);
    const out = await upgrade(org.wire);
    expect(out.status).toBe('completed');
    expect(out.lists?.find((l) => l.key === 'edge-renamed')?.action).toBe('skipped-user-edited');
    const keys = (await listRows(org.wire)).map((l) => l.key).sort();
    expect(keys).toContain('my-renamed');
    expect(keys).not.toContain('edge-renamed'); // not recreated under the old key
    expect(keys).toHaveLength(3);
  });

  it('an item a human added (same code the next pack version adds) does not wedge the upgrade or get overwritten', async () => {
    const { org, lists, tok } = await setup();
    const add = await rawFetch(`/v1/selection-lists/${lists['edge-items'].id}/items`, { method: 'POST', token: tok(), body: JSON.stringify({ code: 'USERCODE', label: 'Human owned' }) });
    expect(add.status).toBe(201);
    const out = await upgrade(org.wire);
    // A poison outcome (INTERNAL_ERROR) here would loop retries forever; the human's item must be
    // skipped (itemsSkipped), never overwritten and never a unique-violation fault.
    expect(out).toMatchObject({ status: 'completed', outcome: 'upgraded' });
    expect(out.reason).not.toBe('INTERNAL_ERROR');
    const edgeItems = (out.lists as unknown as Array<{ key: string; itemsSkipped: number; itemsCreated: number }>).find((l) => l.key === 'edge-items');
    expect(edgeItems).toMatchObject({ itemsSkipped: 1, itemsCreated: 0 });
    const mine = (await itemRows(org.wire)).find((i) => i.list_id === lists['edge-items'].id && i.code === 'USERCODE');
    expect(mine).toBeDefined();
    const view = await rawFetch(`/v1/selection-lists/${lists['edge-items'].id}/items?limit=50`, { method: 'GET', token: tok() });
    const label = (view.body as { items: Array<{ code: string; label: string }> }).items.find((i) => i.code === 'USERCODE')?.label;
    expect(label).toBe('Human owned');
  });

  it('a human item purge / item archive is respected: purged items are not recreated, archived items stay archived', async () => {
    const { org, lists, tok } = await setup();
    const items = (await itemRows(org.wire)).filter((i) => i.list_id === lists['edge-items'].id);
    const byCode = Object.fromEntries(items.map((i) => [i.code, i]));
    const L = lists['edge-items'].id;
    expect((await rawFetch(`/v1/selection-lists/${L}/items/${byCode['A'].id}?purge=true`, { method: 'DELETE', token: tok() })).status).toBeLessThan(300);
    expect((await rawFetch(`/v1/selection-lists/${L}/items/${byCode['B'].id}/archive`, { method: 'POST', token: tok() })).status).toBe(200);
    const out = await upgrade(org.wire);
    expect(out.status).toBe('completed');
    const now = Object.fromEntries((await itemRows(org.wire)).filter((i) => i.list_id === L).map((i) => [i.code, i]));
    expect(now['A']).toBeUndefined();
    expect(now['B']).toMatchObject({ status: 'archived' });
  });
});

describe('seeding keeps the per-list event contract and coexists with HTTP writes', () => {
  it('P3 across seeding: every seeded list\'s events carry strictly increasing listRevision in seq order', async () => {
    const org = newOrg();
    await handleOrgCreated(orgCreatedEnvelope(org) as never, { isSeedingEnabled: FLAG_ON });
    const events = await allEvents(org.wire);
    const byList = new Map<string, number[]>();
    for (const e of events) {
      const rev = e.payload['listRevision'];
      if (rev === undefined) continue;
      byList.set(e.payload['listId'], [...(byList.get(e.payload['listId']) ?? []), rev]);
    }
    expect(byList.size).toBe(3);
    for (const revs of byList.values()) {
      expect(revs[0]).toBe(1);
      for (let i = 1; i < revs.length; i++) expect(revs[i]).toBeGreaterThan(revs[i - 1]);
    }
  });

  it('the system principal is exempt from the per-creator list cap: two 15-list seeds (30 lists) both apply', async () => {
    await allowSource('sl7big', { prefixes: ['sl7big-'] });
    const org = newOrg();
    await projectOnly(org);
    const mk = (from: number) => Array.from({ length: 15 }, (_v, i) => listSpec(`sl7big-l${from + i}`, ['A']));
    const a = resultOf(await seed(org, validToken(), { requestId: 'sl7:cap1', source: { app: 'sl7big', service: SOURCE_SUBJECT }, pack: { key: 'sl7-big', version: 1 }, lists: mk(0) }));
    const b = resultOf(await seed(org, validToken(), { requestId: 'sl7:cap2', source: { app: 'sl7big', service: SOURCE_SUBJECT }, pack: { key: 'sl7-big-two', version: 1 }, lists: mk(100) }));
    expect(a).toMatchObject({ status: 'completed', outcome: 'applied' });
    expect(b).toMatchObject({ status: 'completed', outcome: 'applied' });
    expect(await listRows(org.wire)).toHaveLength(30);
  });

  it('a seed running concurrently with HTTP writes to the same org neither deadlocks nor loses/reorders events', async () => {
    const org = newOrg();
    await projectOnly(org);
    const user = newUser();
    const tok = () => mintTestToken({ userId: user.wire, organizationId: org.wire });
    const mine = await rawFetch('/v1/selection-lists', { method: 'POST', token: tok(), body: JSON.stringify({ key: 'concurrent-mine', name: 'Mine' }) });
    expect(mine.status).toBe(201);
    const myId = (mine.body as { id: string }).id;

    const httpWrites = Array.from({ length: 10 }, (_v, i) => rawFetch(`/v1/selection-lists/${myId}/items`, { method: 'POST', token: tok(), body: JSON.stringify({ code: `CC${i}`, label: `CC${i}` }) }));
    const seeds = [0, 1, 2].map((n) => seed(org, validToken(), { requestId: `sl7:conc${n}`, pack: { key: `sl7-conc-${n}`, version: 1 }, lists: [listSpec(`${SOURCE_APP}-conc-${n}`, ['A', 'B'])] }));
    const [writes, outcomes] = await Promise.all([Promise.all(httpWrites), Promise.all(seeds)]);
    for (const w of writes) expect(w.status).toBe(201);
    for (const o of outcomes) expect(resultOf(o)).toMatchObject({ status: 'completed', outcome: 'applied' });

    const events = await allEvents(org.wire);
    validOutcomeEvents(events);
    const perList = new Map<string, number[]>();
    for (const e of events) {
      const rev = e.payload['listRevision'];
      if (rev !== undefined) perList.set(e.payload['listId'], [...(perList.get(e.payload['listId']) ?? []), rev]);
    }
    expect(perList.size).toBe(4); // my list + 3 seeded
    for (const revs of perList.values()) {
      expect(new Set(revs).size).toBe(revs.length);
      for (let i = 1; i < revs.length; i++) expect(revs[i]).toBeGreaterThan(revs[i - 1]);
    }
    const seqs = events.map((e) => BigInt(e.seq));
    for (let i = 1; i < seqs.length; i++) expect(seqs[i] > seqs[i - 1]).toBe(true);
    expect(countTopic(events, TOPICS.SELECTION_LISTS_SEED_COMPLETED)).toBe(3);
  });
});

// =============================================================================================
// What a client sees of seeded rows over HTTP (openapi 4.0.0) + the [deleted-user] sentinel
// =============================================================================================

describe('seeded rows over HTTP (contract 4.0.0)', () => {
  it('a seeded list/item render the required `seed` object and the system created_by, and conform to the spec', async () => {
    const org = newOrg();
    await projectOnly(org);
    await seed(org, validToken(), { requestId: 'sl7:http1' });
    const list = (await listRows(org.wire))[0];
    const user = newUser();
    const tok = () => mintTestToken({ userId: user.wire, organizationId: org.wire });

    // a tenant ADMIN with no instance role cannot reach a seeded list (3.0.0: no admin -> owner derivation)
    const adminTok = mintTestToken({ userId: user.wire, organizationId: org.wire, roles: ['admin'] });
    expect((await rawFetch(`/v1/selection-lists/${list.id}`, { method: 'GET', token: adminTok })).status).toBe(404);
    const adminPage = await rawFetch('/v1/selection-lists?limit=100', { method: 'GET', token: adminTok });
    expect(adminPage.status).toBe(200);
    expect((adminPage.body as { items: unknown[] }).items).toEqual([]);

    // explicit support-path grant (permit-actions §5) opens it
    await supportGrantOwner(org.wire, user.wire, list.id);
    const got = await rawFetch(`/v1/selection-lists/${list.id}`, { method: 'GET', token: tok() });
    expect(got.status).toBe(200);
    assertResponse('GET', '/v1/selection-lists/{listId}', 200, got.body);
    expect(got.body).toMatchObject({ created_by: SYSTEM, seed: { source: SOURCE_APP, pack_key: 'sl7-pack', pack_version: 1, user_modified: false } });

    const items = await rawFetch(`/v1/selection-lists/${list.id}/items`, { method: 'GET', token: tok() });
    expect(items.status).toBe(200);
    assertResponse('GET', '/v1/selection-lists/{listId}/items', 200, items.body);
    for (const i of (items.body as { items: Array<{ created_by: string; seed: unknown }> }).items) {
      expect(i.created_by).toBe(SYSTEM);
      expect(i.seed).toMatchObject({ source: SOURCE_APP, pack_key: 'sl7-pack', pack_version: 1, user_modified: false });
    }

    const page = await rawFetch('/v1/selection-lists?limit=100', { method: 'GET', token: tok() });
    assertResponse('GET', '/v1/selection-lists', 200, page.body);
    expect((page.body as { items: Array<{ id: string }> }).items.map((l) => l.id)).toEqual([list.id]);

    // a human edit flips user_modified, in the HTTP response AND in the event snapshot
    const mark = (await allEvents(org.wire)).length;
    const edit = await rawFetch(`/v1/selection-lists/${list.id}`, { method: 'PATCH', token: tok(), body: JSON.stringify({ description: 'edited by a human' }) });
    expect(edit.status).toBe(200);
    assertResponse('PATCH', '/v1/selection-lists/{listId}', 200, edit.body);
    expect((edit.body as { seed: { user_modified: boolean } }).seed.user_modified).toBe(true);
    const delta = (await allEvents(org.wire)).slice(mark);
    expect(topicsOf(delta)).toEqual([TOPICS.SELECTION_LISTS_LIST_UPDATED]);
    expect(delta[0].payload['list']['seed']).toMatchObject({ userModified: true });
    expect(delta[0].payload['actor']).toEqual({ type: 'user', userId: user.wire });
  });

  it('seeding never grants access, and a seeded list cannot be created or re-seeded over HTTP (`seed` is read-only)', async () => {
    const org = newOrg();
    const user = newUser();
    const tok = mintTestToken({ userId: user.wire, organizationId: org.wire });
    for (const body of [{ key: 'inj-seed-a', name: 'x', seed: { source: 'platform', pack_key: 'x', pack_version: 1, user_modified: false } }, { key: 'inj-seed-b', name: 'x', created_by: SYSTEM }]) {
      const res = await rawFetch('/v1/selection-lists', { method: 'POST', token: tok, body: JSON.stringify(body) });
      expect(res.status).toBe(400);
    }
  });

  it('after identity.user.deleted the author renders as the [deleted-user] sentinel and the response still conforms', async () => {
    const org = newOrg();
    const author = newUser();
    const peer = newUser();
    const tok = () => mintTestToken({ userId: author.wire, organizationId: org.wire });
    const peerTok = () => mintTestToken({ userId: peer.wire, organizationId: org.wire });
    const created = await rawFetch('/v1/selection-lists', { method: 'POST', token: tok(), body: JSON.stringify({ key: `sl7-del-${nonce()}`, name: 'Authored' }) });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    const item = await rawFetch(`/v1/selection-lists/${id}/items`, { method: 'POST', token: tok(), body: JSON.stringify({ code: 'X', label: 'X' }) });
    expect(item.status).toBe(201);
    // the author hands a second user ownership (so the list is NOT left ownerless by the author's deletion)
    const grant = await rawFetch(`/v1/selection-lists/${id}/access/${peer.wire}`, { method: 'PUT', token: tok(), body: JSON.stringify({ role: 'list-owner' }) });
    expect(grant.status).toBe(200);

    // The deletion also revokes the deleted user's own list grants (review M-2), which needs the service's
    // machine identity; this in-process handler gets the same seam the unit suites use.
    _setGrantTokenProviderForTesting({ getToken: async () => 'machine-token-authz-admin' });
    try {
      await handleUserDeleted(userDeletedEnvelope(author) as never);
    } finally {
      _setGrantTokenProviderForTesting(null);
    }

    const list = await rawFetch(`/v1/selection-lists/${id}`, { method: 'GET', token: peerTok() });
    expect(list.status).toBe(200);
    assertResponse('GET', '/v1/selection-lists/{listId}', 200, list.body);
    expect((list.body as { created_by: string }).created_by).toBe('[deleted-user]');
    const items = await rawFetch(`/v1/selection-lists/${id}/items`, { method: 'GET', token: peerTok() });
    assertResponse('GET', '/v1/selection-lists/{listId}/items', 200, items.body);
    expect((items.body as { items: Array<{ created_by: string }> }).items[0].created_by).toBe('[deleted-user]');
    const access = await rawFetch(`/v1/selection-lists/${id}/access`, { method: 'GET', token: peerTok() });
    assertResponse('GET', '/v1/selection-lists/{listId}/access', 200, access.body);
    // the deleted user's OWN grant is gone from the roster; the grant they handed out stays, now authored by the sentinel
    const roster = (access.body as { items: Array<{ user_id: string; granted_by: string }> }).items;
    expect(roster.map((g) => g.user_id)).toEqual([peer.wire]);
    expect(roster[0].granted_by).toBe('[deleted-user]');
    // anonymisation and the grant removal emit no list.updated (§4: no consumer-visible list field changes)
    expect(countTopic(await allEvents(org.wire), TOPICS.SELECTION_LISTS_LIST_UPDATED)).toBe(0);
  });
});
