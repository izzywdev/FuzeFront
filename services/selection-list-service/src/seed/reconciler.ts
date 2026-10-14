// seed/reconciler.ts - the platform-seed RECONCILER / backfill (plan sections 7.1 step 6, 11).
//
// Why it exists. `identity.org.created` seeds platform defaults only for an org created while
// `fuzefront.selection-lists.seed-defaults` is ON; an org created while it was OFF (or before this
// feature) is merely PROJECTED, and a platform pack upgrade (v1 -> v2) has to reach orgs that already
// hold v1. Without this job, flipping the flag ON would seed only future orgs.
//
// What a tick does (`runReconcilerOnce`)
//   1. Scan the org projection (`selection_list_ref_index`) for orgs that are ACTIVE (status
//      'active' AND is_active = true), whose type the current platform pack `appliesTo`, and whose
//      ledger has NO row for (org, 'platform', packKey) at version >= the pack's current version.
//      (OR whose owner still lacks the list-owner grant on a seeded list - ownerGrants.ts)
//      Keyset-paged on wire_id, `batchSize` per page, at most `maxOrgs` examined per tick.
//      A deleted tombstone, an inactive org, an org of an excluded type (the root `platform` org)
//      is never a candidate - it is never even handed to the seed library.
//   2. Per org, in order: still in backoff? -> skip. `isSeedingEnabled(org)` OFF (or the evaluation
//      throws: fail closed) -> skip and count `skipped_flag_off`. Otherwise take a per-org advisory
//      lock (another instance holds it -> skip), RE-CHECK the org still needs seeding under the lock
//      (a peer may have just done it; avoids a redundant `seed.completed`), then call
//      `applyPlatformDefaults(db, org, { trigger: 'backfill' })`.
//   3. A pause of `batchDelayMs` between pages so a sweep never monopolises the DB.
//
// Failure model. Per-org isolation: an org that throws or comes back `seed.failed` never stops the
// sweep. Each failure is logged (org id, reason - never content), counted, and the org is put in
// BACKOFF: exponential from `backoffBaseMs` (doubling per consecutive failure, capped at
// `backoffMaxMs`) for a retryable failure / an infrastructure fault; a non-retryable refusal
// (PACK_CONTENT_MISMATCH, ORG_INACTIVE, ...) goes straight to `backoffMaxMs`, because retrying it
// cannot help and every refusal writes a `seed.failed` outbox row. The backoff table is in memory
// (a restart retries once, then backs off again) and bounded. Infrastructure faults are rethrown by
// the library (`internalErrors: 'throw'`) so no `seed.failed` row is written for a fault that is not
// the org's. No hot loop: nothing retries inside a tick.
//
// Multi-instance safety. The library's own locks (org outbox lock, `sl-seed:<org>:...` xact lock) +
// the ledger primary key already make two concurrent applies of one org converge on exactly one set
// of rows. On top of that a per-org `pg_try_advisory_xact_lock` (key includes `current_schema()`)
// lets the loser skip instead of queueing; it is held by a short, otherwise idle transaction on its
// own connection, so it is released on commit/rollback/crash with no session state to leak.
//
// The reconciler is OFF by default in the service (`SEED_RECONCILER_ENABLED`), independent of the
// flags: starting it never seeds anything while `isSeedingEnabled(org)` is false for the org.

import type { Knex } from 'knex';
import type { Logger } from 'pino';
import { logger as rootLogger } from '../lib/logger';
import {
  reconcilerFailedTotal,
  reconcilerLastSweepGauge,
  reconcilerOrgsSeededTotal,
  reconcilerSkippedFlagOffTotal,
  reconcilerSkippedOtherTotal,
  reconcilerSweepsTotal,
} from '../lib/metrics';
import { isSeedingEnabled as defaultIsSeedingEnabled } from './flagGate';
import { OWNER_GRANT_PENDING_SQL } from './ownerGrants';
import { applyPlatformDefaults as defaultApplyPlatformDefaults, type PlatformSeedOutcome } from './platform';
import { currentPlatformPacks, DEFAULT_PLATFORM_PACK_DIR } from './packs';
import { PLATFORM_SEED_SOURCE } from '@fuzefront/shared/kafka';

// ---------------------------------------------------------------------------
// Configuration (env, safe defaults)
// ---------------------------------------------------------------------------

export interface ReconcilerConfig {
  /** Delay between ticks. */
  intervalMs: number;
  /** Orgs fetched/processed per page. */
  batchSize: number;
  /** Pause between pages inside one tick. */
  batchDelayMs: number;
  /** Hard cap on orgs examined per tick (flag-off orgs count: it bounds work, not just writes). */
  maxOrgsPerTick: number;
  /** First backoff after a failure; doubles per consecutive failure. */
  backoffBaseMs: number;
  /** Ceiling of the backoff, and the backoff for a non-retryable refusal. */
  backoffMaxMs: number;
}

export const RECONCILER_DEFAULTS: ReconcilerConfig = {
  intervalMs: 5 * 60_000,
  batchSize: 20,
  batchDelayMs: 1_000,
  maxOrgsPerTick: 200,
  backoffBaseMs: 60_000,
  backoffMaxMs: 6 * 60 * 60_000,
};

function intEnv(env: NodeJS.ProcessEnv, name: string, dflt: number, min: number, max: number, log: Logger): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    log.warn({ env: name, value: raw, min, max, using: dflt }, 'invalid reconciler setting, using the default');
    return dflt;
  }
  return n;
}

/** Read the reconciler's knobs from the environment; an invalid value falls back to the default (logged). */
export function loadReconcilerConfig(env: NodeJS.ProcessEnv = process.env, log: Logger = rootLogger): ReconcilerConfig {
  const d = RECONCILER_DEFAULTS;
  return {
    intervalMs: intEnv(env, 'SEED_RECONCILER_INTERVAL_MS', d.intervalMs, 1_000, 24 * 3_600_000, log),
    batchSize: intEnv(env, 'SEED_RECONCILER_BATCH_SIZE', d.batchSize, 1, 500, log),
    batchDelayMs: intEnv(env, 'SEED_RECONCILER_BATCH_DELAY_MS', d.batchDelayMs, 0, 60_000, log),
    maxOrgsPerTick: intEnv(env, 'SEED_RECONCILER_MAX_ORGS_PER_TICK', d.maxOrgsPerTick, 1, 100_000, log),
    backoffBaseMs: intEnv(env, 'SEED_RECONCILER_BACKOFF_BASE_MS', d.backoffBaseMs, 1_000, 24 * 3_600_000, log),
    backoffMaxMs: intEnv(env, 'SEED_RECONCILER_BACKOFF_MAX_MS', d.backoffMaxMs, 1_000, 7 * 24 * 3_600_000, log),
  };
}

export function isReconcilerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SEED_RECONCILER_ENABLED === 'true';
}

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

const BACKOFF_TABLE_MAX = 10_000;

/** Per-org failure memory: `failures` consecutive failures and the earliest next attempt. */
export class ReconcilerBackoff {
  private readonly entries = new Map<string, { failures: number; notBefore: number }>();

  constructor(
    private readonly baseMs: number = RECONCILER_DEFAULTS.backoffBaseMs,
    private readonly maxMs: number = RECONCILER_DEFAULTS.backoffMaxMs,
  ) {}

  /** True while the org must not be retried yet. */
  isBlocked(org: string, now: number): boolean {
    const e = this.entries.get(org);
    return e !== undefined && now < e.notBefore;
  }

  /** Record a failure; returns the delay applied (ms). `terminal` jumps straight to the ceiling. */
  fail(org: string, now: number, terminal = false): number {
    const prev = this.entries.get(org)?.failures ?? 0;
    const failures = prev + 1;
    const delay = terminal ? this.maxMs : Math.min(this.maxMs, this.baseMs * 2 ** Math.min(failures - 1, 30));
    this.entries.delete(org); // re-insert at the end: Map order = oldest-first for eviction
    this.entries.set(org, { failures, notBefore: now + delay });
    while (this.entries.size > BACKOFF_TABLE_MAX) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    return delay;
  }

  succeed(org: string): void {
    this.entries.delete(org);
  }

  get size(): number {
    return this.entries.size;
  }
}

// ---------------------------------------------------------------------------
// One tick
// ---------------------------------------------------------------------------

export type ReconcileOrgResult = 'seeded' | 'skipped-flag-off' | 'skipped-backoff' | 'skipped-locked' | 'skipped-up-to-date' | 'failed';

export interface ReconcilerRunOptions extends Partial<Pick<ReconcilerConfig, 'batchSize' | 'batchDelayMs' | 'maxOrgsPerTick' | 'backoffBaseMs' | 'backoffMaxMs'>> {
  /** Resume after this org (wire id) - the `nextCursor` of the previous run; omitted = from the start. */
  cursor?: string | null;
  /** Failure memory shared across ticks; omitted = none (a one-shot ops run). */
  backoff?: ReconcilerBackoff;
  /** Checked between orgs and during pauses; true ends the run early (graceful stop). */
  shouldStop?: () => boolean;
  /** Seams for tests. */
  isSeedingEnabled?: (organizationId: string) => Promise<boolean>;
  applyPlatformDefaults?: typeof defaultApplyPlatformDefaults;
  packDir?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  logger?: Logger;
}

export interface ReconcilerRunSummary {
  /** Candidate orgs looked at (<= maxOrgsPerTick). */
  examined: number;
  seeded: number;
  skippedFlagOff: number;
  skippedBackoff: number;
  skippedLocked: number;
  skippedUpToDate: number;
  failed: number;
  /** Resume point for the next run; null when the candidate list was exhausted (sweep complete -> start over). */
  nextCursor: string | null;
  /** True when `shouldStop()` ended the run before it finished. */
  stopped: boolean;
}

/** SQL for "org r needs (some) current platform pack": active, applicable type, no ledger row at >= version. */
function needsClause(packs: ReturnType<typeof currentPlatformPacks>): { sql: string; bindings: Array<string | number> } {
  const parts: string[] = [];
  const bindings: Array<string | number> = [];
  for (const p of packs) {
    const types = [...p.appliesTo];
    if (types.length === 0) continue;
    parts.push(
      `(r.org_type IN (${types.map(() => '?').join(', ')}) AND NOT EXISTS (
         SELECT 1 FROM selection_list_seed_ledger l
          WHERE l.organization_id = r.wire_id AND l.seed_source = ? AND l.seed_key = ? AND l.version >= ?))`,
    );
    bindings.push(...types, PLATFORM_SEED_SOURCE, p.packKey, p.version);
  }
  // Also a candidate: an org already seeded whose owner still lacks list-owner on a seeded list (a grant
  // that failed earlier, or lists seeded before owner grants existed). applyPlatformDefaults heals it.
  parts.push(OWNER_GRANT_PENDING_SQL);
  return { sql: parts.join(' OR '), bindings };
}

const ACTIVE_ORG = `r.entity_type = 'organization' AND r.status = 'active' AND r.is_active IS TRUE AND r.wire_id IS NOT NULL`;

async function candidatePage(db: Knex | Knex.Transaction, packs: ReturnType<typeof currentPlatformPacks>, after: string | null, limit: number): Promise<string[]> {
  const need = needsClause(packs);
  if (need.sql === '') return [];
  const res = await db.raw(
    `SELECT r.wire_id FROM selection_list_ref_index r
      WHERE ${ACTIVE_ORG} AND (? ::text IS NULL OR r.wire_id > ?) AND (${need.sql})
      ORDER BY r.wire_id LIMIT ?`,
    [after, after, ...need.bindings, limit],
  );
  return res.rows.map((x: { wire_id: string }) => x.wire_id);
}

async function stillNeedsSeeding(ex: Knex | Knex.Transaction, packs: ReturnType<typeof currentPlatformPacks>, org: string): Promise<boolean> {
  const need = needsClause(packs);
  if (need.sql === '') return false;
  const res = await ex.raw(`SELECT 1 FROM selection_list_ref_index r WHERE ${ACTIVE_ORG} AND r.wire_id = ? AND (${need.sql}) LIMIT 1`, [org, ...need.bindings]);
  return res.rows.length > 0;
}

function classify(outcomes: PlatformSeedOutcome[]): { kind: 'seeded' | 'noop' | 'failed'; retryable: boolean; reasons: string[] } {
  const failed = outcomes.filter((o) => o.result?.status === 'failed');
  if (failed.length > 0) {
    return {
      kind: 'failed',
      retryable: failed.every((o) => o.result?.status === 'failed' && o.result.retryable),
      reasons: failed.map((o) => (o.result?.status === 'failed' ? `${o.packKey}:${o.result.reason}` : '')),
    };
  }
  const changed = outcomes.some((o) => o.result?.status === 'completed' && (o.result.outcome === 'applied' || o.result.outcome === 'upgraded'));
  return { kind: changed ? 'seeded' : 'noop', retryable: false, reasons: [] };
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * One bounded pass over the candidate orgs (see the file header). Never throws for an org-level
 * problem; throws only if the candidate scan itself fails (the scheduler logs it and retries next tick).
 */
export async function runReconcilerOnce(db: Knex, opts: ReconcilerRunOptions = {}): Promise<ReconcilerRunSummary> {
  const cfg = { ...RECONCILER_DEFAULTS, ...stripUndefined(opts) };
  const log = opts.logger ?? rootLogger.child({ component: 'seed-reconciler' });
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const seedingOn = opts.isSeedingEnabled ?? defaultIsSeedingEnabled;
  const apply = opts.applyPlatformDefaults ?? defaultApplyPlatformDefaults;
  const backoff = opts.backoff ?? new ReconcilerBackoff(cfg.backoffBaseMs, cfg.backoffMaxMs);
  const stopped = () => opts.shouldStop?.() === true;
  const packDir = opts.packDir ?? DEFAULT_PLATFORM_PACK_DIR;

  const summary: ReconcilerRunSummary = {
    examined: 0,
    seeded: 0,
    skippedFlagOff: 0,
    skippedBackoff: 0,
    skippedLocked: 0,
    skippedUpToDate: 0,
    failed: 0,
    nextCursor: null,
    stopped: false,
  };

  const packs = currentPlatformPacks(packDir);
  let cursor: string | null = opts.cursor ?? null;
  let exhausted = false;

  while (summary.examined < cfg.maxOrgsPerTick) {
    if (stopped()) {
      summary.stopped = true;
      break;
    }
    const want = Math.min(cfg.batchSize, cfg.maxOrgsPerTick - summary.examined);
    const page = await candidatePage(db, packs, cursor, want);
    if (page.length === 0) {
      exhausted = true;
      break;
    }
    for (const org of page) {
      if (stopped()) {
        summary.stopped = true;
        break;
      }
      cursor = org;
      summary.examined += 1;
      const result = await reconcileOrg(org);
      if (result === 'seeded') summary.seeded += 1;
      else if (result === 'skipped-flag-off') summary.skippedFlagOff += 1;
      else if (result === 'skipped-backoff') summary.skippedBackoff += 1;
      else if (result === 'skipped-locked') summary.skippedLocked += 1;
      else if (result === 'skipped-up-to-date') summary.skippedUpToDate += 1;
      else summary.failed += 1;
    }
    if (summary.stopped) break;
    if (page.length < want) {
      exhausted = true;
      break;
    }
    if (summary.examined < cfg.maxOrgsPerTick && cfg.batchDelayMs > 0) await sleep(cfg.batchDelayMs);
  }
  summary.nextCursor = exhausted ? null : cursor;
  log.info({ ...summary, hasMore: summary.nextCursor !== null }, 'seed reconciler run finished');
  return summary;

  async function reconcileOrg(org: string): Promise<ReconcileOrgResult> {
    const olog = log.child({ organizationId: org });
    const t = now();
    if (backoff.isBlocked(org, t)) {
      reconcilerSkippedOtherTotal.inc({ reason: 'backoff' });
      olog.debug('in backoff, skipped');
      return 'skipped-backoff';
    }
    try {
      if (!(await seedingOn(org))) {
        reconcilerSkippedFlagOffTotal.inc();
        olog.debug('seeding flag is OFF for this org, skipped');
        return 'skipped-flag-off';
      }
      // Per-org advisory lock on its own short transaction; the apply runs on the pool.
      return await db.transaction(async (lockTrx) => {
        const got = await lockTrx.raw(`SELECT pg_try_advisory_xact_lock(hashtextextended('sl-reconciler:' || current_schema() || ':' || ?, 0)) AS locked`, [org]);
        if (!got.rows[0]?.locked) {
          reconcilerSkippedOtherTotal.inc({ reason: 'locked' });
          olog.debug('another reconciler instance holds this org, skipped');
          return 'skipped-locked' as const;
        }
        if (!(await stillNeedsSeeding(db, packs, org))) {
          reconcilerSkippedOtherTotal.inc({ reason: 'up_to_date' });
          olog.debug('org no longer needs seeding (done by a peer, deleted or deactivated), skipped');
          return 'skipped-up-to-date' as const;
        }
        const outcomes = await apply(db, org, { trigger: 'backfill', internalErrors: 'throw', packDir });
        const verdict = classify(outcomes);
        if (verdict.kind === 'failed') {
          const delayMs = backoff.fail(org, now(), !verdict.retryable);
          reconcilerFailedTotal.inc({ retryable: String(verdict.retryable) });
          olog.warn({ reasons: verdict.reasons, retryable: verdict.retryable, retryInMs: delayMs }, 'platform backfill refused (seed.failed recorded); backing off');
          return 'failed' as const;
        }
        backoff.succeed(org);
        if (verdict.kind === 'seeded') {
          reconcilerOrgsSeededTotal.inc();
          olog.info({ packs: outcomes.map((o) => `${o.packKey}@${o.version}:${o.result?.status === 'completed' ? o.result.outcome : (o.skipped ?? 'n/a')}`) }, 'platform defaults backfilled');
          return 'seeded' as const;
        }
        reconcilerSkippedOtherTotal.inc({ reason: 'up_to_date' });
        olog.debug('nothing to apply for this org');
        return 'skipped-up-to-date' as const;
      });
    } catch (err) {
      const delayMs = backoff.fail(org, now());
      reconcilerFailedTotal.inc({ retryable: 'true' });
      olog.error({ err, retryInMs: delayMs }, 'platform backfill hit a fault; isolated, backing off');
      return 'failed';
    }
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export interface ReconcilerHandle {
  /** Stop scheduling, let the in-flight tick finish its current org, resolve when idle. Idempotent. */
  stop: () => Promise<void>;
  /** Run a tick right now (tests / ops); resolves with its summary. Serialised with scheduled ticks. */
  runNow: () => Promise<ReconcilerRunSummary | null>;
}

export interface StartReconcilerOptions {
  db: Knex;
  logger?: Logger;
  env?: NodeJS.ProcessEnv;
  config?: Partial<ReconcilerConfig>;
  /** Delay before the first tick (default: a random 0..intervalMs/4 jitter so replicas do not start in lockstep). */
  initialDelayMs?: number;
  /** Seams passed through to `runReconcilerOnce` (tests). */
  run?: Pick<ReconcilerRunOptions, 'isSeedingEnabled' | 'applyPlatformDefaults' | 'packDir' | 'now' | 'sleep'>;
}

/**
 * Start the periodic reconciler. Ticks never overlap (a setTimeout chain, not setInterval); a tick that
 * throws (DB outage) is logged and counted and the next one runs on schedule. The caller decides whether
 * to start it at all (`isReconcilerEnabled()`).
 */
export function startReconciler(opts: StartReconcilerOptions): ReconcilerHandle {
  const log = (opts.logger ?? rootLogger).child({ component: 'seed-reconciler' });
  const cfg: ReconcilerConfig = { ...loadReconcilerConfig(opts.env ?? process.env, log), ...stripUndefined(opts.config ?? {}) };
  const backoff = new ReconcilerBackoff(cfg.backoffBaseMs, cfg.backoffMaxMs);
  let cursor: string | null = null;
  let stopping = false;
  let timer: NodeJS.Timeout | null = null;
  let wake: (() => void) | null = null;
  let inflight: Promise<ReconcilerRunSummary | null> = Promise.resolve(null);

  const sleep = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      t.unref();
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });

  const tick = (): Promise<ReconcilerRunSummary | null> => {
    inflight = inflight.then(async () => {
      if (stopping) return null;
      try {
        const summary = await runReconcilerOnce(opts.db, {
          ...cfg,
          ...opts.run,
          cursor,
          backoff,
          shouldStop: () => stopping,
          sleep: opts.run?.sleep ?? sleep,
          logger: log,
        });
        cursor = summary.nextCursor;
        reconcilerSweepsTotal.inc({ result: 'ok' });
        reconcilerLastSweepGauge.set(Date.now() / 1000);
        return summary;
      } catch (err) {
        reconcilerSweepsTotal.inc({ result: 'error' });
        log.error({ err }, 'seed reconciler tick failed; retrying next tick');
        return null;
      }
    });
    return inflight;
  };

  const schedule = (delayMs: number): void => {
    if (stopping) return;
    timer = setTimeout(() => {
      timer = null;
      void tick().finally(() => schedule(cfg.intervalMs));
    }, delayMs);
    timer.unref();
  };

  const initial = opts.initialDelayMs ?? Math.floor(Math.random() * (cfg.intervalMs / 4));
  schedule(initial);
  log.info({ ...cfg, initialDelayMs: initial }, 'seed reconciler started');

  return {
    runNow: tick,
    stop: async () => {
      if (!stopping) {
        stopping = true;
        if (timer) clearTimeout(timer);
        timer = null;
        wake?.();
        log.info('seed reconciler stopping');
      }
      await inflight;
    },
  };
}
