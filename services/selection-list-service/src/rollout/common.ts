// rollout/common.ts - shared plumbing of the SL9 rollout data jobs (docs/runbooks/selection-lists-rollout.md section 10).
//
// The jobs are FLAG-INDEPENDENT (they read and write data, never a release flag), IDEMPOTENT (a re-run converges on
// the same state and does nothing) and have a DRY-RUN mode that prints a report and WRITES NOTHING:
//
//   - a dry run executes inside a `READ ONLY` transaction (`withReadOnly`), so a write cannot happen even by a bug:
//     Postgres refuses it (25006). It also takes no lock and enqueues no event.
//   - an apply run does every change through the owning service's own transaction + outbox: the organization outbox
//     lock first (the lock every writer of this service takes, so a job may run while the service is serving),
//     fresh re-read under that lock, the change, and the domain event in the SAME transaction.
//
// Nothing here is reachable over HTTP; the only entry point is the CLI (rollout/cli.ts).

import type { Knex } from 'knex';
import type { SafeParseError } from 'zod';
import { slListSnapshotV1 } from '@fuzefront/shared/kafka';
import { listSnapshot, readList, type ListRow } from '../events/emitters';
import { mintEventId, OutboxPayloadInvalidError, WireIdError } from '../events/outbox';

/**
 * The event contract refused this row's event (`OutboxPayloadInvalidError`: e.g. a legacy one-character key; or
 * `WireIdError`: an organization id with no `org_` form). Nothing was written for the transaction that threw it. A job
 * reports such a row as BLOCKED and carries on with the others; any OTHER error aborts the run.
 */
export const isEventRefusal = (err: unknown): boolean => err instanceof OutboxPayloadInvalidError || err instanceof WireIdError;

/** One wording, used by dry run AND apply, for a row whose event the contract would refuse. */
export const REASON_EVENT_CONTRACT = 'its event would violate the event contract (legacy data, e.g. an invalid key or an empty name): left as it was, decide by hand';

/** One wording, used by dry run AND apply, for an organization `visibility-org` already finished (durable marker). */
export const REASON_ORG_DONE =
  'this organization was already processed by visibility-org (durable marker in selection_list_rollout_marks; see runbook 10.4): left alone. To run it on purpose, clear the marker first';

/** The organizations (canonical `org_...` ids) a job has finished: read-only. */
export async function markedOrgs(ex: Knex | Knex.Transaction, job: RolloutJobName): Promise<Set<string>> {
  const rows: Array<{ organization_id: string }> = await ex('selection_list_rollout_marks').where({ job }).select('organization_id');
  return new Set(rows.map((r) => r.organization_id));
}

/** Is this organization (canonical id) marked done for `job`? Call under the organization outbox lock. */
export async function isOrgMarked(trx: Knex.Transaction, job: RolloutJobName, orgWire: string): Promise<boolean> {
  return Boolean(await trx('selection_list_rollout_marks').where({ job, organization_id: orgWire }).first('job'));
}

/** Mark the organization done, in the CALLER's transaction (the same one as the changes). A second writer is harmless. */
export async function markOrg(trx: Knex.Transaction, job: RolloutJobName, orgWire: string, runId: string, listsChanged: number): Promise<void> {
  await trx('selection_list_rollout_marks')
    .insert({ job, organization_id: orgWire, run_id: runId, lists_changed: listsChanged })
    .onConflict(['job', 'organization_id'])
    .ignore();
}

/**
 * Would the event for this list, as it WILL be after the job's change (`over` = the changed columns), be refused by the
 * event contract? Reads only, so a dry run can ask exactly what apply will find out the hard way (a thrown
 * `OutboxPayloadInvalidError` that rolls the transaction back). Returns the first issues, or null when the snapshot is fine.
 */
export async function snapshotRefusal(ex: Knex | Knex.Transaction, listId: string, over: Partial<ListRow> = {}): Promise<string | null> {
  const parsed = slListSnapshotV1.safeParse(listSnapshot({ ...(await readList(ex, listId)), ...over }));
  if (parsed.success) return null;
  return (parsed as SafeParseError<unknown>).error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

export type RolloutMode ='dry-run' | 'apply';

export type RolloutJobName = 'audit' | 'reconcile-duplicates' | 'visibility-org' | 'retro-forks';
export const ROLLOUT_JOBS: readonly RolloutJobName[] = ['audit', 'reconcile-duplicates', 'visibility-org', 'retro-forks'];

/** A precondition the job cannot proceed without (reported, nothing written): the CLI exits 3. */
export class RolloutPreconditionError extends Error {
  readonly code = 'ROLLOUT_PRECONDITION';
  constructor(message: string) {
    super(message);
    this.name = 'RolloutPreconditionError';
  }
}

/** One thing a job did (apply) or would do (dry-run). */
export interface RolloutChange {
  /** The affected list (a service-minted id). */
  listId: string;
  /** The organization as stored on the row. */
  organizationId: string;
  action: string;
  detail?: Record<string, unknown>;
}

/** Something a job deliberately left alone, with the reason (so an operator can find it). */
export interface RolloutSkip {
  listId?: string;
  organizationId?: string;
  reason: string;
  detail?: Record<string, unknown>;
}

export interface RolloutReport {
  job: RolloutJobName;
  mode: RolloutMode;
  /** Correlation id stamped on every event the run enqueued (`rollout:<job>:<runId>`); also in the logs. */
  runId: string;
  startedAt: string;
  finishedAt: string;
  /** Counters; the keys are stable per job (documented in the runbook). */
  summary: Record<string, number>;
  changes: RolloutChange[];
  /** Left alone on purpose (informational unless `blocked`). */
  skipped: RolloutSkip[];
  /** Needs an operator: the job could not do what the rule says. A non-empty list exits 2 on apply. */
  blocked: RolloutSkip[];
  warnings: string[];
  /** Job-specific payload (the audit's groups). */
  data?: Record<string, unknown>;
}

export function newRunId(): string {
  return mintEventId();
}

export const correlationFor = (job: RolloutJobName, runId: string): string => `rollout:${job}:${runId}`;

/**
 * Run `fn` inside a REPEATABLE READ, READ ONLY transaction (a consistent snapshot, and a hard guarantee that nothing
 * is written), then roll it back.
 */
export async function withReadOnly<T>(db: Knex, fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  const trx = await db.transaction();
  try {
    await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const out = await fn(trx);
    await trx.rollback();
    return out;
  } catch (err) {
    await trx.rollback().catch(() => undefined);
    throw err;
  }
}

export function emptyReport(job: RolloutJobName, mode: RolloutMode, runId: string): RolloutReport {
  const now = new Date().toISOString();
  return { job, mode, runId, startedAt: now, finishedAt: now, summary: {}, changes: [], skipped: [], blocked: [], warnings: [] };
}

export const finish = (r: RolloutReport): RolloutReport => ({ ...r, finishedAt: new Date().toISOString() });

/** Exit code a finished report maps to: 0 clean, 2 something needs an operator. */
export function exitCodeFor(r: RolloutReport): number {
  if (r.job === 'audit') return (r.summary.keyDuplicateGroups ?? 0) + (r.summary.forkDuplicateGroups ?? 0) > 0 ? 2 : 0;
  return r.mode === 'apply' && r.blocked.length > 0 ? 2 : 0;
}

const DETAIL_LIMIT = 100;

/** The human-readable report (the CLI prints this; `--json` prints the report object instead). */
export function formatReport(r: RolloutReport): string {
  const out: string[] = [];
  out.push(`=== selection-lists rollout: ${r.job}${r.job === 'audit' ? '' : ` (${r.mode})`} run ${r.runId} ===`);
  out.push(r.job === 'audit' ? 'READ ONLY: the audit never writes anything.' : r.mode === 'dry-run' ? 'DRY RUN: nothing was written. Re-run with --apply to make these changes.' : 'APPLY: changes were committed.');
  for (const [k, v] of Object.entries(r.summary)) out.push(`  ${k}: ${v}`);
  const section = (title: string, items: unknown[], line: (x: any) => string) => {
    if (items.length === 0) return;
    out.push(`${title} (${items.length}):`);
    for (const it of items.slice(0, DETAIL_LIMIT)) out.push(`  - ${line(it)}`);
    if (items.length > DETAIL_LIMIT) out.push(`  ... ${items.length - DETAIL_LIMIT} more (use --json for the full list)`);
  };
  section(r.mode === 'dry-run' ? 'WOULD CHANGE' : 'CHANGED', r.changes, (c: RolloutChange) => `${c.action} ${c.listId} (org ${c.organizationId})${c.detail ? ` ${JSON.stringify(c.detail)}` : ''}`);
  section(r.job === 'audit' ? 'DUPLICATES (run reconcile-duplicates)' : 'BLOCKED (needs an operator)', r.blocked, (s: RolloutSkip) => `${s.reason}${s.listId ? ` list ${s.listId}` : ''}${s.organizationId ? ` org ${s.organizationId}` : ''}${s.detail ? ` ${JSON.stringify(s.detail)}` : ''}`);
  section('LEFT ALONE', r.skipped, (s: RolloutSkip) => `${s.reason}${s.listId ? ` list ${s.listId}` : ''}${s.organizationId ? ` org ${s.organizationId}` : ''}${s.detail ? ` ${JSON.stringify(s.detail)}` : ''}`);
  section('WARNINGS', r.warnings, (w: string) => w);
  if (r.data) out.push(`data: ${JSON.stringify(r.data).slice(0, 4000)}`);
  out.push(`exit code: ${exitCodeFor(r)}`);
  return out.join('\n');
}
