/**
 * The platform organization's lifecycle (SL9, service 1.1.x): SUSPENSION of its writes, and the rejection of FUTURE-DATED
 * org lifecycle envelopes. Written against the frozen contract (openapi.yaml 4.1.0: a `platform` list is "owned by the
 * platform organization"; `publish_platform` "only effective in the platform organization's tenant"; the Error envelope),
 * the design record (docs/planning/selection-lists-shared-and-fork.md §8, "Platform organization lifecycle") and the
 * rollout runbook (docs/runbooks/selection-lists-rollout.md §10.3), NOT against the handlers' internals. Needs the
 * shared-lists flag ON (helpers/shared-lists.ts).
 *
 * Behaviour pinned (and why):
 *   A. SUSPENSION. Because the platform org owns every common list, a DEACTIVATION of it (identity.org.updated /
 *      identity.org.created with isActive:false, identity.org.deleted of EITHER cascade) is split in two: WRITES fail closed
 *      (publish_platform, promotion, every mutation of a `platform` list / its items / translations / grants, purge)
 *      with 403 while READS stay available to every tenant (list, items, listing, key lookup, resolve, fork) and NOTHING is
 *      deleted, archived or tombstoned; a legitimate reactivation (isActive:true, type platform) RESUMES writes. A refused
 *      write leaves no trace (no row, no outbox event). The platform org's own non-platform lists are not platform writes.
 *      Ordering is by the envelope's original time: a deactivation older than the newest applied snapshot is ignored, a
 *      tie goes to active, an activation older than the suspending deactivation cannot resume. A retype of the platform org
 *      away from `platform` is refused (no suspension, no state change). The operator recovery SQL of the runbook works.
 *   B. FLAG-INDEPENDENT. With the shared-lists flag OFF (rollback / fail-safe) a suspended platform org still refuses
 *      every mutation of a `platform` row it owns (403 `platform_suspended`), its other lists keep their 4.0.0 behaviour,
 *      reads work, and a reactivation resumes.
 *   C. FUTURE-DATED envelopes. An org lifecycle envelope dated more than the skew tolerance (SELECTION_LIST_EVENT_FUTURE_SKEW_SECONDS,
 *      default 300 s) ahead of the service's clock is REJECTED (acknowledged, warn naming its correlationId, nothing applied):
 *      no suspension, no resume, no projection change, no tombstone, no cascade - for the platform org and for ordinary orgs,
 *      on all three topics. Inside the tolerance an event applies normally. A clamp to "now" would re-order the same event on
 *      every redelivery, so rejection is the contract.
 *
 * HOW THE HARNESS RUNS THIS. Suspending the shared platform org would break every parallel suite's writes, so it has its OWN
 * platform org (SUSPENDABLE_PLATFORM_ORG_ID) and two dedicated service instances on the same database that differ only in
 * the shared-lists flag: SHARED_LISTS_SUSPENSION_URLS="on=<url>,off=<url>" (.github/workflows/ci.yml: 3016 / 3017). Events
 * reach the service the way the seeding suite delivers them (helpers/org-events.ts: the compiled handlers against the same
 * Postgres); the instances read the resulting suspension fresh per request. A missing instance fails the suite with an
 * explicit PRECONDITION message (never a skip).
 */
import {
  actor, addItem, assertSharedListsOn, call, createList, expectError, forkList, L, newOrg, permitPublishAnywhere, rnd,
  walkItems, walkLists, type Actor, type ListLike, type Res,
} from '../helpers/shared-lists';
import { SUSPENDABLE_PLATFORM_ORG_ID } from '../helpers/sl9-constants';
import { closeDb, dbQuery } from '../helpers/db';
import { canonicalUuid } from '../helpers/ids';
import { allEvents } from '../helpers/outbox';
import { closeEventDb, deliverOrgCreated, deliverOrgDeleted, deliverOrgUpdated } from '../helpers/org-events';

// ---- capture what the service code logs (the runbook tells operators to grep these lines) ----
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
const logged = (needle: string, message: string): boolean => mockLogLines.some((l) => l.includes(needle) && l.includes(message));

const SUSP = SUSPENDABLE_PLATFORM_ORG_ID;
const SUSP_UUID = canonicalUuid(SUSP);

const instances = new Map(
  (process.env['SHARED_LISTS_SUSPENSION_URLS'] ?? '')
    .split(',')
    .map((kv) => kv.trim())
    .filter(Boolean)
    .map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)] as const),
);
const ON = instances.get('on') as string; // shared-lists flag ON, SELECTION_LIST_PLATFORM_ORG_ID = SUSP
const OFF = instances.get('off') as string; // shared-lists flag OFF

// ---- the clock of the events: explicit, strictly ordered, all in the past (the future-dated section names its own) ----
const BASE = Date.now() - 40 * 60_000;
let ticks = 0;
const at = (n: number, ms = 0): string => new Date(BASE + n * 1000 + ms).toISOString();
/** A fresh instant strictly newer than every previous `next()` (10 s apart, leaving room for in-between instants). */
const next = (): number => (ticks += 10);
let corr = 0;
const cid = (label: string): string => `susp-${label}-${++corr}-${rnd()}`;

const operator: Actor = actor('susp-op', SUSP, 'admin'); // acts IN the platform org
const reader: Actor = actor('susp-rd', newOrg('susprd'), 'viewer'); // another tenant
const forker: Actor = actor('susp-fk', newOrg('suspfk'), 'editor'); // another tenant that holds `create`

let common: ListLike; // the common list every suspension case attacks
let commonItemId: string;
let platformPrivate: ListLike; // the platform org's OWN non-platform list

const retryUntil = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 20_000): Promise<T> => {
  const t0 = Date.now();
  let last = await fn();
  while (!ok(last) && Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 400));
    last = await fn();
  }
  return last;
};

const projection = async () =>
  (await dbQuery(`SELECT status, org_type, is_active, suspended_at, suspended_event_at, snapshot_at, org_name FROM selection_list_ref_index WHERE entity_type = 'organization' AND entity_id = $1`, [SUSP_UUID]))[0];
const isSuspended = async (): Promise<boolean> => Boolean((await projection())?.suspended_at);

beforeAll(async () => {
  const missing = (['on', 'off'] as const).filter((k) => !instances.get(k));
  if (missing.length > 0) {
    throw new Error(
      `PRECONDITION: no suspension instance configured for [${missing.join(', ')}]. Set SHARED_LISTS_SUSPENSION_URLS="on=<url>,off=<url>" ` +
        `(two service instances on the same database whose SELECTION_LIST_PLATFORM_ORG_ID is ${SUSP}; "off" without the shared-lists flag) - see this file's header and .github/workflows/ci.yml.`,
    );
  }
  // the protection of the platform org is keyed by the configuration the service instances run with; the handlers run here
  process.env['SELECTION_LIST_PLATFORM_ORG_ID'] = SUSP;
  delete process.env['SELECTION_LIST_EVENT_FUTURE_SKEW_SECONDS']; // the default (300 s) is what section C pins
  await assertSharedListsOn(ON);
  await permitPublishAnywhere(SUSP); // the stand-in says yes; only the SERVICE can say no

  // A rerun against a used database must start from a clean projection row: its newest instants would otherwise out-rank ours.
  await dbQuery(`DELETE FROM selection_list_ref_index WHERE entity_type = 'organization' AND entity_id = $1`, [SUSP_UUID]);
  // The platform org becomes real the way production makes it real: identity.org.created, type platform, active.
  await deliverOrgCreated(SUSP, at(0), cid('confirm'), { type: 'platform', name: 'Suspendable platform' });
  expect(await projection()).toMatchObject({ org_type: 'platform', is_active: true, status: 'active', suspended_at: null });

  // The instance learns it within its (bounded) cache window; the FIRST common list doubles as the control that writes work.
  const published = await retryUntil(
    () => call(operator, 'POST', '/v1/selection-lists', { key: `susp-${rnd()}-${rnd()}`, name: 'Common under test', visibility: 'platform' }, ON),
    (r) => r.status === 201,
  );
  if (published.status !== 201) throw new Error(`fixture: the platform operator could not publish on the suspension instance: ${published.status} ${JSON.stringify(published.body)}`);
  common = published.body as ListLike;
  expect(common).toMatchObject({ visibility: 'platform', organization_id: SUSP });
  commonItemId = (await addItem(operator, common.id, 'ONE', 'One', ON)).id;
  await addItem(operator, common.id, 'TWO', 'Two', ON);
  platformPrivate = await createList(operator, { name: 'The platform org\'s own private list' }, ON);
}, 60_000);

afterAll(async () => {
  // leave the shared database un-suspended for anybody who reruns against it
  await dbQuery(`UPDATE selection_list_ref_index SET suspended_at = NULL, suspended_event_at = NULL WHERE entity_type = 'organization' AND entity_id = $1`, [SUSP_UUID]);
  await closeEventDb();
  await closeDb();
});

// ---------------------------------------------------------------------------------------------------------------------
// what "suspended" means, observed over HTTP
// ---------------------------------------------------------------------------------------------------------------------

interface Attempt {
  name: string;
  /** published only with the shared-lists flag ON (a 4.0.0 instance has no `visibility: platform`) */
  needsFlag?: boolean;
  /** purge answers a bare 403 (its own guard); everything else carries `reason: platform_suspended` */
  noReason?: boolean;
  run: (url: string) => Promise<Res>;
}

const ATTEMPTS: Attempt[] = [
  { name: 'publish a new common list (publish_platform)', needsFlag: true, noReason: true, run: (u) => call(operator, 'POST', '/v1/selection-lists', { key: `nope-${rnd()}-${rnd()}`, name: 'No', visibility: 'platform' }, u) },
  { name: 'promote the org\'s own list to platform', needsFlag: true, noReason: true, run: (u) => call(operator, 'PATCH', L(platformPrivate.id), { visibility: 'platform' }, u) },
  { name: 'PATCH a common list', run: (u) => call(operator, 'PATCH', L(common.id), { description: 'changed while suspended' }, u) },
  { name: 'archive a common list (DELETE)', run: (u) => call(operator, 'DELETE', L(common.id), undefined, u) },
  { name: 'purge a common list (DELETE ?purge=true)', noReason: true, run: (u) => call(operator, 'DELETE', `${L(common.id)}?purge=true`, undefined, u) },
  { name: 'add an item to a common list', run: (u) => call(operator, 'POST', `${L(common.id)}/items`, { code: 'NEW', label: 'New' }, u) },
  { name: 'PATCH an item of a common list', run: (u) => call(operator, 'PATCH', `${L(common.id)}/items/${commonItemId}`, { label: 'Changed' }, u) },
  { name: 'purge an item of a common list', noReason: true, run: (u) => call(operator, 'DELETE', `${L(common.id)}/items/${commonItemId}?purge=true`, undefined, u) },
  { name: 'translate a common list', run: (u) => call(operator, 'PUT', `${L(common.id)}/translations/fr`, { name: 'Non' }, u) },
  { name: 'grant access on a common list', run: (u) => call(operator, 'PUT', `${L(common.id)}/access/${actor('susp-tg', SUSP, 'viewer').userId}`, { role: 'list-viewer' }, u) },
];

/** The observable state of the common list and of the platform org's event stream: a refused write must not move it. */
const state = async (url: string) => ({
  list: (await call(operator, 'GET', L(common.id), undefined, url)).body,
  items: (await walkItems(operator, common.id, 'all', url)).map((i) => [i.id, i.code, i.status, i.label]),
  translations: (await dbQuery(`SELECT locale FROM selection_list_translations WHERE list_id = $1 ORDER BY locale`, [common.id])).map((r) => r['locale']),
  outbox: (await allEvents(SUSP)).length,
});

/** Every write the platform org could make on a platform row is refused; flag-dependent ones only on the flag-ON instance. */
async function expectWritesRefused(url: string, flagOn: boolean): Promise<void> {
  const before = await state(url);
  for (const a of ATTEMPTS.filter((x) => flagOn || !x.needsFlag)) {
    const res = await a.run(url);
    expect({ attempt: a.name, status: res.status, code: res.body?.code }).toEqual({ attempt: a.name, status: 403, code: 'FORBIDDEN' });
    if (!a.noReason) expect({ attempt: a.name, reason: res.body?.reason }).toEqual({ attempt: a.name, reason: 'platform_suspended' });
  }
  expect(await state(url)).toEqual(before); // refused means: no row, no translation, no event, nothing changed
}

/** Reads, resolve, key lookup and the tenants' own writes (fork) are untouched by the suspension. */
async function expectReadsServed(): Promise<void> {
  const got = await call(reader, 'GET', L(common.id), undefined, ON);
  expect(got.status).toBe(200);
  expect(got.body).toMatchObject({ id: common.id, visibility: 'platform', organization_id: SUSP, status: 'active' });
  expect((await walkItems(reader, common.id, 'active', ON)).length).toBe(2);
  expect((await walkLists(reader, 'include_shared=true', 50, ON)).rows.map((r) => r.id)).toContain(common.id);
  const byKey = await call(reader, 'GET', `/v1/selection-lists?key=${encodeURIComponent(common.key)}&include_shared=true`, undefined, ON);
  expect(byKey.body.items.map((r: ListLike) => r.id)).toEqual([common.id]);
  const resolved = await call(reader, 'POST', '/v1/resolve', { ids: [commonItemId] }, ON);
  expect(Object.keys(resolved.body.results)).toEqual([commonItemId]);
  expect(resolved.body.missing).toEqual([]);
  expect((await call(operator, 'GET', L(common.id), undefined, ON)).status).toBe(200); // the owner reads its own list
  // a tenant's own change of a common list is still the usual "fork it", not a suspension answer
  const tenantEdit = await call(forker, 'PATCH', L(common.id), { description: 'x' }, ON); // holds `create`, so it may fork
  expectError(tenantEdit, 409, 'CONFLICT', 'fork_required');
  // and forking (a write into the TENANT's own org) still works - idempotently, whichever case ran first
  expect([200, 201]).toContain((await forkList(forker, common.id, undefined, ON)).status);
  // the platform org's own NON-platform list is not a platform write
  expect((await call(operator, 'PATCH', L(platformPrivate.id), { description: `fine ${rnd()}` }, ON)).status).toBe(200);
}

/** Writes are open: the same PATCH / publish that is refused while suspended succeeds. */
async function expectWritesOpen(url: string, flagOn: boolean): Promise<void> {
  const patched = await call(operator, 'PATCH', L(common.id), { description: `open ${rnd()}` }, url);
  expect({ status: patched.status, body: patched.status === 200 ? undefined : patched.body }).toEqual({ status: 200, body: undefined });
  if (flagOn) {
    const pub = await call(operator, 'POST', '/v1/selection-lists', { key: `open-${rnd()}-${rnd()}`, name: 'Published again', visibility: 'platform' }, url);
    expect({ status: pub.status, body: pub.status === 201 ? undefined : pub.body }).toEqual({ status: 201, body: undefined });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// A. suspension, shared-lists flag ON
// ---------------------------------------------------------------------------------------------------------------------

describe('A. a deactivation of the platform org SUSPENDS its writes (flags ON); reads stay available; a reactivation resumes', () => {
  const PATHS: Array<[string, (t: string, id: string) => Promise<unknown>]> = [
    ['identity.org.updated { isActive:false }', (t, id) => deliverOrgUpdated(SUSP, t, id, { type: 'platform', isActive: false })],
    ['identity.org.created { isActive:false }', (t, id) => deliverOrgCreated(SUSP, t, id, { type: 'platform', isActive: false })],
    ['identity.org.deleted (soft cascade)', (t, id) => deliverOrgDeleted(SUSP, t, id, 'soft')],
    ['identity.org.deleted (hard cascade)', (t, id) => deliverOrgDeleted(SUSP, t, id, 'hard')],
  ];

  it.each(PATHS)('%s: writes refused (403), reads / resolve / fork served, nothing deleted; reactivation resumes writes', async (_name, deactivate) => {
    await expectWritesOpen(ON, true); // control: before the event, the very same writes go through
    await expectReadsServed(); // warms every cache the suspension must not be masked by
    const dead = cid('deactivate');
    await deactivate(at(next()), dead);

    expect(await isSuspended()).toBe(true);
    expect(await projection()).toMatchObject({ status: 'active', is_active: true, org_type: 'platform' }); // never a tombstone, never retyped
    expect(logged(dead, 'platform WRITES are SUSPENDED')).toBe(true); // what the runbook tells operators to grep
    await expectWritesRefused(ON, true);
    await expectReadsServed();
    expect((await call(reader, 'GET', L(common.id), undefined, ON)).body.status).toBe('active'); // not archived by a soft cascade
    expect((await walkItems(reader, common.id, 'all', ON)).length).toBe(2); // not purged by a hard one

    const alive = cid('reactivate');
    await deliverOrgUpdated(SUSP, at(next()), alive, { type: 'platform', isActive: true });
    expect(await isSuspended()).toBe(false);
    expect(logged(alive, 'platform writes RESUMED')).toBe(true);
    await expectWritesOpen(ON, true);
  });

  it('the suspension is a fresh read, never a cached answer: a write that succeeded a moment ago is refused the very next request, and resumes the same way', async () => {
    expect((await call(operator, 'PATCH', L(common.id), { description: `warm ${rnd()}` }, ON)).status).toBe(200);
    await deliverOrgDeleted(SUSP, at(next()), cid('fresh'), 'soft');
    expectError(await call(operator, 'PATCH', L(common.id), { description: 'now' }, ON), 403, 'FORBIDDEN', 'platform_suspended');
    await deliverOrgCreated(SUSP, at(next()), cid('fresh-resume'), { type: 'platform', isActive: true });
    expect((await call(operator, 'PATCH', L(common.id), { description: `after ${rnd()}` }, ON)).status).toBe(200);
  });

  it('a repeated deactivation changes nothing further, and a repeated activation resumes once', async () => {
    const t1 = at(next());
    await deliverOrgUpdated(SUSP, t1, cid('dup-1'), { type: 'platform', isActive: false });
    const first = (await projection()).suspended_at;
    await deliverOrgUpdated(SUSP, t1, cid('dup-2'), { type: 'platform', isActive: false }); // redelivery
    expect(new Date((await projection()).suspended_at).getTime()).toBe(new Date(first).getTime());
    expectError(await call(operator, 'PATCH', L(common.id), { description: 'x' }, ON), 403, 'FORBIDDEN', 'platform_suspended');
    const t2 = at(next());
    await deliverOrgUpdated(SUSP, t2, cid('dup-3'), { type: 'platform', isActive: true });
    await deliverOrgUpdated(SUSP, t2, cid('dup-4'), { type: 'platform', isActive: true }); // redelivery
    expect(await isSuspended()).toBe(false);
    expect((await call(operator, 'PATCH', L(common.id), { description: `ok ${rnd()}` }, ON)).status).toBe(200);
  });

  describe('ordering: the state machine follows the envelope\'s ORIGINAL time (the lifecycle topics have separate consumer groups)', () => {
    it('a STALE deactivation (older than the newest applied snapshot) does not suspend; the warn names its correlationId', async () => {
      const newest = next();
      await deliverOrgUpdated(SUSP, at(newest), cid('ord-newest'), { type: 'platform' });
      for (const [label, deliver] of [
        ['created-inactive', (t: string, c: string) => deliverOrgCreated(SUSP, t, c, { type: 'platform', isActive: false })],
        ['updated-inactive', (t: string, c: string) => deliverOrgUpdated(SUSP, t, c, { type: 'platform', isActive: false })],
        ['deleted-soft', (t: string, c: string) => deliverOrgDeleted(SUSP, t, c, 'soft')],
        ['deleted-hard', (t: string, c: string) => deliverOrgDeleted(SUSP, t, c, 'hard')],
      ] as const) {
        const stale = cid(`stale-${label}`);
        await deliver(at(newest - 5), stale);
        expect({ label, suspended: await isSuspended() }).toEqual({ label, suspended: false });
        expect({ label, warned: logged(stale, 'STALE deactivation') }).toEqual({ label, warned: true });
      }
      expect((await call(operator, 'PATCH', L(common.id), { description: `stale ${rnd()}` }, ON)).status).toBe(200);
    });

    it('a TIE (deactivation at the exact instant of the newest applied snapshot) goes to ACTIVE: not suspended', async () => {
      const t = next();
      await deliverOrgUpdated(SUSP, at(t), cid('tie-active'), { type: 'platform' });
      const tie = cid('tie-deactivate');
      await deliverOrgDeleted(SUSP, at(t), tie, 'soft');
      expect(await isSuspended()).toBe(false);
      expect(logged(tie, 'SAME instant')).toBe(true);
      expect((await call(operator, 'PATCH', L(common.id), { description: `tie ${rnd()}` }, ON)).status).toBe(200);
    });

    it('an activation OLDER than the suspending deactivation cannot resume it; a newer one (or a tie) does', async () => {
      const snap = next();
      await deliverOrgUpdated(SUSP, at(snap), cid('res-snap'), { type: 'platform' });
      const dead = next();
      await deliverOrgDeleted(SUSP, at(dead), cid('res-dead'), 'soft');
      expect(await isSuspended()).toBe(true);
      await deliverOrgUpdated(SUSP, at(snap, 500), cid('res-older'), { type: 'platform' }); // newer than the snapshot, older than the deactivation
      expect(await isSuspended()).toBe(true);
      expectError(await call(operator, 'PATCH', L(common.id), { description: 'x' }, ON), 403, 'FORBIDDEN', 'platform_suspended');
      await deliverOrgCreated(SUSP, at(dead), cid('res-tie'), { type: 'platform' }); // the activation wins a tie
      expect(await isSuspended()).toBe(false);
      expect((await call(operator, 'PATCH', L(common.id), { description: `res ${rnd()}` }, ON)).status).toBe(200);
    });

    it('REPLAY of an old deactivation after the resume is stale and ignored', async () => {
      const dead = next();
      await deliverOrgDeleted(SUSP, at(dead), cid('replay-dead'), 'soft');
      expect(await isSuspended()).toBe(true);
      await deliverOrgUpdated(SUSP, at(next()), cid('replay-resume'), { type: 'platform' });
      expect(await isSuspended()).toBe(false);
      await deliverOrgDeleted(SUSP, at(dead), cid('replay-again'), 'soft'); // the same, old, event again
      expect(await isSuspended()).toBe(false);
      expect((await call(operator, 'PATCH', L(common.id), { description: `replay ${rnd()}` }, ON)).status).toBe(200);
    });
  });

  it('a snapshot that RETYPES the platform org away from `platform` is refused outright: no suspension, no state change, common lists fully available', async () => {
    const before = await projection();
    const refused = cid('retype');
    await deliverOrgUpdated(SUSP, at(next()), refused, { type: 'organization', name: 'Forged retype' });
    await deliverOrgCreated(SUSP, at(next()), cid('retype-created'), { type: 'personal' });
    const after = await projection();
    expect({ type: after.org_type, active: after.is_active, status: after.status, name: after.org_name, suspended: Boolean(after.suspended_at) }).toEqual({
      type: before.org_type, active: before.is_active, status: before.status, name: before.org_name, suspended: false,
    });
    expect(logged(refused, 'REFUSED')).toBe(true);
    await expectReadsServed();
    await expectWritesOpen(ON, true);
  });

  it('a rename of the platform org (same type, still active) applies and suspends nothing', async () => {
    await deliverOrgUpdated(SUSP, at(next()), cid('rename'), { type: 'platform', name: 'Renamed platform' });
    expect((await projection()).org_name).toBe('Renamed platform');
    expect(await isSuspended()).toBe(false);
    await expectWritesOpen(ON, true);
  });

  it('the runbook\'s operator recovery SQL clears a (mistaken) suspension: writes resume without any event', async () => {
    await deliverOrgDeleted(SUSP, at(next()), cid('mistaken'), 'soft');
    expectError(await call(operator, 'PATCH', L(common.id), { description: 'x' }, ON), 403, 'FORBIDDEN', 'platform_suspended');
    // docs/runbooks/selection-lists-rollout.md §10.3, verbatim apart from the id
    await dbQuery(`UPDATE selection_list_ref_index SET suspended_at = NULL, updated_at = now() WHERE wire_id = $1 AND suspended_at IS NOT NULL`, [SUSP]);
    await expectWritesOpen(ON, true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// B. the gate is flag-independent
// ---------------------------------------------------------------------------------------------------------------------

describe('B. with the shared-lists flag OFF the suspension gate still holds (4.0.0 rows keep 4.0.0 behaviour)', () => {
  beforeAll(async () => {
    // the common list was published while the flag was ON; the OFF instance (same database) serves it as a 4.0.0 row
    await deliverOrgUpdated(SUSP, at(next()), cid('b-resume'), { type: 'platform', isActive: true });
    const probe = await call(operator, 'POST', '/v1/selection-lists', { key: `probe-${rnd()}`, name: 'flag probe', visibility: 'org' }, OFF);
    if (probe.status === 201) throw new Error(`PRECONDITION: the instance at ${OFF} accepted visibility:"org" - the shared-lists flag is ON there, but this section needs it OFF.`);
  });

  it('every mutation of a platform row the suspended org owns is 403 (list, archive, purge, items, translations, access); a read is a read', async () => {
    const dead = cid('b-dead');
    await deliverOrgUpdated(SUSP, at(next()), dead, { type: 'platform', isActive: false });
    expect(await isSuspended()).toBe(true);
    expect((await call(operator, 'GET', L(common.id), undefined, OFF)).status).toBe(200);
    expect((await walkItems(operator, common.id, 'active', OFF)).length).toBe(2);
    await expectWritesRefused(OFF, false);
    // the platform org's NON-platform list: 4.0.0 behaviour, unchanged
    expect((await call(operator, 'PATCH', L(platformPrivate.id), { description: `off-fine ${rnd()}` }, OFF)).status).toBe(200);
    expect((await createFreshPrivate(OFF)).status).toBe(201);
  });

  it('a reactivation resumes the same writes on the flag-OFF instance', async () => {
    await deliverOrgUpdated(SUSP, at(next()), cid('b-alive'), { type: 'platform', isActive: true });
    expect(await isSuspended()).toBe(false);
    await expectWritesOpen(OFF, false);
  });

  const createFreshPrivate = (url: string) => call(operator, 'POST', '/v1/selection-lists', { key: `off-${rnd()}-${rnd()}`, name: 'Private, flag OFF' }, url);
});

// ---------------------------------------------------------------------------------------------------------------------
// C. future-dated envelopes
// ---------------------------------------------------------------------------------------------------------------------

describe('C. an org lifecycle envelope dated beyond the skew tolerance is REJECTED: nothing is applied', () => {
  const ahead = (seconds: number): string => new Date(Date.now() + seconds * 1000).toISOString();
  const FAR = '2099-01-01T00:00:00.000Z';

  beforeAll(async () => {
    delete process.env['SELECTION_LIST_EVENT_FUTURE_SKEW_SECONDS'];
    await deliverOrgUpdated(SUSP, at(next()), cid('c-reset'), { type: 'platform', isActive: true }); // a known, un-suspended starting point
    expect(await isSuspended()).toBe(false);
  });

  it('PLATFORM org, all three topics: a far-future deactivation suspends nothing and moves no projection state; the warn names the correlationId', async () => {
    const before = await projection();
    for (const [label, deliver] of [
      ['updated', (t: string, c: string) => deliverOrgUpdated(SUSP, t, c, { type: 'platform', isActive: false })],
      ['created', (t: string, c: string) => deliverOrgCreated(SUSP, t, c, { type: 'platform', isActive: false })],
      ['deleted-soft', (t: string, c: string) => deliverOrgDeleted(SUSP, t, c, 'soft')],
      ['deleted-hard', (t: string, c: string) => deliverOrgDeleted(SUSP, t, c, 'hard')],
    ] as const) {
      for (const when of [FAR, ahead(3600)]) {
        const id = cid(`far-${label}`);
        await deliver(when, id);
        expect({ label, when, logged: logged(id, 'REJECTED a future-dated') }).toEqual({ label, when, logged: true });
      }
    }
    expect(await isSuspended()).toBe(false);
    const after = await projection();
    expect({ ...after }).toEqual({ ...before }); // not even snapshot_at / updated state moved
    await expectWritesOpen(ON, true);
    await expectReadsServed();
  });

  it('PLATFORM org: a far-future ACTIVATION cannot resume a genuine suspension, nor pin the snapshot clock ahead', async () => {
    await deliverOrgDeleted(SUSP, at(next()), cid('c-genuine'), 'soft');
    expect(await isSuspended()).toBe(true);
    const snapshotBefore = new Date((await projection()).snapshot_at).getTime();
    await deliverOrgUpdated(SUSP, FAR, cid('c-forged-resume'), { type: 'platform', isActive: true, name: 'Forged' });
    await deliverOrgCreated(SUSP, ahead(3600), cid('c-forged-created'), { type: 'platform', isActive: true, name: 'Forged' });
    expect(await isSuspended()).toBe(true);
    expectError(await call(operator, 'PATCH', L(common.id), { description: 'x' }, ON), 403, 'FORBIDDEN', 'platform_suspended');
    const mid = await projection();
    expect(mid.org_name).not.toBe('Forged');
    expect(new Date(mid.snapshot_at).getTime()).toBe(snapshotBefore);
    // the clocks were not pinned ahead: a legitimate activation (now-ish) still resumes
    await deliverOrgUpdated(SUSP, at(next()), cid('c-legit'), { type: 'platform', isActive: true, name: 'Legit' });
    expect(await isSuspended()).toBe(false);
    expect((await projection()).org_name).toBe('Legit');
    await expectWritesOpen(ON, true);
  });

  describe('an ORDINARY org: created / updated / deleted dated in the far future change nothing', () => {
    it('org.created: acknowledged as rejected, no projection row appears', async () => {
      const org = newOrg('fdcreated');
      const id = cid('fd-created');
      expect(await deliverOrgCreated(org, FAR, id, { name: 'Forged' })).toEqual({ projected: false, seeding: 'rejected-future-dated' });
      expect(await orgRow(org)).toBeUndefined();
      expect(logged(id, 'REJECTED a future-dated')).toBe(true);
      // control: the same event dated now projects
      await deliverOrgCreated(org, new Date().toISOString(), cid('fd-created-ok'), { name: 'Real' });
      expect(await orgRow(org)).toMatchObject({ org_name: 'Real', is_active: true, status: 'active' });
    });

    it('org.updated: a deactivation / retype / rename is ignored; the projection row is byte-for-byte the same', async () => {
      const org = newOrg('fdupdated');
      await deliverOrgCreated(org, at(1), cid('fd-u-0'), { name: 'Acme' });
      const before = await orgRow(org);
      expect(before).toMatchObject({ org_name: 'Acme', is_active: true, org_type: 'organization' });
      const id = cid('fd-updated');
      await deliverOrgUpdated(org, FAR, id, { type: 'personal', isActive: false, name: 'Forged' });
      expect(await orgRow(org)).toEqual(before);
      expect(logged(id, 'REJECTED a future-dated')).toBe(true);
      // control: dated now it applies
      await deliverOrgUpdated(org, new Date().toISOString(), cid('fd-u-ok'), { isActive: false, name: 'Acme 2' });
      expect(await orgRow(org)).toMatchObject({ org_name: 'Acme 2', is_active: false });
    });

    it('org.deleted (hard): the org\'s lists survive and stay readable, the projection is not tombstoned; the same event dated now purges', async () => {
      const org = newOrg('fddeleted');
      const admin = actor('fd-adm', org, 'admin');
      const list = await createList(admin, { name: 'Must survive a forged delete' });
      await addItem(admin, list.id);
      await deliverOrgCreated(org, at(1), cid('fd-d-0'), { name: 'Doomed' });
      const id = cid('fd-deleted');
      await deliverOrgDeleted(org, FAR, id, 'hard');
      expect(logged(id, 'REJECTED a future-dated')).toBe(true);
      const kept = await call(admin, 'GET', L(list.id));
      expect(kept.status).toBe(200);
      expect(kept.body.status).toBe('active');
      expect((await walkItems(admin, list.id, 'active')).length).toBe(1);
      expect((await orgRow(org))?.status).toBe('active'); // no tombstone
      // control: a genuine (now-dated) delete cascades
      await deliverOrgDeleted(org, new Date().toISOString(), cid('fd-d-ok'), 'hard');
      expectError(await call(admin, 'GET', L(list.id)), 404, 'NOT_FOUND');
      expect((await orgRow(org))?.status).toBe('deleted');
    });

    it('org.deleted (soft): not archived by a forged envelope; archived by a genuine one', async () => {
      const org = newOrg('fdsoft');
      const admin = actor('fd-sadm', org, 'admin');
      const list = await createList(admin, { name: 'Must not be archived' });
      await deliverOrgDeleted(org, ahead(3600), cid('fd-soft'), 'soft');
      expect((await call(admin, 'GET', L(list.id))).body.status).toBe('active');
      await deliverOrgDeleted(org, new Date().toISOString(), cid('fd-soft-ok'), 'soft');
      expect((await call(admin, 'GET', L(list.id))).body.status).toBe('archived');
    });
  });

  it('the tolerance: inside it an event applies normally (original timestamp kept), beyond it it is rejected (default 300 s)', async () => {
    const org = newOrg('fdskew');
    await deliverOrgCreated(org, at(1), cid('skew-0'), { name: 'v0' });
    await deliverOrgUpdated(org, ahead(4 * 60), cid('skew-in'), { name: 'v-in-tolerance' }); // 4 min ahead: inside 5 min
    expect((await orgRow(org))?.org_name).toBe('v-in-tolerance');
    const rejected = cid('skew-out');
    await deliverOrgUpdated(org, ahead(6 * 60), rejected, { name: 'v-beyond-tolerance' }); // 6 min ahead: beyond
    expect((await orgRow(org))?.org_name).toBe('v-in-tolerance');
    expect(logged(rejected, 'REJECTED a future-dated')).toBe(true);
  });

  it('the tolerance is configurable (SELECTION_LIST_EVENT_FUTURE_SKEW_SECONDS) and a bad value falls back to 300 s', async () => {
    const org = newOrg('fdcfg');
    await deliverOrgCreated(org, at(1), cid('cfg-0'), { name: 'v0' });
    try {
      process.env['SELECTION_LIST_EVENT_FUTURE_SKEW_SECONDS'] = '30';
      await deliverOrgUpdated(org, ahead(60), cid('cfg-60'), { name: 'v-60' }); // 60 s ahead, tolerance 30 s: rejected
      expect((await orgRow(org))?.org_name).toBe('v0');
      await deliverOrgUpdated(org, ahead(10), cid('cfg-10'), { name: 'v-10' }); // 10 s ahead: applied
      expect((await orgRow(org))?.org_name).toBe('v-10');
      for (const bad of ['', 'abc', '-5']) {
        process.env['SELECTION_LIST_EVENT_FUTURE_SKEW_SECONDS'] = bad;
        await deliverOrgUpdated(org, ahead(120), cid('cfg-bad'), { name: `v-bad-${bad}` }); // 2 min ahead: inside the 300 s default
        expect({ bad, name: (await orgRow(org))?.org_name }).toEqual({ bad, name: `v-bad-${bad}` });
      }
    } finally {
      delete process.env['SELECTION_LIST_EVENT_FUTURE_SKEW_SECONDS'];
    }
  });

  // LAST in the file: it leaves the platform org's snapshot clock a minute or two in the future, which would make any
  // later past-dated event stale.
  it('PLATFORM org, inside the tolerance: a deactivation 60 s ahead suspends with its ORIGINAL timestamp, and a redelivery never changes the outcome', async () => {
    const when = ahead(60);
    await deliverOrgDeleted(SUSP, when, cid('in-dead'), 'soft');
    expect(await isSuspended()).toBe(true);
    expect(new Date((await projection()).suspended_event_at).toISOString()).toBe(when);
    const later = ahead(90);
    await deliverOrgUpdated(SUSP, later, cid('in-alive'), { type: 'platform', isActive: true });
    expect(await isSuspended()).toBe(false);
    for (let i = 0; i < 3; i++) {
      await deliverOrgDeleted(SUSP, when, cid('in-dead-redelivered'), 'soft'); // the same old event, redelivered later each time
      await new Promise((r) => setTimeout(r, 5));
      expect(await isSuspended()).toBe(false); // the ordering value is stable: it can never re-suspend
    }
    await expectWritesOpen(ON, true);
  });
});

const orgRow = async (orgWire: string) =>
  (await dbQuery(`SELECT status, org_type, is_active, org_name, snapshot_at, suspended_at FROM selection_list_ref_index WHERE entity_type = 'organization' AND entity_id = $1`, [canonicalUuid(orgWire)]))[0];
