// seed.consumers.db.test.ts - the two seeding consumers end to end:
//   identity.org.created              -> org projection + platform defaults (plan 7.1)
//   selection-lists.seed.requested    -> attested app seeding (plan 7.2, 8)
// plus the org-deleted tombstone that makes a late seed refuse with ORG_INACTIVE.
//
// REAL pieces: Postgres + the real migrations, the real TypedConsumer (fake KafkaJS client so
// there is no broker), the real handlers, the real seed library and outbox, and the REAL
// `@fuzefront/service-auth` verifier talking to a fake introspection endpoint (so inactive /
// missing-scope / outage are decided by the production code path, not by a stub verdict).
// Flags are pinned through the service's flag client seam. Maps to the plan's test plan
// S1-S6, R1-R8, R12, R13 (and the Kafka-edge half of R6).

import type { Knex } from 'knex';
import { fromUuid } from '@izzywdev/fuzefront-identity';
import { createMachineTokenVerifier } from '@fuzefront/service-auth';
import { createTestDb, dbDescribe, TestDb } from './helpers/testDb';
import { allowSource, countBy, eventsAfter, FUZECRM_SUBJECT, maxSeq, spec } from './helpers/seedFixtures';

// ---- shared state the mocked modules read ---------------------------------------------------
const state: { db: Knex | undefined } = { db: undefined };
jest.mock('../src/db', () => ({
  get db() {
    return state.db;
  },
}));

// Capture EVERYTHING the service logs (debug and up) so we can prove the token never reaches a log.
const mockLogLines: string[] = [];
jest.mock('../src/lib/logger', () => {
  const actual = jest.requireActual('../src/lib/logger');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Writable: W } = require('stream');
  const dest = new W({
    write(chunk: Buffer, _enc: string, cb: () => void) {
      mockLogLines.push(chunk.toString());
      cb();
    },
  });
  return { ...actual, logger: actual.createLogger('debug', dest) };
});

type EachMessage = (m: { topic: string; message: { value: Buffer | null } }) => Promise<void>;
const runners: Record<string, EachMessage> = {};
const dlqSend = jest.fn().mockResolvedValue(undefined);
function fakeKafka() {
  return {
    consumer: () => {
      let topic = '';
      return {
        connect: jest.fn().mockResolvedValue(undefined),
        subscribe: jest.fn(async (s: { topic: string }) => {
          topic = s.topic;
        }),
        run: jest.fn(async ({ eachMessage }: { eachMessage: EachMessage }) => {
          runners[topic] = eachMessage;
        }),
        disconnect: jest.fn().mockResolvedValue(undefined),
      };
    },
    producer: () => ({ connect: jest.fn().mockResolvedValue(undefined), send: dlqSend, disconnect: jest.fn().mockResolvedValue(undefined) }),
  };
}
jest.mock('@fuzefront/shared/kafka', () => {
  const actual = jest.requireActual('@fuzefront/shared/kafka');
  return { ...actual, createKafkaClient: () => fakeKafka() };
});

import { startLifecycleConsumers } from '../src/events/consumer';
import { handleOrgCreated } from '../src/events/org-created.handler';
import { handleSeedRequested } from '../src/events/seed-requested.handler';
import { RetryBudget } from '../src/events/retryBudget';
import { _setAttestationVerifierForTesting } from '../src/events/attestation';
import { FLAGS, setFlagClient } from '../src/flags';

// ---- fixtures -------------------------------------------------------------------------------
let n = 40;
const nextUuid = () => `0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7e${String(++n).padStart(2, '0')}`;

const flagState = { service: true, seed: true };
setFlagClient({
  getBooleanValue: async (key: string) => (key === FLAGS.SELECTION_LISTS_SERVICE ? flagState.service : key === FLAGS.SELECTION_LISTS_SEED_DEFAULTS ? flagState.seed : false),
});

const NOW_S = () => Math.floor(Date.now() / 1000);
/** A fake FuzeFront introspection endpoint keyed by token (what the real verifier talks to). */
const TOKENS: Record<string, Record<string, unknown> | 'outage' | 'http500'> = {
  'tok-valid-AAAA1111': { active: true, subject: FUZECRM_SUBJECT, scope: 'selection-lists:seed', expiresAt: NOW_S() + 300 },
  'tok-inactive-BBBB2222': { active: false },
  'tok-wrongscope-CCCC3333': { active: true, subject: FUZECRM_SUBJECT, scope: 'authz:admin', expiresAt: NOW_S() + 300 },
  'tok-othersubject-DDDD4444': { active: true, subject: 'some-other-service', scope: 'selection-lists:seed', expiresAt: NOW_S() + 300 },
  'tok-stale-EEEE5555': { active: true, subject: FUZECRM_SUBJECT, scope: 'selection-lists:seed', expiresAt: NOW_S() - 5 },
  'tok-outage-FFFF6666': 'outage',
  'tok-http500-GGGG7777': 'http500',
};
const introspections: string[] = [];
const fakeFetch = async (_url: string, init?: { body?: string }) => {
  const token = JSON.parse(init?.body ?? '{}').token as string;
  introspections.push(token);
  const entry = TOKENS[token] ?? { active: false };
  if (entry === 'outage') throw new Error('connect ECONNREFUSED fuzefront-security:3002');
  if (entry === 'http500') return { ok: false, status: 500, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => entry };
};

const VALID = 'tok-valid-AAAA1111';
const ALL_TOKENS = Object.keys(TOKENS);

const orgCreatedEnvelope = (uuid: string, over: Record<string, unknown> = {}, correlationId = 'corr-org') => ({
  version: '1.0',
  topic: 'identity.org.created',
  correlationId,
  occurredAt: '2026-10-04T00:00:00.000Z',
  payload: { organizationId: uuid, slug: `org-${uuid.slice(-4)}`, name: 'Acme', type: 'organization', parentId: null, ownerId: null, isActive: true, ...over },
});
const orgDeletedEnvelope = (uuid: string, cascade: 'soft' | 'hard' = 'soft') => ({
  version: '1.0',
  topic: 'identity.org.deleted',
  correlationId: 'corr-del',
  occurredAt: '2026-10-04T00:00:00.000Z',
  payload: { organizationId: uuid, slug: 'acme', ownerId: null, cascade },
});
const seedPayload = (org: string, over: Record<string, unknown> = {}) => ({
  requestId: 'fuzecrm:req-1',
  organizationId: org,
  scope: 'org',
  source: { app: 'fuzecrm', service: 'fuzecrm-service' },
  pack: { key: 'crm-defaults', version: 1 },
  trigger: 'app-installed',
  attestation: { kind: 'service-token', token: VALID },
  lists: [spec('fuzecrm-stages', ['LEAD', 'WON'])],
  ...over,
});
const seedEnvelope = (payload: unknown, correlationId = 'corr-seed') => ({
  version: '1.0',
  topic: 'selection-lists.seed.requested',
  correlationId,
  occurredAt: '2026-10-04T00:00:00.000Z',
  payload,
});
const msg = (v: unknown) => ({ message: { value: Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)) } });

dbDescribe('seeding consumers (real Postgres, real TypedConsumer, real token verifier)', () => {
  let t: TestDb;
  let db: Knex;

  const deliver = (topic: string, v: unknown) => runners[topic]({ topic, ...msg(v) });
  const orgCreated = (uuid: string, over: Record<string, unknown> = {}, correlationId?: string) => deliver('identity.org.created', orgCreatedEnvelope(uuid, over, correlationId));
  const orgDeleted = (uuid: string, cascade: 'soft' | 'hard' = 'soft') => deliver('identity.org.deleted', orgDeletedEnvelope(uuid, cascade));
  const seedRequested = (payload: unknown) => deliver('selection-lists.seed.requested', seedEnvelope(payload));

  const wire = (uuid: string) => fromUuid('organization', uuid);
  const lists = async (org: string) => db('selection_lists').where({ organization_id: org }).orderBy('key');
  const itemCount = async (org: string) => Number((await db('selection_list_items as i').join('selection_lists as l', 'l.id', 'i.list_id').where('l.organization_id', org).count('i.id as c').first())!.c);
  const ledgerRows = async (org: string) => db('selection_list_seed_ledger').where({ organization_id: org });
  const projection = async (uuid: string) => db('selection_list_ref_index').where({ entity_type: 'organization', entity_id: uuid }).first();
  const lastFailed = async (after: string) => (await eventsAfter(db, after)).filter((e) => e.topic === 'selection-lists.seed.failed').pop()?.payload;
  const lastCompleted = async (after: string) => (await eventsAfter(db, after)).filter((e) => e.topic === 'selection-lists.seed.completed').pop()?.payload;
  const nothingWritten = async (org: string) => {
    expect(await lists(org)).toEqual([]);
    expect(await ledgerRows(org)).toEqual([]);
  };

  /** A project the org without seeding it (flag OFF), then flip the flags ON: the app-seed precondition. */
  const projectedOrg = async (over: Record<string, unknown> = {}) => {
    const uuid = nextUuid();
    flagState.seed = false;
    await orgCreated(uuid, over);
    flagState.seed = true;
    return { uuid, org: wire(uuid) };
  };

  beforeAll(async () => {
    t = await createTestDb();
    db = t.db;
    state.db = db;
    await allowSource(db, 'fuzecrm');
    _setAttestationVerifierForTesting(createMachineTokenVerifier({ baseUrl: 'http://security.test', fetch: fakeFetch as never, cacheTtlSeconds: 0 }));
    await startLifecycleConsumers();
  });
  afterAll(async () => {
    _setAttestationVerifierForTesting(null);
    setFlagClient(null);
    await t.drop();
  });
  beforeEach(() => {
    flagState.service = true;
    flagState.seed = true;
    dlqSend.mockClear();
    introspections.length = 0;
    mockLogLines.length = 0;
  });

  // -----------------------------------------------------------------------------------------
  describe('identity.org.created -> platform defaults', () => {
    it('S1 seeds the platform defaults once: projection, 3 lists, 10 items, ledger row, seed.completed(applied) with trigger org-created', async () => {
      const uuid = nextUuid();
      const org = wire(uuid);
      const before = await maxSeq(db);
      await orgCreated(uuid, {}, 'corr-s1');

      expect(await projection(uuid)).toMatchObject({ status: 'active', wire_id: org, org_type: 'organization', is_active: true });
      expect((await lists(org)).map((l) => l.key)).toEqual(['priority', 'work-status', 'yes-no']);
      expect(await itemCount(org)).toBe(10);
      expect(await ledgerRows(org)).toHaveLength(1);
      const done = await lastCompleted(before);
      expect(done).toMatchObject({ outcome: 'applied', trigger: 'org-created', requestId: null, source: { app: 'platform' } });
      expect(done!.organizationId).toBe(org);
      // The envelope's correlationId threads through to the outcome event.
      const row = await db('event_outbox').where({ topic: 'selection-lists.seed.completed' }).orderBy('seq', 'desc').first();
      expect(row.correlation_id).toBe('corr-s1');
    });

    it('S2 redelivery of the same org.created is a no-op: already-applied, no new rows, no duplicate list/item events', async () => {
      const uuid = nextUuid();
      const org = wire(uuid);
      await orgCreated(uuid);
      const afterFirst = await maxSeq(db);
      const listsBefore = (await lists(org)).map((l) => l.id);
      const itemsBefore = await itemCount(org);

      await orgCreated(uuid);
      await orgCreated(uuid);

      expect((await lists(org)).map((l) => l.id)).toEqual(listsBefore);
      expect(await itemCount(org)).toBe(itemsBefore);
      expect(await ledgerRows(org)).toHaveLength(1);
      const events = await eventsAfter(db, afterFirst);
      expect(countBy(events, 'selection-lists.list.created')).toBe(0);
      expect(countBy(events, 'selection-lists.item.created')).toBe(0);
      expect(events.filter((e) => e.topic === 'selection-lists.seed.completed').map((e) => e.payload.outcome)).toEqual(['already-applied', 'already-applied']);
    });

    it('S5 flag OFF: the org is still projected, nothing is seeded (no ledger, no events), and it is logged; flag ON + redelivery seeds it', async () => {
      const uuid = nextUuid();
      const org = wire(uuid);
      const before = await maxSeq(db);
      flagState.seed = false;
      await orgCreated(uuid);

      expect(await projection(uuid)).toMatchObject({ status: 'active', org_type: 'organization', is_active: true });
      await nothingWritten(org);
      expect(await eventsAfter(db, before)).toEqual([]);
      expect(mockLogLines.join('')).toContain('seeding flag is OFF');

      // The master gate counts too: seed flag ON but the service gate OFF is still OFF.
      flagState.seed = true;
      flagState.service = false;
      await orgCreated(uuid);
      await nothingWritten(org);

      flagState.service = true;
      await orgCreated(uuid);
      expect(await lists(org)).toHaveLength(3);
    });

    it('S3 isActive:false is projected but never seeded (no ledger row, no events); the flag is not even consulted', async () => {
      const uuid = nextUuid();
      const org = wire(uuid);
      const before = await maxSeq(db);
      await orgCreated(uuid, { isActive: false });
      expect(await projection(uuid)).toMatchObject({ status: 'active', is_active: false });
      await nothingWritten(org);
      expect(await eventsAfter(db, before)).toEqual([]);
    });

    it('S4 appliesTo: a platform org is not seeded (silent, no events); a personal org is (the pack opts in)', async () => {
      const platformUuid = nextUuid();
      const before = await maxSeq(db);
      await orgCreated(platformUuid, { type: 'platform' });
      expect(await projection(platformUuid)).toMatchObject({ org_type: 'platform' });
      await nothingWritten(wire(platformUuid));
      expect(await eventsAfter(db, before)).toEqual([]);

      const personalUuid = nextUuid();
      await orgCreated(personalUuid, { type: 'personal' });
      expect(await projection(personalUuid)).toMatchObject({ org_type: 'personal' });
      expect(await lists(wire(personalUuid))).toHaveLength(3);
    });

    it('S6 delete-before-create: the tombstone wins - no lists, seed.failed ORG_INACTIVE (not retryable), the projection stays deleted', async () => {
      const uuid = nextUuid();
      const org = wire(uuid);
      await orgDeleted(uuid, 'hard');
      expect(await projection(uuid)).toMatchObject({ status: 'deleted', wire_id: org });

      const before = await maxSeq(db);
      await orgCreated(uuid);
      await nothingWritten(org);
      expect(await lastFailed(before)).toMatchObject({ reason: 'ORG_INACTIVE', retryable: false, organizationId: org, trigger: 'org-created' });
      expect(await projection(uuid)).toMatchObject({ status: 'deleted', org_type: 'organization' });
    });

    it('org.created then org.deleted(soft) then seed.requested: the projection is tombstoned and the app seed is refused ORG_INACTIVE (nothing written)', async () => {
      const uuid = nextUuid();
      const org = wire(uuid);
      await orgCreated(uuid);
      const seeded = (await lists(org)).length;
      expect(seeded).toBe(3);

      await orgDeleted(uuid, 'soft');
      expect(await projection(uuid)).toMatchObject({ status: 'deleted' });
      expect((await lists(org)).every((l) => l.status === 'archived')).toBe(true);

      const before = await maxSeq(db);
      await seedRequested(seedPayload(org));
      expect(await lastFailed(before)).toMatchObject({ reason: 'ORG_INACTIVE', requestId: 'fuzecrm:req-1' });
      expect(await lists(org)).toHaveLength(seeded); // no fuzecrm list appeared
      // ... and a redelivered org.created does not resurrect it.
      await orgCreated(uuid);
      expect(await projection(uuid)).toMatchObject({ status: 'deleted' });
    });

    it('a transient database fault THROWS (the consumer retries) and the retry seeds exactly once - no duplicates', async () => {
      const uuid = nextUuid();
      const org = wire(uuid);
      let failures = 1;
      const flaky = new Proxy(db, {
        apply: (target, thisArg, args) => Reflect.apply(target as never, thisArg, args),
        get: (target, prop) => {
          if (prop === 'transaction') {
            return (...a: unknown[]) => {
              if (failures > 0) {
                failures--;
                return Promise.reject(Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' }));
              }
              return (target as any).transaction(...a);
            };
          }
          const v = (target as any)[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      }) as unknown as Knex;
      const ev = orgCreatedEnvelope(uuid) as any;

      await expect(handleOrgCreated(ev, { db: flaky, budget: new RetryBudget(5) })).rejects.toThrow('Connection terminated');
      await nothingWritten(org); // projection written, nothing seeded, NO seed.failed recorded
      expect(await projection(uuid)).toMatchObject({ status: 'active' });

      const retry = await handleOrgCreated(ev, { db: flaky, budget: new RetryBudget(5) });
      expect(retry).toMatchObject({ seeding: 'attempted' });
      expect(await lists(org)).toHaveLength(3);
      expect(await ledgerRows(org)).toHaveLength(1);
    });

    it('a fault that never heals does not wedge the partition: the last attempt records seed.failed INTERNAL_ERROR (retryable) and returns', async () => {
      const uuid = nextUuid();
      const org = wire(uuid);
      let failures = 2; // apply attempt 1 (throws), attempt 2 = last: apply fails again, then the failure is recorded
      const flaky = new Proxy(db, {
        apply: (target, thisArg, args) => Reflect.apply(target as never, thisArg, args),
        get: (target, prop) => {
          if (prop === 'transaction') {
            return (...a: unknown[]) => {
              if (failures > 0) {
                failures--;
                return Promise.reject(Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' }));
              }
              return (target as any).transaction(...a);
            };
          }
          const v = (target as any)[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      }) as unknown as Knex;
      const ev = orgCreatedEnvelope(uuid) as any;
      const budget = new RetryBudget(2);
      const before = await maxSeq(db);

      await expect(handleOrgCreated(ev, { db: flaky, budget })).rejects.toThrow('Connection terminated');
      await expect(handleOrgCreated(ev, { db: flaky, budget })).resolves.toMatchObject({ seeding: 'attempted' });
      await nothingWritten(org);
      expect(await lastFailed(before)).toMatchObject({ reason: 'INTERNAL_ERROR', retryable: true });
      expect(budget.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('selection-lists.seed.requested -> app seeding', () => {
    it('R1 valid attestation: applied; rows carry provenance and created_by system; the token is in no event, no log, no DLQ', async () => {
      const { org } = await projectedOrg();
      const before = await maxSeq(db);
      await seedRequested(seedPayload(org));

      const done = await lastCompleted(before);
      expect(done).toMatchObject({ outcome: 'applied', requestId: 'fuzecrm:req-1', trigger: 'app-installed', source: { app: 'fuzecrm' } });
      const rows = await lists(org);
      expect(rows.map((l) => l.key)).toEqual(['fuzecrm-stages']);
      expect(rows[0]).toMatchObject({ created_by: 'system:selection-list-service', seed_source: 'fuzecrm', seed_key: 'crm-defaults', seed_version: 1, seed_user_modified: false });
      expect(introspections).toEqual([VALID]);

      const outbox = JSON.stringify(await db('event_outbox').select('*'));
      for (const tok of ALL_TOKENS) {
        expect(outbox).not.toContain(tok);
        expect(mockLogLines.join('')).not.toContain(tok);
      }
      expect(mockLogLines.join('')).toContain('seed request processed');
      expect(dlqSend).not.toHaveBeenCalled();
    });

    it('R2 redelivery (same requestId, same content) is already-applied with the identical per-list result; no duplicate rows', async () => {
      const { org } = await projectedOrg();
      const b1 = await maxSeq(db);
      await seedRequested(seedPayload(org));
      const first = await lastCompleted(b1);
      const ids = (await lists(org)).map((l) => l.id);

      const b2 = await maxSeq(db);
      await seedRequested(seedPayload(org));
      const second = await lastCompleted(b2);
      expect(second).toMatchObject({ outcome: 'already-applied' });
      expect(second!.lists).toEqual(first!.lists);
      expect((await lists(org)).map((l) => l.id)).toEqual(ids);
      expect(countBy(await eventsAfter(db, b2), 'selection-lists.list.created')).toBe(0);
    });

    describe('R6 attestation: nothing is written, ATTESTATION_INVALID (retryable), and the token never appears', () => {
      it.each([
        ['an inactive/unknown/revoked token', 'tok-inactive-BBBB2222'],
        ['an expired token (introspection still says active, but exp is in the past)', 'tok-stale-EEEE5555'],
        ['a token without the selection-lists:seed scope', 'tok-wrongscope-CCCC3333'],
        ['a token the endpoint has never heard of', 'tok-never-issued-HHHH8888'],
      ])('%s', async (_label, token) => {
        const { org } = await projectedOrg();
        const before = await maxSeq(db);
        await seedRequested(seedPayload(org, { attestation: { kind: 'service-token', token } }));

        await nothingWritten(org);
        const failed = await lastFailed(before);
        expect(failed).toMatchObject({ reason: 'ATTESTATION_INVALID', retryable: true, requestId: 'fuzecrm:req-1' });
        expect(JSON.stringify(failed)).not.toContain(token);
        expect(mockLogLines.join('')).not.toContain(token);
        expect(await eventsAfter(db, before)).toHaveLength(1); // exactly the failure, no list/item events
      });

      it('wrong subject: a valid seed-scoped token whose subject is not bound to the source is refused SOURCE_NOT_ALLOWED (the allowlist row decides)', async () => {
        const { org } = await projectedOrg();
        const before = await maxSeq(db);
        await seedRequested(seedPayload(org, { attestation: { kind: 'service-token', token: 'tok-othersubject-DDDD4444' } }));
        await nothingWritten(org);
        const failed = await lastFailed(before);
        expect(failed).toMatchObject({ reason: 'SOURCE_NOT_ALLOWED', retryable: false });
        expect(JSON.stringify(failed)).not.toContain('tok-othersubject');
      });
    });

    it('R6 introspection outage: the handler THROWS (fail closed, retried), nothing written, no failure event; the retry then succeeds exactly once', async () => {
      const { org } = await projectedOrg();
      const before = await maxSeq(db);
      const ev = seedEnvelope(seedPayload(org, { attestation: { kind: 'service-token', token: 'tok-outage-FFFF6666' } })) as any;
      for (const outage of ['tok-outage-FFFF6666', 'tok-http500-GGGG7777']) {
        ev.payload.attestation.token = outage;
        await expect(handleSeedRequested(ev, { budget: new RetryBudget(5) })).rejects.toThrow(/attestation could not be verified/);
        // the error text never carries the token
        await nothingWritten(org);
      }
      expect(await eventsAfter(db, before)).toEqual([]);
      expect(mockLogLines.join('')).not.toContain('tok-outage');
      expect(mockLogLines.join('')).not.toContain('tok-http500');

      ev.payload.attestation.token = VALID;
      await expect(handleSeedRequested(ev, { budget: new RetryBudget(5) })).resolves.toMatchObject({ kind: 'result', result: { status: 'completed' } });
      expect(await lists(org)).toHaveLength(1);
    });

    it('R6 a persistent introspection outage exhausts the retry budget and records INTERNAL_ERROR (retryable) instead of wedging the partition', async () => {
      const { org } = await projectedOrg();
      const before = await maxSeq(db);
      const ev = seedEnvelope(seedPayload(org, { attestation: { kind: 'service-token', token: 'tok-outage-FFFF6666' } })) as any;
      const budget = new RetryBudget(2);
      await expect(handleSeedRequested(ev, { budget })).rejects.toThrow();
      const res = await handleSeedRequested(ev, { budget });
      expect(res).toMatchObject({ kind: 'result', result: { status: 'failed', reason: 'INTERNAL_ERROR', retryable: true } });
      await nothingWritten(org);
      expect(await lastFailed(before)).toMatchObject({ reason: 'INTERNAL_ERROR' });
    });

    it('R7 a source that is not on the allowlist (or is disabled) is refused SOURCE_NOT_ALLOWED even with a valid token', async () => {
      const { org } = await projectedOrg();
      const before = await maxSeq(db);
      await seedRequested(seedPayload(org, { source: { app: 'fuzeghost', service: 'ghost-service' }, lists: [spec('fuzeghost-x', ['A'])] }));
      expect(await lastFailed(before)).toMatchObject({ reason: 'SOURCE_NOT_ALLOWED', retryable: false });
      await nothingWritten(org);

      await allowSource(db, 'fuzeoff', { enabled: false });
      const b2 = await maxSeq(db);
      await seedRequested(seedPayload(org, { source: { app: 'fuzeoff', service: 'off-service' }, lists: [spec('fuzeoff-x', ['A'])] }));
      expect(await lastFailed(b2)).toMatchObject({ reason: 'SOURCE_NOT_ALLOWED' });
      await nothingWritten(org);
    });

    it('R8 limits and namespace: over the per-source cap -> LIMIT_EXCEEDED, key outside the prefix -> NAMESPACE_VIOLATION; nothing written', async () => {
      await allowSource(db, 'fuzecap', { maxLists: 1, subjects: [FUZECRM_SUBJECT] });
      const { org } = await projectedOrg();
      const before = await maxSeq(db);
      await seedRequested(
        seedPayload(org, { source: { app: 'fuzecap', service: 'cap-service' }, lists: [spec('fuzecap-a', ['A']), spec('fuzecap-b', ['B'])] }),
      );
      expect(await lastFailed(before)).toMatchObject({ reason: 'LIMIT_EXCEEDED', retryable: false });

      const b2 = await maxSeq(db);
      await seedRequested(seedPayload(org, { lists: [spec('somebody-elses-list', ['A'])] }));
      expect(await lastFailed(b2)).toMatchObject({ reason: 'NAMESPACE_VIOLATION' });
      await nothingWritten(org);
    });

    it('seeding disabled for the org: SEEDING_DISABLED (retryable) is recorded and the token is not even introspected', async () => {
      const { org } = await projectedOrg();
      flagState.seed = false;
      const before = await maxSeq(db);
      await seedRequested(seedPayload(org));
      expect(await lastFailed(before)).toMatchObject({ reason: 'SEEDING_DISABLED', retryable: true });
      expect(introspections).toEqual([]);
      await nothingWritten(org);

      // Master gate OFF is equally OFF.
      flagState.seed = true;
      flagState.service = false;
      const b2 = await maxSeq(db);
      await seedRequested(seedPayload(org, { requestId: 'fuzecrm:req-2' }));
      expect(await lastFailed(b2)).toMatchObject({ reason: 'SEEDING_DISABLED', requestId: 'fuzecrm:req-2' });
      await nothingWritten(org);

      // Flag back ON: a re-send works.
      flagState.service = true;
      await seedRequested(seedPayload(org, { requestId: 'fuzecrm:req-3' }));
      expect(await lists(org)).toHaveLength(1);
    });

    it('R5 scope "user" -> SCOPE_UNSUPPORTED (not retryable), before any token is introspected', async () => {
      const { org } = await projectedOrg();
      const before = await maxSeq(db);
      await seedRequested(seedPayload(org, { scope: 'user', userId: fromUuid('user', '0195a8f2-aaaa-7a11-8b2d-3f4e5a6b7c8d') }));
      expect(await lastFailed(before)).toMatchObject({ reason: 'SCOPE_UNSUPPORTED', retryable: false, scope: 'user' });
      expect(introspections).toEqual([]);
      await nothingWritten(org);
    });

    it('R12 unknown org -> ORG_UNKNOWN (retryable); once org.created is consumed, the same request succeeds', async () => {
      const uuid = nextUuid();
      const org = wire(uuid);
      const before = await maxSeq(db);
      await seedRequested(seedPayload(org));
      expect(await lastFailed(before)).toMatchObject({ reason: 'ORG_UNKNOWN', retryable: true });
      await nothingWritten(org);

      flagState.seed = false;
      await orgCreated(uuid);
      flagState.seed = true;
      await seedRequested(seedPayload(org));
      expect(await lists(org)).toHaveLength(1);
    });

    it('a transient database fault inside applySeedRequest is retried (handler throws) and the retry applies exactly once', async () => {
      const { org } = await projectedOrg();
      let failures = 1;
      const flaky = new Proxy(db, {
        apply: (target, thisArg, args) => Reflect.apply(target as never, thisArg, args),
        get: (target, prop) => {
          if (prop === 'transaction') {
            return (...a: unknown[]) => {
              if (failures > 0) {
                failures--;
                return Promise.reject(Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' }));
              }
              return (target as any).transaction(...a);
            };
          }
          const v = (target as any)[prop];
          return typeof v === 'function' ? v.bind(target) : v;
        },
      }) as unknown as Knex;
      const ev = seedEnvelope(seedPayload(org)) as any;
      const before = await maxSeq(db);

      await expect(handleSeedRequested(ev, { db: flaky, budget: new RetryBudget(5) })).rejects.toThrow('Connection terminated');
      await nothingWritten(org);
      expect(await eventsAfter(db, before)).toEqual([]); // no INTERNAL_ERROR noise while retries remain

      await expect(handleSeedRequested(ev, { db: flaky, budget: new RetryBudget(5) })).resolves.toMatchObject({ result: { status: 'completed', outcome: 'applied' } });
      expect(await lists(org)).toHaveLength(1);
      expect(await ledgerRows(org)).toHaveLength(1);
    });

    describe('R13 bad input', () => {
      it('non-JSON is dead-lettered by the TypedConsumer; the handler never runs', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const before = await maxSeq(db);
        await deliver('selection-lists.seed.requested', '{not json');
        expect(dlqSend).toHaveBeenCalledTimes(1);
        expect(dlqSend.mock.calls[0][0].topic).toBe('selection-lists.seed.requested.dlq');
        expect(await eventsAfter(db, before)).toEqual([]);
        expect(introspections).toEqual([]);
      });

      it('valid JSON that fails the schema, with a readable header: best-effort seed.failed VALIDATION_ERROR AND a DLQ copy with the token redacted', async () => {
        const { org } = await projectedOrg();
        const before = await maxSeq(db);
        // a smuggled id (strict schema) + an unknown field
        const bad = seedPayload(org, { lists: [{ ...spec('fuzecrm-stages', ['LEAD']), id: 'front_sl_smuggled' }], extra: 1 });
        await seedRequested(bad);

        const failed = await lastFailed(before);
        expect(failed).toMatchObject({ reason: 'VALIDATION_ERROR', retryable: false, requestId: 'fuzecrm:req-1', organizationId: org });
        expect(failed!.details.length).toBeGreaterThan(0);
        expect(JSON.stringify(failed)).not.toContain(VALID);
        await nothingWritten(org);
        expect(introspections).toEqual([]); // never authenticated, never applied

        expect(dlqSend).toHaveBeenCalledTimes(1);
        const sent = dlqSend.mock.calls[0][0];
        expect(sent.topic).toBe('selection-lists.seed.requested.dlq');
        const dlqBody = JSON.parse(sent.messages[0].value);
        expect(dlqBody.sourceTopic).toBe('selection-lists.seed.requested');
        expect(sent.messages[0].value).not.toContain(VALID);
        expect(JSON.parse(dlqBody.raw).payload.attestation.token).toBe('[REDACTED]');
        expect(mockLogLines.join('')).not.toContain(VALID);
      });

      it('valid JSON that fails the schema with NO usable header: DLQ only, no outcome event', async () => {
        const before = await maxSeq(db);
        await seedRequested({ hello: 'world', attestation: { kind: 'service-token', token: VALID } });
        expect(await eventsAfter(db, before)).toEqual([]);
        expect(dlqSend).toHaveBeenCalledTimes(1);
        expect(dlqSend.mock.calls[0][0].messages[0].value).not.toContain(VALID);
      });

      it('an org id that is not a TypeID is not echoed into an event (header unreadable): DLQ only', async () => {
        const before = await maxSeq(db);
        await seedRequested(seedPayload('not-an-org'));
        expect(await eventsAfter(db, before)).toEqual([]);
        expect(dlqSend).toHaveBeenCalledTimes(1);
      });
    });
  });

  // -----------------------------------------------------------------------------------------
  describe('bootstrap', () => {
    it('both seeding consumers run in their own consumer groups, started unconditionally (the flag is per message)', async () => {
      expect(Object.keys(runners).sort()).toEqual(['identity.org.created', 'identity.org.deleted', 'identity.user.deleted', 'selection-lists.seed.requested']);
    });
  });
});
