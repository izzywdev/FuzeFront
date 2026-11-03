// rollout/cli.ts - the one entry point of the SL9 rollout data jobs.
//
//   node dist/rollout/cli.js <job> [--dry-run | --apply] [--json]
//
//   job              audit                 read-only duplicate-key / duplicate-fork audit (runbook 10.1)
//                    reconcile-duplicates  rename + archive the losers of those duplicates (runbook 10.2)
//                    visibility-org        design record 9.4: seeded lists private -> org
//                    retro-forks           design record 9.6: per-org copies of the platform pack -> forks
//   --dry-run        (the DEFAULT) print the report, write NOTHING (the work runs in a READ ONLY transaction)
//   --apply          make the changes (through the service's transaction + outbox)
//   --json           print the report as one JSON object instead of text
//
// Exit codes: 0 done / nothing to do; 1 unexpected error or bad usage; 2 findings (audit found duplicates) or an
// --apply that left a BLOCKED item for an operator; 3 a precondition is not met (nothing was written).
//
// It connects with the service's own DB_* / DATABASE_URL environment (src/db/knexfile.ts) and needs no other
// service: no Kafka, no Security API, no Unleash. The same image as the service, a different command.

import type { Knex } from 'knex';
import { logger } from '../lib/logger';
import { ROLLOUT_JOBS, RolloutPreconditionError, exitCodeFor, formatReport, type RolloutJobName, type RolloutMode, type RolloutReport } from './common';
import { runAudit, runReconcileDuplicates } from './duplicates';
import { runRetroForks } from './retroForks';
import { runVisibilityOrg } from './visibilityOrg';

export class UsageError extends Error {
  readonly code = 'USAGE';
}

export interface CliOptions {
  job: RolloutJobName;
  mode: RolloutMode;
  json: boolean;
}

export const USAGE = `usage: node dist/rollout/cli.js <${ROLLOUT_JOBS.join('|')}> [--dry-run | --apply] [--json]`;

export function parseArgs(argv: string[]): CliOptions {
  let job: RolloutJobName | undefined;
  let mode: RolloutMode | undefined;
  let json = false;
  for (const a of argv) {
    if (a === '--dry-run' || a === '--apply') {
      const m: RolloutMode = a === '--apply' ? 'apply' : 'dry-run';
      if (mode && mode !== m) throw new UsageError('--dry-run and --apply are mutually exclusive');
      mode = m;
    } else if (a === '--json') json = true;
    else if (a.startsWith('-')) throw new UsageError(`unknown option ${a}`);
    else if ((ROLLOUT_JOBS as readonly string[]).includes(a)) {
      if (job) throw new UsageError('only one job per run');
      job = a as RolloutJobName;
    } else throw new UsageError(`unknown job "${a}"`);
  }
  if (!job) throw new UsageError('no job given');
  if (job === 'audit' && mode === 'apply') throw new UsageError('audit is read-only: it has no --apply');
  return { job, mode: mode ?? 'dry-run', json };
}

export async function runJob(db: Knex, opts: CliOptions): Promise<RolloutReport> {
  switch (opts.job) {
    case 'audit':
      return runAudit(db, 'dry-run');
    case 'reconcile-duplicates':
      return runReconcileDuplicates(db, opts.mode);
    case 'visibility-org':
      return runVisibilityOrg(db, opts.mode);
    case 'retro-forks':
      return runRetroForks(db, opts.mode);
  }
}

/**
 * Print a line and resolve when stdout has TAKEN it (the write callback). A pipe can hold only ~64 KiB; the rest of a big
 * report is still queued in this process when `main()` returns, so nothing may terminate the process before this resolves.
 */
const out = (text: string): Promise<void> =>
  new Promise((resolve) => {
    process.stdout.write(`${text}\n`, () => resolve());
  });

export async function main(argv: string[]): Promise<number> {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    await out(`${(err as Error).message}\n${USAGE}`);
    return 1;
  }
  const { db } = await import('../db');
  const started = Date.now();
  logger.info({ op: 'rollout', job: opts.job, mode: opts.mode }, 'rollout job start');
  try {
    const report = await runJob(db, opts);
    const code = exitCodeFor(report);
    logger.info(
      { op: 'rollout', job: opts.job, mode: opts.mode, runId: report.runId, exitCode: code, elapsedMs: Date.now() - started, changes: report.changes.length, blocked: report.blocked.length },
      'rollout job end',
    );
    // the report is the LAST thing printed (after the structured log lines), so `--json` ends with one parseable line
    await out(opts.json ? JSON.stringify(report) : formatReport(report));
    return code;
  } catch (err) {
    if (err instanceof RolloutPreconditionError) {
      await out(`PRECONDITION NOT MET (nothing was written): ${err.message}`);
      return 3;
    }
    logger.fatal({ err, job: opts.job, mode: opts.mode }, 'rollout job failed');
    return 1;
  } finally {
    await db.destroy().catch(() => undefined);
  }
}

if (require.main === module) {
  // NEVER `process.exit()` here: it discards whatever is still buffered in a piped stdout (a 1 MB report arrived as its first
  // 64 KiB, after the database changes had committed). Set the exit code and let the process end by itself: `main()` has
  // awaited its output and destroyed the pool, so the event loop drains. A closed reader (EPIPE) must not crash it either.
  process.stdout.on('error', () => undefined);
  main(process.argv.slice(2))
    .then(
      (code) => {
        process.exitCode = code;
      },
      (err) => {
        logger.fatal({ err }, 'rollout CLI crashed');
        process.exitCode = 1;
      },
    )
    .finally(() => {
      // Watchdog, not a way out: if something still holds the event loop long after the output was taken, end with the code.
      // unref()'d, so it never keeps a healthy process alive.
      setTimeout(() => process.exit(process.exitCode ?? 1), 10_000).unref();
    });
}
