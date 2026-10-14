// quota.service.ts — Full quota resolution and enforcement (S6 / FFRNT-189).
//
// Replaces the S3 placeholder with real DB-backed quota resolution,
// enforcement helpers, and a usage reporter.
//
// Resolution order for every ceiling:
//   1. Per-org override row in `selection_list_org_quota` (NULL = use default).
//   2. Platform defaults (constants below).
//
// Enforcement is EXACT, not best-effort: the create handlers call
// lockQuotaScope() + checkListQuota()/checkItemQuota() INSIDE the same
// transaction as the INSERT. The advisory lock serialises concurrent creates
// for one org (lists) / one list (items), so N parallel creates at the ceiling
// admit exactly (ceiling - current) of them and refuse the rest
// (contract/quota.test.ts "advisory lock"). The pre-INSERT check in
// middleware/quota.ts remains as a cheap fast-path refusal only.
//
// The per-scope ceilings (org_lists, user_lists, list_items, list_locales) are
// counted over NON-ARCHIVED rows only (status = 'active'): archived lists/items
// do not consume them, so orgs can rotate rather than be locked out.
//
// STORAGE CEILING (review M-4). Archiving is not deleting: repeating
// archive + create would otherwise grow `selection_lists` and
// `selection_list_items` without bound while the active counts never move. So
// archived rows count toward a HARD ceiling on rows STORED, whatever their
// status: `active limit x SELECTION_LISTS_STORAGE_CEILING_FACTOR` (default 10,
// so the default org may store 1000 lists and a default list 5000 items). The
// ceiling scales with a per-org override automatically, can never fall below
// the active limit (the factor is clamped to >= 1), and is reported with the
// SAME wire shape as any other QUOTA_EXCEEDED (scope `org_lists` / `list_items`,
// limit = the ceiling) so no contract change is needed; the message says the
// stored rows include archived ones and that purging archived rows frees space.
//
// ENFORCEMENT POINTS. Creates (lists, items) check under the advisory lock;
// un-archiving (PATCH status "active" on a list or item) re-checks the ACTIVE
// ceilings, because it raises the active count without any create; adding a
// locale (PUT translation, autofill, a PATCH that writes a new source-locale
// row) checks `list_locales`.

import type { Knex } from 'knex';
import { db } from '../db';

/** Either the shared pool or an open transaction. */
type Executor = Knex | Knex.Transaction;

// ─── Platform defaults ────────────────────────────────────────────────────────

export const DEFAULT_MAX_LISTS = 100;
export const DEFAULT_MAX_LISTS_PER_USER = 20;
export const DEFAULT_MAX_ITEMS_PER_LIST = 500;
export const DEFAULT_MAX_LOCALES = 11; // matches the supported locale set in i18n.languages.json

/**
 * Default multiplier from an active ceiling to the hard storage ceiling (archived
 * rows included). Override with the SELECTION_LISTS_STORAGE_CEILING_FACTOR env
 * var (a positive integer; anything else falls back to this default).
 */
export const DEFAULT_STORAGE_CEILING_FACTOR = 10;

/** Effective storage factor. Read per call so a config change needs a restart, not a rebuild. */
export function storageCeilingFactor(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SELECTION_LISTS_STORAGE_CEILING_FACTOR;
  if (raw === undefined || raw === '') return DEFAULT_STORAGE_CEILING_FACTOR;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_STORAGE_CEILING_FACTOR;
}

// ─── QuotaLimits / QuotaResolver — kept from S3 for S4/S5 DI compat ──────────

export interface QuotaLimits {
  /** Maximum active selection lists per organization. */
  maxLists: number;
  /** Maximum active selection lists per user within the organization. */
  maxListsPerUser: number;
  /** Maximum active items per selection list. */
  maxItemsPerList: number;
  /** Maximum distinct locales per selection list. */
  maxLocales: number;
}

/** @deprecated Use the module-level `getQuota()` directly. */
export interface QuotaResolver {
  resolve(organizationId: string): Promise<QuotaLimits>;
}

/** @deprecated Retained so existing DI wiring compiles. Use `getQuota()` directly. */
export class DefaultQuotaResolver implements QuotaResolver {
  async resolve(organizationId: string): Promise<QuotaLimits> {
    return getQuota(organizationId);
  }
}

// ─── QuotaScope — mirrors OpenAPI QuotaScope enum ────────────────────────────

export type QuotaScope = 'org_lists' | 'user_lists' | 'list_items' | 'list_locales';

// ─── QuotaExceededError ───────────────────────────────────────────────────────

/**
 * Thrown when a create operation would exceed a quota ceiling.
 *
 * `scope` uses OpenAPI-aligned QuotaScope values so the quota middleware can
 * forward it directly into the wire-format QUOTA_EXCEEDED error body without
 * any translation.
 */
export class QuotaExceededError extends Error {
  constructor(
    /** Which ceiling was hit. Matches the OpenAPI QuotaScope enum. */
    public readonly scope: QuotaScope,
    /** Usage at the moment of refusal. */
    public readonly current: number,
    /** The ceiling that was enforced. */
    public readonly limit: number,
    /** Human-readable resource name used in the error message. */
    public readonly resource: string,
  ) {
    super(`Quota exceeded: ${resource} ${current}/${limit} in scope ${scope}`);
    this.name = 'QuotaExceededError';
    // Maintain correct prototype chain when TypeScript compiles classes to ES5.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface OrgQuotaRow {
  organization_id: string;
  max_lists: number | null;
  max_lists_per_user: number | null;
  max_items_per_list: number | null;
  max_locales: number | null;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function countRows(
  table: string,
  where: Record<string, unknown>,
  executor: Executor = db,
): Promise<number> {
  // Knex's count() returns Dict<string|number>; cast to any to access the alias.
  const result = await (executor(table).where(where).count('id as count').first() as Promise<any>);
  return parseInt(String(result?.count ?? '0'), 10);
}

// ─── Public functions ─────────────────────────────────────────────────────────

/**
 * Resolve the effective quota ceilings for an org.
 *
 * Reads from `selection_list_org_quota` and falls back to the platform defaults
 * for any ceiling that has no per-org override (NULL in the DB row, or no row).
 */
export async function getQuota(orgId: string, executor: Executor = db): Promise<QuotaLimits> {
  const row: OrgQuotaRow | undefined = await executor('selection_list_org_quota')
    .where({ organization_id: orgId })
    .first();

  return {
    maxLists: row?.max_lists ?? DEFAULT_MAX_LISTS,
    maxListsPerUser: row?.max_lists_per_user ?? DEFAULT_MAX_LISTS_PER_USER,
    maxItemsPerList: row?.max_items_per_list ?? DEFAULT_MAX_ITEMS_PER_LIST,
    maxLocales: row?.max_locales ?? DEFAULT_MAX_LOCALES,
  };
}

/**
 * Take a transaction-scoped advisory lock for one quota scope (e.g.
 * `org_lists:<orgId>` or `list_items:<listId>`). Released automatically at
 * COMMIT/ROLLBACK. Call FIRST inside the create transaction, then
 * checkListQuota()/checkItemQuota() with the same `trx`, then INSERT.
 */
export async function lockQuotaScope(trx: Knex.Transaction, scopeKey: string): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [scopeKey]);
}

/**
 * True when a stored `created_by` names a USER (as opposed to the platform's
 * `system:*` principal that seeds lists, or the `[deleted-user]` sentinel).
 * Only users are subject to `user_lists`.
 */
export function isUserPrincipal(createdBy: string): boolean {
  return createdBy !== '' && createdBy !== '[deleted-user]' && !createdBy.startsWith('system:');
}

/**
 * Active ceilings for creating or re-activating a list: `org_lists` (active
 * lists in the org) then, when `userId` is given, `user_lists` (active lists that
 * user created in the org). Counts ACTIVE rows only.
 */
export async function checkActiveListQuota(
  orgId: string,
  userId: string | undefined,
  executor: Executor = db,
): Promise<void> {
  const quota = await getQuota(orgId, executor);
  const current = await countRows(
    'selection_lists',
    { organization_id: orgId, status: 'active' },
    executor,
  );
  if (current >= quota.maxLists) {
    throw new QuotaExceededError('org_lists', current, quota.maxLists, 'lists');
  }

  if (userId) {
    const mine = await countRows(
      'selection_lists',
      { organization_id: orgId, created_by: userId, status: 'active' },
      executor,
    );
    if (mine >= quota.maxListsPerUser) {
      throw new QuotaExceededError('user_lists', mine, quota.maxListsPerUser, 'lists per user');
    }
  }
}

/**
 * Guard for CREATING a list: the active ceilings (`org_lists`, `user_lists`) and
 * the hard storage ceiling (every stored list, archived included; see the file
 * header). Throws `QuotaExceededError`.
 *
 * Call inside the create transaction after lockQuotaScope() (exact), or bare as
 * the middleware's fast-path pre-check.
 */
export async function checkListQuota(
  orgId: string,
  executor: Executor = db,
  userId?: string,
): Promise<void> {
  await checkActiveListQuota(orgId, userId, executor);

  const quota = await getQuota(orgId, executor);
  const ceiling = quota.maxLists * storageCeilingFactor();
  const stored = await countRows('selection_lists', { organization_id: orgId }, executor);
  if (stored >= ceiling) {
    throw new QuotaExceededError('org_lists', stored, ceiling, 'stored lists (archived included; purge archived lists to free space)');
  }
}

/**
 * Active `list_items` ceiling (non-archived items in the list). Used on its own
 * when an item is RE-ACTIVATED; item creates use `checkItemQuota`.
 */
export async function checkActiveItemQuota(
  listId: string,
  orgId: string,
  executor: Executor = db,
): Promise<void> {
  const quota = await getQuota(orgId, executor);
  const current = await countRows(
    'selection_list_items',
    { list_id: listId, status: 'active' },
    executor,
  );

  if (current >= quota.maxItemsPerList) {
    throw new QuotaExceededError('list_items', current, quota.maxItemsPerList, 'items');
  }
}

/**
 * Guard for CREATING an item: the active `list_items` ceiling plus the hard
 * storage ceiling (every stored item in the list, archived included).
 *
 * Call inside the create transaction after lockQuotaScope() (exact), or bare as
 * the middleware's fast-path pre-check.
 */
export async function checkItemQuota(
  listId: string,
  orgId: string,
  executor: Executor = db,
): Promise<void> {
  await checkActiveItemQuota(listId, orgId, executor);

  const quota = await getQuota(orgId, executor);
  const ceiling = quota.maxItemsPerList * storageCeilingFactor();
  const stored = await countRows('selection_list_items', { list_id: listId }, executor);
  if (stored >= ceiling) {
    throw new QuotaExceededError('list_items', stored, ceiling, 'stored items (archived included; purge archived items to free space)');
  }
}

/**
 * Guard for ADDING a locale to a list: `list_locales` is the number of distinct
 * locales with a list-level translation row (the source locale included). A
 * locale the list already has is an update, never refused.
 *
 * Call inside the write transaction after lockQuotaScope(`list_locales:<id>`).
 */
export async function checkLocaleQuota(
  listId: string,
  orgId: string,
  locale: string,
  executor: Executor = db,
): Promise<void> {
  const existing = await executor('selection_list_translations')
    .where({ list_id: listId, locale })
    .first('locale');
  if (existing) return;

  const quota = await getQuota(orgId, executor);
  const result = await (executor('selection_list_translations')
    .where({ list_id: listId })
    .count('* as count')
    .first() as Promise<any>);
  const current = parseInt(String(result?.count ?? '0'), 10);
  if (current >= quota.maxLocales) {
    throw new QuotaExceededError('list_locales', current, quota.maxLocales, 'locales');
  }
}

// ─── Usage reporting ─────────────────────────────────────────────────────────

export interface QuotaEntry {
  scope: QuotaScope;
  applies_to: 'organization' | 'user' | 'list';
  limit: number;
  current: number | null;
}

export interface QuotaUsage {
  organization_id: string;
  quotas: [QuotaEntry, QuotaEntry, QuotaEntry, QuotaEntry];
}

/**
 * Return the full quota status for an org, shaped as `SelectionListQuotaStatus`
 * from the OpenAPI contract.
 *
 * `list_items` and `list_locales` have `current: null` because their usage
 * depends on which specific list you ask about, not the org as a whole.
 *
 * @param orgId  The org whose quotas to report.
 * @param userId When supplied, `user_lists.current` is the count of active
 *   lists that this user created within the org.
 */
export async function getQuotaUsage(orgId: string, userId?: string): Promise<QuotaUsage> {
  const quota = await getQuota(orgId);

  const orgListsCurrent = await countRows('selection_lists', {
    organization_id: orgId,
    status: 'active',
  });

  // Count active lists created by the requesting user (0 when userId is absent).
  const userListsCurrent = userId
    ? await countRows('selection_lists', {
        organization_id: orgId,
        created_by: userId,
        status: 'active',
      })
    : 0;

  return {
    organization_id: orgId,
    quotas: [
      {
        scope: 'org_lists',
        applies_to: 'organization',
        limit: quota.maxLists,
        current: orgListsCurrent,
      },
      {
        scope: 'user_lists',
        applies_to: 'user',
        limit: quota.maxListsPerUser,
        current: userListsCurrent,
      },
      {
        // Per-list ceiling — current varies by list, null at org level.
        scope: 'list_items',
        applies_to: 'list',
        limit: quota.maxItemsPerList,
        current: null,
      },
      {
        // Per-list ceiling — current varies by list, null at org level.
        scope: 'list_locales',
        applies_to: 'list',
        limit: quota.maxLocales,
        current: null,
      },
    ],
  };
}
