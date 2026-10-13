// seed/apply.ts - the seed algorithm (docs/planning/selection-lists-events.md section 9).
//
// `applySeedRequest(db, request)` applies one versioned pack of lists to one
// organization, atomically:
//
//   - ONE database transaction per request; `lockOrgOutbox` is taken FIRST (lock order:
//     org outbox -> seed scope -> org_lists quota -> list_items quota -> list row, the
//     order every emitting route uses), so seed writes and HTTP writes of one org
//     serialise and outbox `seq` order is commit order.
//   - Idempotent through the seed ledger, keyed (organization_id, seed_source,
//     seed_key = pack key, version): a replay / duplicate delivery returns the recorded
//     result (`already-applied`) and writes nothing; two simultaneous identical requests
//     serialise on the advisory lock, one applies, one is already-applied.
//   - All-or-nothing: any refusal (a SeedFailure) or fault rolls the whole transaction
//     back; the outcome is then recorded as `seed.failed` in its OWN transaction, so a
//     failed request leaves no list, item, translation, ledger or audit row behind.
//   - Never overwrites a row a human edited (provenance + `seed_hash` comparison, section
//     9.1) and never recreates a row a human purged (the ledger manifest remembers
//     every list key / item code ever seeded).
//   - Counts against the org quota (a seeded list is a list); the per-user list cap is a
//     cap on humans and does not apply to the system principal.
//
// Flags: the library does NOT read feature flags. Its callers (the two Kafka consumers,
// the reconciler) check `isSeedingEnabled` (flagGate.ts) per message and answer
// SEEDING_DISABLED themselves; this function runs whatever it is handed.
//
// Trust: verifying the attestation token (introspection) is the consumer's job; the
// library receives the verified `attestedSubject` and enforces the allowlist row
// (sources.ts) against it - source enabled, subject allowed, key namespaces, per-request
// caps.

import type { Knex } from 'knex';
import { z } from 'zod';
import {
  PLATFORM_SEED_SOURCE,
  SELECTION_LIST_LIMITS,
  SELECTION_LIST_SEED_REQUEST_ID_PATTERN,
  TOPICS,
  refineSeedLists,
  slSeedListSpecV1,
  slSeedScopeV1,
  slSeedTriggerV1,
  slSlugV1,
  type SelectionListSeedItemSpecV1,
  type SelectionListSeedListSpecV1,
} from '@fuzefront/shared/kafka';
import { mintId } from '@izzywdev/fuzefront-identity';
import {
  emitItemChanged,
  emitItemCreated,
  emitItemTranslationUpserted,
  emitListChanged,
  emitListCreated,
  emitListTranslationUpserted,
  emitTranslationDeleted,
  readItem,
  readList,
  systemEventContext,
  type EventContext,
} from '../events/emitters';
import { enqueueEvent, lockOrgOutbox, mintEventId, wireOrgId } from '../events/outbox';
import { logger } from '../lib/logger';
import { getQuota, lockQuotaScope } from '../services/quota.service';
import { canonicalJson, computeSourceHash, hashCanonical, hashText } from './canonical';
import {
  hashItemContent,
  hashListContent,
  itemContentFromSpec,
  itemDiffersFromSeed,
  listContentFromSpec,
  listDiffersFromSeed,
  readItemContents,
  readListContents,
  type ItemContent,
  type ListContent,
} from './content';
import { readOrgProjection } from './org';
import { readSeedSource, type SeedSourceDefinition } from './sources';
import {
  SEED_PRINCIPAL,
  SeedFailure,
  type SeedApplyRequest,
  type SeedFailureDetail,
  type SeedListResult,
  type SeedOutcome,
  type SeedResult,
} from './types';

type Trx = Knex.Transaction;

/** Retries for a deadlock / serialization failure before the request is recorded as INTERNAL_ERROR. */
const MAX_TRANSIENT_ATTEMPTS = 3;
/** The seed.failed schema caps `details` at 50 entries. */
const MAX_DETAILS = 50;

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Apply one seed request. Never throws for a domain refusal (it returns
 * `{ status: 'failed', ... }` after recording `seed.failed`); throws only for what it
 * cannot even record (an unrenderable organization id, an invalid source/pack that the
 * outcome event itself cannot carry) or, with `internalErrors: 'throw'`, an unexpected
 * fault.
 */
export async function applySeedRequest(db: Knex, request: SeedApplyRequest): Promise<SeedResult> {
  const req: SeedApplyRequest = { ...request, organizationId: wireOrgId(request.organizationId) };
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction((trx) => runSeed(trx, req));
    } catch (err) {
      if (err instanceof SeedFailure) return recordSeedFailure(db, req, err);
      if (isTransient(err) && attempt < MAX_TRANSIENT_ATTEMPTS) {
        logger.warn({ err, attempt, organizationId: req.organizationId, source: req.source.app, pack: req.pack }, 'seed: transient database error, retrying');
        continue;
      }
      logger.error(
        { err, organizationId: req.organizationId, source: req.source.app, pack: req.pack, trigger: req.trigger, requestId: req.requestId },
        'seed: unexpected error while applying a seed request (rolled back)',
      );
      if (req.internalErrors === 'throw') throw err;
      return recordSeedFailure(db, req, new SeedFailure('INTERNAL_ERROR', 'The seed request could not be applied because of an unexpected error; nothing was written.'));
    }
  }
}

/**
 * Write `seed.failed` for `failure` in its own transaction (no list/ledger data is
 * written). Exported so a consumer can record INTERNAL_ERROR itself once ITS retries
 * are exhausted (`internalErrors: 'throw'`), or VALIDATION_ERROR / ATTESTATION_INVALID /
 * SEEDING_DISABLED for a message it refused before calling `applySeedRequest`.
 */
export async function recordSeedFailure(db: Knex, request: SeedApplyRequest, failure: SeedFailure): Promise<SeedResult> {
  const organizationId = wireOrgId(request.organizationId);
  const payload = {
    ...outcomeBase(request),
    reason: failure.reason,
    message: failure.message.slice(0, SELECTION_LIST_LIMITS.MESSAGE_MAX) || failure.reason,
    retryable: failure.retryable,
    details: failure.details.slice(0, MAX_DETAILS),
  };
  const event = await db.transaction(async (trx) => {
    await lockOrgOutbox(trx, organizationId);
    return enqueueEvent(trx, {
      topic: TOPICS.SELECTION_LISTS_SEED_FAILED,
      organizationId,
      payload,
      correlationId: request.correlationId,
    });
  });
  logger.info(
    { organizationId, source: request.source.app, pack: request.pack, reason: failure.reason, retryable: failure.retryable, requestId: request.requestId, eventId: event.eventId },
    'seed: request refused (seed.failed recorded, nothing written)',
  );
  return {
    status: 'failed',
    reason: failure.reason,
    message: payload.message,
    retryable: failure.retryable,
    details: payload.details,
    eventId: event.eventId,
    organizationId,
  };
}

// ---------------------------------------------------------------------------
// Request validation (pure - no database)
// ---------------------------------------------------------------------------

const listsEnvelopeSchema = z
  .object({ lists: z.array(slSeedListSpecV1).min(1).max(SELECTION_LIST_LIMITS.MAX_LISTS_PER_SEED) })
  .strict()
  .superRefine((o, ctx) => refineSeedLists(o.lists, ctx));

const requestIdSchema = z.string().regex(SELECTION_LIST_SEED_REQUEST_ID_PATTERN).nullable();
const headerSchema = z.object({
  scope: slSeedScopeV1,
  source: z.object({ app: slSlugV1, service: z.string().min(1).max(128) }),
  pack: z.object({ key: slSlugV1, version: z.number().int().positive() }),
  trigger: slSeedTriggerV1,
  requestId: requestIdSchema,
});

function validateRequest(req: SeedApplyRequest): SelectionListSeedListSpecV1[] {
  if (req.scope === 'user') {
    throw new SeedFailure('SCOPE_UNSUPPORTED', 'User-scoped seeding is not supported: selection lists are organization-scoped.');
  }
  const issues: Array<{ path: string; message: string }> = [];
  const header = headerSchema.safeParse(req);
  if (!header.success) {
    for (const i of (header as z.SafeParseError<unknown>).error.issues) issues.push({ path: i.path.join('.'), message: i.message });
  }
  const lists = listsEnvelopeSchema.safeParse({ lists: req.lists });
  if (!lists.success) {
    for (const i of (lists as z.SafeParseError<unknown>).error.issues) issues.push({ path: i.path.join('.'), message: i.message });
  }
  if (issues.length > 0) {
    throw new SeedFailure(
      'VALIDATION_ERROR',
      `The seed request is invalid: ${issues.slice(0, 5).map((i) => `${i.path || '(root)'}: ${i.message}`).join('; ')}`,
      issues.slice(0, MAX_DETAILS).map((i) => ({ path: i.path.slice(0, 256) })),
    );
  }
  return (lists as z.SafeParseSuccess<{ lists: SelectionListSeedListSpecV1[] }>).data.lists;
}

// ---------------------------------------------------------------------------
// The transaction
// ---------------------------------------------------------------------------

function outcomeBase(req: SeedApplyRequest) {
  return {
    requestId: req.requestId,
    scope: req.scope,
    ...(req.scope === 'user' && req.userId ? { userId: req.userId } : {}),
    source: { app: req.source.app, service: req.source.service },
    pack: { key: req.pack.key, version: req.pack.version },
    trigger: req.trigger,
  };
}

/** True when the request's non-source translations are machine output (platform packs only; see types.ts). */
const isMachinePack = (req: SeedApplyRequest): boolean => req.translationProvenance === 'machine';

/**
 * The content `seed_hash` covers. Machine translations are NOT part of it: `content.ts` ignores
 * `is_machine` rows when it re-reads a row (they are autofill's, not an edit), so hashing them here
 * would make every freshly seeded row look human-edited. A machine pack's translations are written
 * and refreshed by `syncTranslations` instead (see `machineTranslationsDiffer`).
 */
const listSeedContent = (req: SeedApplyRequest, spec: SelectionListSeedListSpecV1, status: 'active' | 'archived' = 'active'): ListContent =>
  listContentFromSpec(isMachinePack(req) ? { ...spec, translations: [] } : spec, status);
const itemSeedContent = (req: SeedApplyRequest, spec: SelectionListSeedItemSpecV1, status: 'active' | 'archived' = 'active'): ItemContent =>
  itemContentFromSpec(isMachinePack(req) ? { ...spec, translations: [] } : spec, status);

interface MachineRow {
  text: string;
  description: string | null;
}

/** Machine (is_machine = true) translation rows of the given lists / items, by owner id then locale. */
async function readMachineTranslations(trx: Trx, kind: 'list' | 'item', ownerIds: string[]): Promise<Map<string, Map<string, MachineRow>>> {
  const out = new Map<string, Map<string, MachineRow>>();
  if (ownerIds.length === 0) return out;
  const table = kind === 'list' ? 'selection_list_translations' : 'selection_list_item_translations';
  const ownerCol = kind === 'list' ? 'list_id' : 'item_id';
  const textCol = kind === 'list' ? 'name' : 'label';
  const rows: Array<Record<string, unknown>> = await trx(table)
    .whereIn(ownerCol, ownerIds)
    .where({ is_machine: true })
    .select(ownerCol, 'locale', `${textCol} as text`, 'description');
  for (const r of rows) {
    const id = r[ownerCol] as string;
    const m = out.get(id) ?? new Map<string, MachineRow>();
    m.set(r.locale as string, { text: r.text as string, description: (r.description as string | null) ?? null });
    out.set(id, m);
  }
  return out;
}

/** True when a machine pack's translations differ from the machine rows stored for the row (missing / changed text). */
function machineTranslationsDiffer(
  have: Map<string, MachineRow> | undefined,
  want: Array<{ locale: string; name?: string; label?: string; description?: string }> | undefined,
): boolean {
  return (want ?? []).some((t) => {
    const cur = have?.get(t.locale);
    return !cur || cur.text !== (t.name ?? t.label) || cur.description !== (t.description ?? null);
  });
}

interface SeedListRow {
  id: string;
  key: string;
  status: 'active' | 'archived';
  source_locale: string;
  seed_source: string | null;
  seed_key: string | null;
  seed_list_key: string | null;
  seed_version: number | null;
  seed_hash: string | null;
  seed_user_modified: boolean;
}

interface SeedItemRow {
  id: string;
  list_id: string;
  code: string;
  sort_order: number | string;
  status: 'active' | 'archived';
  seed_source: string | null;
  seed_key: string | null;
  seed_hash: string | null;
  seed_user_modified: boolean;
}

type ItemOp =
  | { kind: 'create'; spec: SelectionListSeedItemSpecV1; sortOrder: number }
  | { kind: 'update'; spec: SelectionListSeedItemSpecV1; row: SeedItemRow; restore: boolean; translationsOnly?: boolean }
  | { kind: 'archive'; row: SeedItemRow; current: ItemContent }
  /** The hash says a human edited this item: persist `seed_user_modified` (no content write, no event). */
  | { kind: 'flag'; row: SeedItemRow };

type ListPlan =
  | { kind: 'create'; spec: SelectionListSeedListSpecV1 }
  | { kind: 'skip-deleted'; key: string }
  | { kind: 'skip-edited'; key: string; row: SeedListRow; itemsSkipped: number }
  | {
      kind: 'update';
      spec: SelectionListSeedListSpecV1;
      row: SeedListRow;
      current: ListContent;
      listChanged: boolean;
      /** A machine pack's translations for the list differ from the stored machine rows (the list's own content is unchanged). */
      listMachineChanged: boolean;
      reactivate: boolean;
      itemOps: ItemOp[];
      itemsSkipped: number;
      activeItems: number;
    }
  | { kind: 'archive'; key: string; row: SeedListRow; current: ListContent }
  | { kind: 'noop'; key: string; row: SeedListRow };

async function runSeed(trx: Trx, req: SeedApplyRequest): Promise<SeedResult> {
  const lists = validateRequest(req);
  const org = req.organizationId;
  const source = req.source.app;
  const pack = req.pack;

  // 1. Serialise: org outbox lock FIRST, then the per-(org, source, pack) lock so concurrent
  //    duplicates of one pack queue behind each other (and see each other's ledger row).
  await lockOrgOutbox(trx, org);
  await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [`sl-seed:${org}:${source}:${pack.key}`]);

  // 2. Trust: the source's allowlist row (section 8), then the org (section 7.2 step 5).
  const sourceDef = await authorizeSource(trx, req);
  enforceSourceRules(sourceDef, lists);
  await checkOrg(trx, req);

  // 3. Version check against the ledger (section 9 step 1).
  // A pack that says its translations are machine output is a different content from one that says they are
  // reviewed (provenance is part of what the version means); 'human' keeps the historic hash of `lists` alone.
  const contentHash = hashCanonical(isMachinePack(req) ? { translationProvenance: 'machine', lists } : lists);
  const ledger: Array<{ version: number; content_hash: string; manifest: Record<string, string[]>; result: SeedListResult[] }> = await trx(
    'selection_list_seed_ledger',
  )
    .where({ organization_id: org, seed_source: source, seed_key: pack.key })
    .orderBy('version', 'desc')
    .select('version', 'content_hash', 'manifest', 'result');
  const vmax = ledger[0]?.version;
  if (vmax !== undefined) {
    if (pack.version < vmax) return complete(trx, req, 'superseded', vmax, []);
    if (pack.version === vmax) {
      if (ledger[0].content_hash === contentHash) return complete(trx, req, 'already-applied', vmax, ledger[0].result ?? []);
      throw new SeedFailure(
        'PACK_CONTENT_MISMATCH',
        `Pack ${pack.key} version ${pack.version} was already applied with different content; a version's content is immutable - publish a new version.`,
      );
    }
  }
  const outcome: SeedOutcome = vmax === undefined ? 'applied' : 'upgraded';

  // 4. Plan (reads only) - every refusal happens here or in the quota step, before any write.
  const planned = await planLists(trx, req, lists, ledger);
  await enforceQuota(trx, org, planned);

  // 5. Write.
  const ctx = systemEventContext(org, source, req.correlationId);
  const results: SeedListResult[] = [];
  for (const plan of planned) results.push(await writePlan(trx, req, ctx, plan));

  const manifest: Record<string, string[]> = {};
  for (const l of lists) manifest[l.key] = l.items.map((i) => i.code);
  await trx('selection_list_seed_ledger').insert({
    organization_id: org,
    seed_source: source,
    seed_key: pack.key,
    version: pack.version,
    scope: 'org',
    content_hash: contentHash,
    manifest: trx.raw('?::jsonb', [JSON.stringify(manifest)]),
    result: trx.raw('?::jsonb', [JSON.stringify(results)]),
    request_id: req.requestId,
    trigger: req.trigger,
    applied_by: SEED_PRINCIPAL,
    attested_subject: source === PLATFORM_SEED_SOURCE ? null : (req.attestedSubject ?? null),
  });

  return complete(trx, req, outcome, pack.version, results);
}

async function complete(trx: Trx, req: SeedApplyRequest, outcome: SeedOutcome, appliedVersion: number, lists: SeedListResult[]): Promise<SeedResult> {
  const event = await enqueueEvent(trx, {
    topic: TOPICS.SELECTION_LISTS_SEED_COMPLETED,
    organizationId: req.organizationId,
    payload: { ...outcomeBase(req), outcome, appliedVersion, lists },
    correlationId: req.correlationId,
  });
  logger.info(
    {
      organizationId: req.organizationId,
      source: req.source.app,
      pack: req.pack,
      outcome,
      appliedVersion,
      trigger: req.trigger,
      requestId: req.requestId,
      lists: lists.map((l) => `${l.key}:${l.action}`),
      eventId: event.eventId,
    },
    'seed: request completed',
  );
  return { status: 'completed', outcome, appliedVersion, lists, eventId: event.eventId, organizationId: req.organizationId };
}

// ---------------------------------------------------------------------------
// Trust checks
// ---------------------------------------------------------------------------

async function authorizeSource(trx: Trx, req: SeedApplyRequest): Promise<SeedSourceDefinition | null> {
  const app = req.source.app;
  if (app === PLATFORM_SEED_SOURCE) return null; // the service's own packs: no allowlist row, no attestation
  const row = await readSeedSource(trx, app);
  if (!row || !row.enabled) {
    throw new SeedFailure('SOURCE_NOT_ALLOWED', `Seed source "${app}" is not allowlisted or is disabled.`);
  }
  if (!req.attestedSubject) {
    throw new SeedFailure('ATTESTATION_INVALID', 'The seed request carries no verified attestation subject; re-send with a fresh service token.');
  }
  if (!row.allowedSubjects.includes(req.attestedSubject)) {
    logger.warn({ source: app, subject: req.attestedSubject }, 'seed: attested subject is not bound to the requested source');
    throw new SeedFailure('SOURCE_NOT_ALLOWED', `The authenticated caller is not allowed to seed for source "${app}".`);
  }
  return row;
}

/** Key-prefix namespace + per-request caps from the source's row (platform: only the contract caps, already in the schema). */
function enforceSourceRules(source: SeedSourceDefinition | null, lists: SelectionListSeedListSpecV1[]): void {
  if (!source) return;
  const totalItems = lists.reduce((n, l) => n + l.items.length, 0);
  const limits: SeedFailureDetail[] = [];
  if (lists.length > source.maxListsPerRequest) {
    limits.push({ quotaScope: 'request_lists', limit: source.maxListsPerRequest, requested: lists.length });
  }
  if (totalItems > source.maxItemsPerRequest) {
    limits.push({ quotaScope: 'request_items', limit: source.maxItemsPerRequest, requested: totalItems });
  }
  if (limits.length > 0) {
    throw new SeedFailure('LIMIT_EXCEEDED', `The request exceeds the per-request caps of source "${source.app}".`, limits);
  }
  const violations: SeedFailureDetail[] = [];
  lists.forEach((l, i) => {
    if (!source.keyPrefixes.some((p) => l.key.startsWith(p))) violations.push({ listKey: l.key, path: `lists.${i}.key` });
  });
  if (violations.length > 0) {
    throw new SeedFailure(
      'NAMESPACE_VIOLATION',
      `List keys must start with one of: ${source.keyPrefixes.join(', ')} (source "${source.app}").`,
      violations,
    );
  }
}

async function checkOrg(trx: Trx, req: SeedApplyRequest): Promise<void> {
  if (req.orgCheck === 'skip') return;
  const proj = await readOrgProjection(trx, req.organizationId);
  if (!proj) throw new SeedFailure('ORG_UNKNOWN', 'The organization is not (yet) known to the selection-list service.');
  if (proj.status === 'deleted' || proj.isActive === false) {
    throw new SeedFailure('ORG_INACTIVE', 'The organization is deactivated or deleted.');
  }
}

// ---------------------------------------------------------------------------
// Planning (section 9 step 2) - reads only
// ---------------------------------------------------------------------------

async function planLists(
  trx: Trx,
  req: SeedApplyRequest,
  lists: SelectionListSeedListSpecV1[],
  ledger: Array<{ manifest: Record<string, string[]> }>,
): Promise<ListPlan[]> {
  const org = req.organizationId;
  const source = req.source.app;
  const pack = req.pack;

  // Everything this (source, pack) ever seeded into the org, found BY PROVENANCE (a user may have renamed it).
  const seededRows: SeedListRow[] = await trx('selection_lists')
    .where({ organization_id: org, seed_source: source, seed_key: pack.key })
    .select('id', 'key', 'status', 'source_locale', 'seed_source', 'seed_key', 'seed_list_key', 'seed_version', 'seed_hash', 'seed_user_modified');
  const byListKey = new Map(seededRows.map((r) => [r.seed_list_key as string, r]));
  const listContents = await readListContents(trx, seededRows.map((r) => r.id));

  const specKeys = lists.map((l) => l.key);
  const keyRows: Array<{ id: string; key: string }> = await trx('selection_lists').where({ organization_id: org }).whereIn('key', specKeys).select('id', 'key');
  const keyTaken = new Set(keyRows.map((r) => r.key));

  const itemRows: SeedItemRow[] = seededRows.length
    ? await trx('selection_list_items')
        .whereIn('list_id', seededRows.map((r) => r.id))
        .select('id', 'list_id', 'code', 'sort_order', 'status', 'seed_source', 'seed_key', 'seed_hash', 'seed_user_modified')
    : [];
  const itemsByList = new Map<string, SeedItemRow[]>();
  for (const it of itemRows) itemsByList.set(it.list_id, [...(itemsByList.get(it.list_id) ?? []), it]);
  const itemContents = await readItemContents(trx, itemRows.filter((r) => r.seed_source !== null).map((r) => r.id));
  const machine = isMachinePack(req);
  const listMachine = machine ? await readMachineTranslations(trx, 'list', seededRows.map((r) => r.id)) : new Map<string, Map<string, MachineRow>>();
  const itemMachine = machine ? await readMachineTranslations(trx, 'item', itemRows.map((r) => r.id)) : new Map<string, Map<string, MachineRow>>();

  // What earlier versions of this pack seeded: the union of every manifest ("ever seeded"),
  // and the previous version's manifest ("dropped from the pack").
  const ever = new Map<string, Set<string>>();
  for (const l of ledger) for (const [k, codes] of Object.entries(l.manifest)) ever.set(k, new Set([...(ever.get(k) ?? []), ...codes]));
  const prevManifest = ledger[0]?.manifest ?? {};

  const plans: ListPlan[] = [];
  const conflicts: SeedFailureDetail[] = [];

  lists.forEach((spec, index) => {
    const row = byListKey.get(spec.key);
    if (!row) {
      if (ever.has(spec.key)) {
        plans.push({ kind: 'skip-deleted', key: spec.key }); // seeded before, purged by a user: never recreated
      } else if (keyTaken.has(spec.key)) {
        conflicts.push({ listKey: spec.key, path: `lists.${index}.key` });
      } else {
        plans.push({ kind: 'create', spec });
      }
      return;
    }
    const current = listContents.get(row.id);
    if (row.seed_user_modified || listDiffersFromSeed(current, row.seed_hash as string)) {
      plans.push({ kind: 'skip-edited', key: spec.key, row, itemsSkipped: spec.items.length });
      return;
    }
    // Seeded before and untouched: update to the new content.
    const rows = itemsByList.get(row.id) ?? [];
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const prevCodes = ever.get(spec.key) ?? new Set<string>();
    const ops: ItemOp[] = [];
    let skipped = 0;
    let maxSort = rows.reduce((m, r) => Math.max(m, Number(r.sort_order)), 0);
    for (const item of spec.items) {
      const r = byCode.get(item.code);
      if (!r) {
        if (prevCodes.has(item.code)) skipped++; // seeded before, purged by a user
        else {
          maxSort += 100; // appended after the current max; existing items are NEVER reordered
          ops.push({ kind: 'create', spec: item, sortOrder: maxSort });
        }
      } else if (r.seed_source !== source || r.seed_key !== pack.key) {
        skipped++; // the code is taken by a row this pack did not seed
      } else if (r.seed_user_modified || itemDiffersFromSeed(itemContents.get(r.id), r.seed_hash as string)) {
        skipped++; // edited / archived / retranslated by a human
        if (!r.seed_user_modified) ops.push({ kind: 'flag', row: r });
      } else {
        const cur = itemContents.get(r.id) as ItemContent;
        const want = itemSeedContent(req, item, 'active');
        if (hashItemContent(cur) !== hashItemContent(want)) ops.push({ kind: 'update', spec: item, row: r, restore: r.status === 'archived' });
        else if (machine && machineTranslationsDiffer(itemMachine.get(r.id), item.translations)) {
          ops.push({ kind: 'update', spec: item, row: r, restore: false, translationsOnly: true }); // only the machine text moved
        }
      }
    }
    // Items the previous version carried that this one dropped: archive (still resolve) if untouched.
    const newCodes = new Set(spec.items.map((i) => i.code));
    for (const code of prevManifest[spec.key] ?? []) {
      if (newCodes.has(code)) continue;
      const r = byCode.get(code);
      if (!r || r.seed_source !== source || r.seed_key !== pack.key || r.status === 'archived') continue;
      if (r.seed_user_modified || itemDiffersFromSeed(itemContents.get(r.id), r.seed_hash as string)) {
        skipped++;
        if (!r.seed_user_modified) ops.push({ kind: 'flag', row: r });
      } else ops.push({ kind: 'archive', row: r, current: itemContents.get(r.id) as ItemContent });
    }
    const want = listSeedContent(req, spec, 'active');
    const activeItems = rows.filter((r) => r.status === 'active').length;
    plans.push({
      kind: 'update',
      spec,
      row,
      current: current as ListContent,
      listChanged: hashListContent(current as ListContent) !== hashListContent(want),
      listMachineChanged: machine && machineTranslationsDiffer(listMachine.get(row.id), spec.translations),
      reactivate: row.status === 'archived',
      itemOps: ops,
      itemsSkipped: skipped,
      activeItems,
    });
  });

  if (conflicts.length > 0) {
    throw new SeedFailure(
      'KEY_CONFLICT',
      `A list key is already taken by a list this pack did not seed (${conflicts.map((c) => c.listKey).join(', ')}); rename or archive it and re-send.`,
      conflicts,
    );
  }

  // Lists the previous version carried that this one dropped: archive if untouched, leave if edited.
  const newKeys = new Set(lists.map((l) => l.key));
  for (const key of Object.keys(prevManifest)) {
    if (newKeys.has(key)) continue;
    const row = byListKey.get(key);
    if (!row) {
      plans.push({ kind: 'skip-deleted', key });
      continue;
    }
    const current = listContents.get(row.id);
    if (row.seed_user_modified || listDiffersFromSeed(current, row.seed_hash as string)) plans.push({ kind: 'skip-edited', key, row, itemsSkipped: 0 });
    else if (row.status === 'archived') plans.push({ kind: 'noop', key, row });
    else plans.push({ kind: 'archive', key, row, current: current as ListContent });
  }
  return plans;
}

// ---------------------------------------------------------------------------
// Quota (section 9 step 3)
// ---------------------------------------------------------------------------

async function enforceQuota(trx: Trx, org: string, plans: ListPlan[]): Promise<void> {
  const quota = await getQuota(org, trx);
  await lockQuotaScope(trx, `org_lists:${org}`);
  const details: SeedFailureDetail[] = [];

  const [{ count }] = await trx('selection_lists').where({ organization_id: org, status: 'active' }).count('id as count');
  const current = parseInt(String(count), 10);
  const newlyActive = plans.filter((p) => p.kind === 'create' || (p.kind === 'update' && p.reactivate)).length;
  if (current + newlyActive > quota.maxLists) {
    details.push({ quotaScope: 'org_lists', limit: quota.maxLists, current, requested: newlyActive });
  }

  for (const p of plans) {
    if (p.kind === 'create') {
      if (p.spec.items.length > quota.maxItemsPerList) {
        details.push({ quotaScope: 'list_items', listKey: p.spec.key, limit: quota.maxItemsPerList, current: 0, requested: p.spec.items.length });
      }
    } else if (p.kind === 'update') {
      await lockQuotaScope(trx, `list_items:${p.row.id}`);
      const added = p.itemOps.filter((o) => o.kind === 'create' || (o.kind === 'update' && o.restore)).length;
      const removed = p.itemOps.filter((o) => o.kind === 'archive').length;
      if (p.activeItems + added - removed > quota.maxItemsPerList && added > 0) {
        details.push({ quotaScope: 'list_items', listKey: p.spec.key, limit: quota.maxItemsPerList, current: p.activeItems, requested: added });
      }
    }
  }
  if (details.length > 0) {
    throw new SeedFailure('QUOTA_EXCEEDED', 'Applying the pack would exceed the organization\'s list or item quota; nothing was written.', details);
  }
}

// ---------------------------------------------------------------------------
// Writing (section 9 step 4)
// ---------------------------------------------------------------------------

const emptyResult = (key: string, listId: string | null, action: SeedListResult['action'], extra: Partial<SeedListResult> = {}): SeedListResult => ({
  listId,
  key,
  action,
  itemsCreated: 0,
  itemsUpdated: 0,
  itemsArchived: 0,
  itemsSkipped: 0,
  ...extra,
});

async function writePlan(trx: Trx, req: SeedApplyRequest, ctx: EventContext, plan: ListPlan): Promise<SeedListResult> {
  switch (plan.kind) {
    case 'skip-deleted':
      return emptyResult(plan.key, null, 'skipped-user-deleted');
    case 'noop':
      return emptyResult(plan.key, plan.row.id, 'unchanged');
    case 'skip-edited':
      if (!plan.row.seed_user_modified) await trx('selection_lists').where({ id: plan.row.id }).update({ seed_user_modified: true }); // persist the hash verdict
      return emptyResult(plan.key, plan.row.id, 'skipped-user-edited', { itemsSkipped: plan.itemsSkipped });
    case 'create':
      return createList(trx, req, ctx, plan.spec);
    case 'update':
      return updateList(trx, req, ctx, plan);
    case 'archive':
      return archiveList(trx, req, ctx, plan);
  }
}

function auditAfter(req: SeedApplyRequest, listId: string, listKey: string) {
  // listId/listKey ride along because a purge DETACHES the row from the list (list_id -> NULL), and the
  // trail must stay readable ("what seeded what") after the list itself is gone.
  return { seedSource: req.source.app, packKey: req.pack.key, packVersion: req.pack.version, requestId: req.requestId, listId, listKey };
}

async function audit(trx: Trx, req: SeedApplyRequest, listId: string, listKey: string, action: 'seed.applied' | 'seed.upgraded' | 'seed.archived'): Promise<void> {
  await trx('selection_list_audit').insert({
    id: mintEventId(), // uuidv7 (identity package) - audit rows have no registered entity type
    list_id: listId,
    item_id: null,
    actor_id: SEED_PRINCIPAL,
    action,
    before: null,
    after: trx.raw('?::jsonb', [JSON.stringify(auditAfter(req, listId, listKey))]),
  });
}

interface TextRow {
  locale: string;
  text: string;
  description: string | null;
  /** The row is machine output (non-source locales of a machine pack); the source-locale row never is. */
  machine: boolean;
}

async function insertListTranslations(trx: Trx, listId: string, spec: SelectionListSeedListSpecV1, machine: boolean): Promise<void> {
  const rows: Array<Record<string, unknown>> = [
    { list_id: listId, locale: spec.sourceLocale, name: spec.name, description: spec.description ?? null, source_hash: hashText(spec.name), is_machine: false },
    ...(spec.translations ?? []).map((t) => ({
      list_id: listId,
      locale: t.locale,
      name: t.name,
      description: t.description ?? null,
      source_hash: computeSourceHash(spec.name, spec.description ?? null),
      is_machine: machine,
    })),
  ];
  await trx('selection_list_translations').insert(rows);
}

async function insertItem(trx: Trx, listId: string, list: SelectionListSeedListSpecV1, item: SelectionListSeedItemSpecV1, sortOrder: number, req: SeedApplyRequest): Promise<string> {
  const itemId = mintId('selectionListItem');
  await trx('selection_list_items').insert({
    id: itemId,
    list_id: listId,
    code: item.code,
    sort_order: sortOrder,
    status: 'active',
    created_by: SEED_PRINCIPAL,
    seed_source: req.source.app,
    seed_key: req.pack.key,
    seed_version: req.pack.version,
    seed_hash: hashItemContent(itemSeedContent(req, item, 'active')),
    seed_user_modified: false,
  });
  await trx('selection_list_item_translations').insert([
    { item_id: itemId, locale: list.sourceLocale, label: item.label, description: item.description ?? null, source_hash: hashText(item.label), is_machine: false },
    ...(item.translations ?? []).map((t) => ({
      item_id: itemId,
      locale: t.locale,
      label: t.label,
      description: t.description ?? null,
      source_hash: computeSourceHash(item.label, item.description ?? null),
      is_machine: isMachinePack(req),
    })),
  ]);
  return itemId;
}

async function createList(trx: Trx, req: SeedApplyRequest, ctx: EventContext, spec: SelectionListSeedListSpecV1): Promise<SeedListResult> {
  const listId = mintId('selectionList');
  await trx('selection_lists').insert({
    id: listId,
    organization_id: req.organizationId,
    key: spec.key,
    source_locale: spec.sourceLocale,
    status: 'active',
    created_by: SEED_PRINCIPAL,
    revision: 1,
    seed_source: req.source.app,
    seed_key: req.pack.key,
    seed_list_key: spec.key,
    seed_version: req.pack.version,
    seed_hash: hashListContent(listSeedContent(req, spec, 'active')),
    seed_user_modified: false,
  });
  await insertListTranslations(trx, listId, spec, isMachinePack(req));
  const itemIds: string[] = [];
  for (let i = 0; i < spec.items.length; i++) itemIds.push(await insertItem(trx, listId, spec, spec.items[i], (i + 1) * 100, req));

  // Events: the list, its translations, then each item with its translations (each carries its own revision).
  await emitListCreated(trx, ctx, listId);
  for (const t of spec.translations ?? []) await emitListTranslationUpserted(trx, ctx, listId, t.locale);
  for (let i = 0; i < spec.items.length; i++) {
    await emitItemCreated(trx, ctx, listId, itemIds[i]);
    for (const t of spec.items[i].translations ?? []) await emitItemTranslationUpserted(trx, ctx, listId, itemIds[i], t.locale);
  }
  await audit(trx, req, listId, spec.key, 'seed.applied');
  return emptyResult(spec.key, listId, 'created', { itemsCreated: spec.items.length });
}

/**
 * Make the translation rows of a list/item equal to `desired` (source locale included):
 * upsert what differs (a machine row for a locale the pack now provides is replaced by the
 * reviewed text; a machine pack writes its own rows with `is_machine = true`), delete non-machine rows the pack no longer carries. Machine rows for
 * other locales are autofill's and are never touched. Returns the non-source locales
 * written / removed, for the translation events.
 */
async function syncTranslations(
  trx: Trx,
  kind: 'list' | 'item',
  ownerId: string,
  sourceLocale: string,
  desired: TextRow[],
  sourceText: string,
  sourceDescription: string | null,
): Promise<{ upserted: string[]; deleted: string[] }> {
  const table = kind === 'list' ? 'selection_list_translations' : 'selection_list_item_translations';
  const ownerCol = kind === 'list' ? 'list_id' : 'item_id';
  const textCol = kind === 'list' ? 'name' : 'label';
  const existing: Array<{ locale: string; text: string; description: string | null; is_machine: boolean }> = await trx(table)
    .where({ [ownerCol]: ownerId })
    .select('locale', `${textCol} as text`, 'description', 'is_machine');
  const have = new Map(existing.map((r) => [r.locale, r]));
  const upserted: string[] = [];
  const deleted: string[] = [];
  for (const d of desired) {
    const cur = have.get(d.locale);
    if (cur && cur.is_machine === d.machine && cur.text === d.text && (cur.description ?? null) === d.description) continue;
    await trx(table)
      .insert({
        [ownerCol]: ownerId,
        locale: d.locale,
        [textCol]: d.text,
        description: d.description,
        source_hash: d.locale === sourceLocale ? hashText(d.text) : computeSourceHash(sourceText, sourceDescription),
        is_machine: d.machine,
        updated_at: trx.fn.now(),
      })
      .onConflict([ownerCol, 'locale'])
      .merge([textCol, 'description', 'source_hash', 'is_machine', 'updated_at']);
    if (d.locale !== sourceLocale) upserted.push(d.locale);
  }
  const wanted = new Set(desired.map((d) => d.locale));
  for (const r of existing) {
    if (wanted.has(r.locale) || r.is_machine) continue;
    await trx(table).where({ [ownerCol]: ownerId, locale: r.locale }).delete();
    deleted.push(r.locale);
  }
  return { upserted, deleted };
}

const textRows = (
  spec: { sourceLocale: string; name?: string; label?: string; description?: string; translations?: Array<{ locale: string; name?: string; label?: string; description?: string }> },
  machine: boolean,
): TextRow[] => [
  { locale: spec.sourceLocale, text: (spec.name ?? spec.label) as string, description: spec.description ?? null, machine: false },
  ...(spec.translations ?? []).map((t) => ({ locale: t.locale, text: (t.name ?? t.label) as string, description: t.description ?? null, machine })),
];

async function updateList(trx: Trx, req: SeedApplyRequest, ctx: EventContext, plan: Extract<ListPlan, { kind: 'update' }>): Promise<SeedListResult> {
  const { spec, row } = plan;
  const listId = row.id;
  const result = emptyResult(spec.key, listId, 'unchanged', { itemsSkipped: plan.itemsSkipped });
  let changed = false;

  if (plan.listChanged) {
    changed = true;
    const before = await readList(trx, listId);
    await trx('selection_lists').where({ id: listId }).update({
      source_locale: spec.sourceLocale,
      status: 'active',
      updated_at: trx.fn.now(),
      seed_version: req.pack.version,
      seed_hash: hashListContent(listSeedContent(req, spec, 'active')),
    });
    const t = await syncTranslations(trx, 'list', listId, spec.sourceLocale, textRows(spec, isMachinePack(req)), spec.name, spec.description ?? null);
    await emitListChanged(trx, ctx, listId, before);
    for (const locale of t.upserted) await emitListTranslationUpserted(trx, ctx, listId, locale);
    for (const locale of t.deleted) await emitTranslationDeleted(trx, ctx, listId, locale);
  } else if (plan.listMachineChanged) {
    // The list's own content is unchanged; only the machine translations moved (no list.updated event).
    changed = true;
    const t = await syncTranslations(trx, 'list', listId, spec.sourceLocale, textRows(spec, true), spec.name, spec.description ?? null);
    for (const locale of t.upserted) await emitListTranslationUpserted(trx, ctx, listId, locale);
    for (const locale of t.deleted) await emitTranslationDeleted(trx, ctx, listId, locale);
  }

  for (const op of plan.itemOps) {
    if (op.kind === 'flag') {
      await trx('selection_list_items').where({ id: op.row.id }).update({ seed_user_modified: true }); // persist the hash verdict
      continue;
    }
    changed = true;
    if (op.kind === 'create') {
      const itemId = await insertItem(trx, listId, spec, op.spec, op.sortOrder, req);
      await emitItemCreated(trx, ctx, listId, itemId);
      for (const t of op.spec.translations ?? []) await emitItemTranslationUpserted(trx, ctx, listId, itemId, t.locale);
      result.itemsCreated++;
    } else if (op.kind === 'update') {
      const before = await readItem(trx, op.row.id);
      if (!op.translationsOnly) {
        await trx('selection_list_items').where({ id: op.row.id }).update({
          status: 'active',
          updated_at: trx.fn.now(),
          seed_version: req.pack.version,
          seed_hash: hashItemContent(itemSeedContent(req, op.spec, 'active')),
        });
      }
      const t = await syncTranslations(
        trx,
        'item',
        op.row.id,
        spec.sourceLocale,
        textRows({ sourceLocale: spec.sourceLocale, label: op.spec.label, description: op.spec.description, translations: op.spec.translations }, isMachinePack(req)),
        op.spec.label,
        op.spec.description ?? null,
      );
      if (!op.translationsOnly) await emitItemChanged(trx, ctx, listId, op.row.id, before);
      for (const locale of t.upserted) await emitItemTranslationUpserted(trx, ctx, listId, op.row.id, locale);
      for (const locale of t.deleted) await emitTranslationDeleted(trx, ctx, listId, locale, { itemId: op.row.id, itemCode: op.row.code });
      result.itemsUpdated++;
    } else {
      const before = await readItem(trx, op.row.id);
      await trx('selection_list_items').where({ id: op.row.id }).update({
        status: 'archived',
        updated_at: trx.fn.now(),
        seed_hash: hashItemContent({ ...op.current, status: 'archived' }),
      });
      await emitItemChanged(trx, ctx, listId, op.row.id, before);
      result.itemsArchived++;
    }
  }

  if (changed) {
    result.action = 'updated';
    await audit(trx, req, listId, spec.key, 'seed.upgraded');
  }
  return result;
}

async function archiveList(trx: Trx, req: SeedApplyRequest, ctx: EventContext, plan: Extract<ListPlan, { kind: 'archive' }>): Promise<SeedListResult> {
  const listId = plan.row.id;
  const before = await readList(trx, listId);
  await trx('selection_lists').where({ id: listId }).update({
    status: 'archived',
    updated_at: trx.fn.now(),
    seed_hash: hashListContent({ ...plan.current, status: 'archived' }),
  });
  await emitListChanged(trx, ctx, listId, before);
  await audit(trx, req, listId, plan.key, 'seed.archived');
  return emptyResult(plan.key, listId, 'archived');
}

// ---------------------------------------------------------------------------

function isTransient(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === '40001' || code === '40P01'; // serialization_failure, deadlock_detected
}

/** Exposed for tests/diagnostics: the canonical form the content hash is taken over. */
export const canonicalPackContent = (lists: SelectionListSeedListSpecV1[]): string => canonicalJson(lists);
