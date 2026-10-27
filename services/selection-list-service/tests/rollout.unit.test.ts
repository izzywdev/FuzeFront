// rollout.unit.test.ts - the pure parts of the SL9 rollout jobs: the rename, the duplicate grouping and winner rule,
// the reconcile plan (including the key -> fork phase interplay), the CLI argument parser and the report formatter.
// No database: tests/rollout.*.db.test.ts run the same code against real Postgres.

import { fromUuid } from '@izzywdev/fuzefront-identity';
import { pickWinner, rankRows } from '../src/lib/renderingWinner';
import { pickWinner as pickWinnerViaSharedReads } from '../src/services/sharedReads';
import { exitCodeFor, formatReport, emptyReport, type RolloutReport } from '../src/rollout/common';
import { dupKey, findForkGroups, findKeyGroups, planReconcile, unrecognisedOrgs, type ListRef } from '../src/rollout/duplicates';
import { parseArgs, UsageError } from '../src/rollout/cli';

const uuid = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c01';
const wire = fromUuid('organization', uuid);
const uuid2 = '0195a8f2-7c3e-7a11-8b2d-3f4e5a6b7c02';
const wire2 = fromUuid('organization', uuid2);

let n = 0;
const row = (over: Partial<ListRef> & { org: string }): ListRef => ({
  id: `front_sl_${String(++n).padStart(6, '0')}`,
  organization_id: over.org,
  key: 'yes-no',
  status: 'active',
  visibility: 'org',
  created_at: new Date(1_700_000_000_000 + n * 1000),
  forked_from_list_id: null,
  ...over,
});

describe('dupKey', () => {
  it('is <key>--dup-<last 8 chars of the id>', () => {
    expect(dupKey('yes-no', 'front_sl_abcdefgh12345678')).toBe('yes-no--dup-12345678');
  });
  it('stays a legal key (<= 64 chars, ^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$) for the longest key', () => {
    const key = 'a'.repeat(64);
    const out = dupKey(key, 'front_sl_01hxxxxxxxxxxxxxxxxxxabcd1234');
    expect(out.length).toBeLessThanOrEqual(64);
    expect(out).toMatch(/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/);
    expect(out).toBe(`${'a'.repeat(50)}--dup-abcd1234`);
  });
  it('does not leave a run of hyphens when the cut lands on one', () => {
    const key = `${'a'.repeat(49)}-${'b'.repeat(14)}`; // 64 chars, a hyphen at position 50
    expect(dupKey(key, 'front_sl_x12345678')).toBe(`${'a'.repeat(49)}--dup-12345678`);
  });
  it('is deterministic per (key, id): a re-run computes the same name', () => {
    expect(dupKey('countries', 'front_sl_q')).toBe(dupKey('countries', 'front_sl_q'));
  });
});

describe('the winner rule is the service\'s own', () => {
  it('sharedReads re-exports the very function the job uses (one definition)', () => {
    expect(pickWinnerViaSharedReads).toBe(pickWinner);
  });
  it('ranks active over archived, then oldest, then smallest id (a neutral claim ranks nobody by rendering)', () => {
    const archivedOld = row({ org: uuid, status: 'archived', created_at: new Date(1) });
    const activeNew = row({ org: wire, created_at: new Date(5000) });
    const activeOlder = row({ org: uuid, created_at: new Date(4000) });
    const tieA = row({ org: wire, id: 'front_sl_aaa', created_at: new Date(9000) });
    const tieB = row({ org: uuid, id: 'front_sl_bbb', created_at: new Date(9000) });
    expect(rankRows([archivedOld, activeNew, activeOlder], '').map((r) => r.id)).toEqual([activeOlder.id, activeNew.id, archivedOld.id]);
    expect(rankRows([tieB, tieA], '').map((r) => r.id)).toEqual(['front_sl_aaa', 'front_sl_bbb']);
  });
});

describe('findKeyGroups (query A)', () => {
  it('pairs the bare UUID and the TypeID of one org, in either order, and names the winner', () => {
    const a = row({ org: uuid, created_at: new Date(1000) });
    const b = row({ org: wire, created_at: new Date(2000) });
    for (const rows of [[a, b], [b, a]]) {
      const [g] = findKeyGroups(rows);
      expect(g).toMatchObject({ kind: 'key', org: wire, key: 'yes-no' });
      expect(g.winner.id).toBe(a.id);
      expect(g.losers.map((l) => l.id)).toEqual([b.id]);
      expect(g.members.map((m) => m.id)).toEqual([a.id, b.id]);
    }
  });
  it('winner flips with the ages, not with the rendering', () => {
    const a = row({ org: uuid, created_at: new Date(3000) });
    const b = row({ org: wire, created_at: new Date(1000) });
    expect(findKeyGroups([a, b])[0].winner.id).toBe(b.id);
  });
  it('an uppercase UUID is the same org as its lowercase / TypeID rendering', () => {
    const a = row({ org: uuid.toUpperCase(), created_at: new Date(1000) });
    const b = row({ org: wire, created_at: new Date(2000) });
    expect(findKeyGroups([a, b])).toHaveLength(1);
  });
  it('is not a duplicate: one rendering, different keys, or different orgs', () => {
    expect(findKeyGroups([row({ org: uuid }), row({ org: uuid, key: 'other' }), row({ org: wire2 }), row({ org: uuid2, key: 'other' })])).toEqual([]);
    expect(findKeyGroups([row({ org: uuid }), row({ org: wire2 })])).toEqual([]);
  });
  it('an archived row still counts (the key is taken whatever its status)', () => {
    const g = findKeyGroups([row({ org: uuid, status: 'archived', created_at: new Date(1) }), row({ org: wire })]);
    expect(g).toHaveLength(1);
    expect(g[0].winner.status).toBe('active');
  });
  it('legacy ids that are neither a UUID nor a TypeID pair with nothing and are reported', () => {
    const rows = [row({ org: 'legacy-org-1' }), row({ org: 'legacy-org-1', key: 'b' }), row({ org: 'LEGACY' })];
    expect(findKeyGroups(rows)).toEqual([]);
    expect(unrecognisedOrgs(rows)).toEqual(['LEGACY', 'legacy-org-1']);
  });
});

describe('findForkGroups (query B)', () => {
  const src = 'front_sl_common';
  it('two ACTIVE forks of one common list under two renderings: the oldest wins, the other active one loses', () => {
    const f1 = row({ org: uuid, key: 'a', forked_from_list_id: src, created_at: new Date(1000) });
    const f2 = row({ org: wire, key: 'b', forked_from_list_id: src, created_at: new Date(2000) });
    const [g] = findForkGroups([f2, f1]);
    expect(g).toMatchObject({ kind: 'fork', org: wire, forkedFrom: src });
    expect(g.winner.id).toBe(f1.id);
    expect(g.losers.map((l) => l.id)).toEqual([f2.id]);
  });
  it('an archived fork beside an active one is not ambiguous, so not a finding', () => {
    const f1 = row({ org: uuid, forked_from_list_id: src, status: 'archived' });
    const f2 = row({ org: wire, forked_from_list_id: src });
    expect(findForkGroups([f1, f2])).toEqual([]);
  });
  it('forks of different common lists, or of one org under one rendering, are not duplicates', () => {
    expect(findForkGroups([row({ org: uuid, forked_from_list_id: 'a' }), row({ org: wire, forked_from_list_id: 'b' })])).toEqual([]);
    expect(findForkGroups([row({ org: uuid, forked_from_list_id: 'a', key: 'k1' }), row({ org: uuid, forked_from_list_id: 'a', key: 'k2' })])).toEqual([]);
  });
});

describe('planReconcile', () => {
  it('renames every loser to dupKey and plans nothing for the winner', () => {
    const a = row({ org: uuid, created_at: new Date(1000) });
    const b = row({ org: wire, created_at: new Date(2000) });
    const { keyPhase, forkPhase } = planReconcile([a, b]);
    expect(forkPhase).toEqual([]);
    expect(keyPhase).toHaveLength(1);
    expect(keyPhase[0]).toMatchObject({ fromKey: 'yes-no', toKey: dupKey('yes-no', b.id), wasActive: true });
    expect(keyPhase[0].loser.id).toBe(b.id);
  });
  it('three renderings of key: one winner, two losers', () => {
    const a = row({ org: uuid, created_at: new Date(1000) });
    const b = row({ org: wire, created_at: new Date(2000) });
    const c = row({ org: uuid.toUpperCase(), created_at: new Date(3000) });
    expect(planReconcile([c, b, a]).keyPhase.map((p) => p.loser.id).sort()).toEqual([b.id, c.id].sort());
  });
  it('the fork phase is decided on the state the key phase leaves: a key loser no longer makes a fork group ambiguous', () => {
    const src = 'front_sl_common';
    // both forks share the key, so the key phase already archives the younger one
    const f1 = row({ org: uuid, forked_from_list_id: src, created_at: new Date(1000) });
    const f2 = row({ org: wire, forked_from_list_id: src, created_at: new Date(2000) });
    const plan = planReconcile([f1, f2]);
    expect(plan.keyPhase.map((p) => p.loser.id)).toEqual([f2.id]);
    expect(plan.forkPhase).toEqual([]);
  });
  it('forks with DIFFERENT keys are handled by the fork phase', () => {
    const src = 'front_sl_common';
    const f1 = row({ org: uuid, key: 'one', forked_from_list_id: src, created_at: new Date(1000) });
    const f2 = row({ org: wire, key: 'two', forked_from_list_id: src, created_at: new Date(2000) });
    const plan = planReconcile([f1, f2]);
    expect(plan.keyPhase).toEqual([]);
    expect(plan.forkPhase.map((p) => p.loser.id)).toEqual([f2.id]);
    expect(plan.forkPhase[0].toKey).toBe(dupKey('two', f2.id));
  });
  it('a common (platform) loser is BLOCKED, never planned for a write', () => {
    const a = row({ org: uuid, created_at: new Date(1000), visibility: 'org' });
    const common = row({ org: wire, created_at: new Date(2000), visibility: 'platform' });
    const { keyPhase } = planReconcile([a, common]);
    expect(keyPhase).toHaveLength(1);
    expect(keyPhase[0].blockedReason).toBe('platform-list');
  });
  it('is empty when there is nothing to do (the idempotent end state)', () => {
    expect(planReconcile([row({ org: uuid }), row({ org: wire2 }), row({ org: 'legacy' })])).toEqual({ keyPhase: [], forkPhase: [] });
  });
});

describe('cli parseArgs', () => {
  it('defaults to a DRY RUN; --apply is explicit', () => {
    expect(parseArgs(['retro-forks'])).toEqual({ job: 'retro-forks', mode: 'dry-run', json: false });
    expect(parseArgs(['visibility-org', '--apply', '--json'])).toEqual({ job: 'visibility-org', mode: 'apply', json: true });
    expect(parseArgs(['--dry-run', 'reconcile-duplicates'])).toMatchObject({ mode: 'dry-run' });
  });
  it('refuses nonsense: no job, two jobs, unknown job/option, --dry-run with --apply, audit --apply', () => {
    for (const bad of [[], ['audit', 'retro-forks'], ['nope'], ['audit', '--wat'], ['retro-forks', '--dry-run', '--apply'], ['audit', '--apply']]) {
      expect(() => parseArgs(bad)).toThrow(UsageError);
    }
  });
});

describe('report', () => {
  const base = (over: Partial<RolloutReport>): RolloutReport => ({ ...emptyReport('retro-forks', 'dry-run', 'run1'), ...over });
  it('exit codes: audit findings and an --apply with a blocked item exit 2; a dry run never does', () => {
    expect(exitCodeFor(base({ job: 'audit', summary: { keyDuplicateGroups: 1, forkDuplicateGroups: 0 } }))).toBe(2);
    expect(exitCodeFor(base({ job: 'audit', summary: { keyDuplicateGroups: 0, forkDuplicateGroups: 0 } }))).toBe(0);
    expect(exitCodeFor(base({ mode: 'apply', blocked: [{ reason: 'x' }] }))).toBe(2);
    expect(exitCodeFor(base({ mode: 'dry-run', blocked: [{ reason: 'x' }] }))).toBe(0);
  });
  it('the dry-run text says nothing was written and names the changes', () => {
    const text = formatReport(base({ summary: { wouldFork: 1 }, changes: [{ listId: 'front_sl_1', organizationId: wire, action: 'make a fork' }] }));
    expect(text).toContain('DRY RUN: nothing was written');
    expect(text).toContain('WOULD CHANGE (1)');
    expect(text).toContain('front_sl_1');
  });
});
