// quota.service.ts — Full quota resolution and enforcement (S6 / FFRNT-189).
//
// Replaces the S3 placeholder with real DB-backed quota resolution,
// enforcement helpers, and a usage reporter.
//
// Resolution order for every ceiling:
//   1. Per-org override row in `selection_list_org_quota` (NULL = use default).
//   2. Platform defaults (constants below).
//
// Quota is a SOFT LIMIT: checkListQuota / checkItemQuota are called BEFORE the
// INSERT, but the check and INSERT are NOT wrapped in a transaction. Minor
// overshoot under concurrent load is acceptable — the ceiling is a business
// guardrail, not an invariant.
//
// All counts are over NON-ARCHIVED rows only (status = 'active'). Archived
// lists/items do not consume quota so orgs can rotate rather than be locked out.

import { db } from '../db';

// ─── Platform defaults ────────────────────────────────────────────────────────

export const DEFAULT_MAX_LISTS = 100;
export const DEFAULT_MAX_LISTS_PER_USER = 20;
export const DEFAULT_MAX_ITEMS_PER_LIST = 500;
export const DEFAULT_MAX_LOCALES = 11; // matches the supported locale set in i18n.languages.json

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

async function countRows(table: string, where: Record<string, unknown>): Promise<number> {
  // Knex count() returns Dict<string|number>; cast via any to read the alias.
  const result = await (db(table).where(where).count('id as count').first() as Promise<any>);
  return parseInt(String(result?.count ?? '0'), 10);
}

// ─── Public functions ─────────────────────────────────────────────────────────

/**
 * Resolve the effective quota ceilings for an org.
 *
 * Reads from `selection_list_org_quota` and falls back to the platform defaults
 * for any ceiling that has no per-org override (NULL in the DB row, or no row).
 */
export async function getQuota(orgId: string): Promise<QuotaLimits> {
  const row: OrgQuotaRow | undefined = await db('selection_list_org_quota')
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
 * Guard: throws `QuotaExceededError` when the org has reached its `org_lists`
 * ceiling (count of non-archived selection lists).
 *
 * Call BEFORE inserting a new selection list. Not transactional (soft limit).
 */
export async function checkListQuota(orgId: string): Promise<void> {
  const quota = await getQuota(orgId);
  const current = await countRows('selection_lists', { organization_id: orgId, status: 'active' });

  if (current >= quota.maxLists) {
    throw new QuotaExceededError('org_lists', current, quota.maxLists, 'lists');
  }
}

/**
 * Guard: throws `QuotaExceededError` when the list has reached its `list_items`
 * ceiling (count of non-archived items in the list).
 *
 * Call BEFORE inserting a new item. Not transactional (soft limit).
 */
export async function checkItemQuota(listId: string, orgId: string): Promise<void> {
  const quota = await getQuota(orgId);
  const current = await countRows('selection_list_items', { list_id: listId, status: 'active' });

  if (current >= quota.maxItemsPerList) {
    throw new QuotaExceededError('list_items', current, quota.maxItemsPerList, 'items');
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
