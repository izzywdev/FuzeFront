// listShape.ts — the wire shape of a SelectionList (openapi `SelectionList`, 4.1.0), shared by the list
// routes and the fork route.
//
// 4.1.0 fields (`visibility`, `forked_from`, `editable`): always emitted by the implementation. They are real
// only while the release flag `fuzefront.selection-lists.shared-lists` is ON; OFF reports the 4.0.0 state of
// every list (visibility "private", forked_from null) and omits the `editable` hint (= unknown, which the
// contract tells clients to read as "behave as at 4.0.0").

import type { Request } from 'express';
import { isVisibility, sameOrg, sharedListsOn } from '../lib/sharedLists';
import { editableIds } from '../services/sharedReads';

export interface ListRow {
  id: string;
  organization_id: string;
  key: string;
  source_locale: string;
  status: string;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
  seed_source?: string | null;
  seed_key?: string | null;
  seed_version?: number | string | null;
  seed_user_modified?: boolean | null;
  visibility?: string | null;
  forked_from_list_id?: string | null;
  forked_from_org_id?: string | null;
  forked_from_revision?: number | string | null;
  forked_at?: Date | string | null;
  name: string | null;
  description: string | null;
  resolved_locale: string | null;
  is_machine: boolean | null;
  item_count?: number | string | null;
}

/** The `selection_lists` columns every list response needs (4.1.0 adds visibility + fork provenance). */
export const LIST_COLUMNS = `
        sl.id,
        sl.organization_id,
        sl.key,
        sl.source_locale,
        sl.status,
        sl.created_by,
        sl.seed_source, sl.seed_key, sl.seed_version, sl.seed_user_modified,
        sl.visibility, sl.forked_from_list_id, sl.forked_from_org_id, sl.forked_from_revision, sl.forked_at,
        sl.created_at,
        sl.updated_at,`;

/**
 * openapi `SeedProvenance`: `null` for a user-authored row (seed_source IS NULL), else where the
 * row came from. Read-only; the columns are written only by the seed algorithm and by the
 * user-edit paths (`refreshListUserModified`).
 */
function formatSeed(row: ListRow) {
  if (row.seed_source === null || row.seed_source === undefined) return null;
  return {
    source: row.seed_source,
    pack_key: row.seed_key as string,
    pack_version: Number(row.seed_version),
    user_modified: Boolean(row.seed_user_modified),
  };
}

const isoOf = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/** openapi `SelectionListForkProvenance`, or null for a list that is not a fork. */
function formatForkedFrom(row: ListRow) {
  if (!row.forked_from_list_id) return null;
  return {
    list_id: row.forked_from_list_id,
    organization_id: row.forked_from_org_id as string,
    revision: Number(row.forked_from_revision),
    forked_at: isoOf(row.forked_at as Date | string),
  };
}

/** How a response is shaped: the 4.1.0 fields are real only when the shared-lists flag is ON. */
export interface FormatCtx {
  /** The shared-lists flag is ON: report the stored visibility / provenance. OFF: the 4.0.0 defaults. */
  shared: boolean;
  /** The caller-relative `editable` hint; omitted (= "unknown", the contract's 4.0.0 reading) when undefined. */
  editable?: boolean;
  /**
   * The caller's organization. A list of ANOTHER organization (a common list) renders `created_by` as the
   * system principal `system:platform` rather than leaking that organization's user ids to every tenant.
   */
  callerOrgId?: string;
}

/** `created_by` shown for a list owned by another organization. A valid AuthorPrincipal (`^system:[a-z0-9-]+$`). */
export const FOREIGN_AUTHOR = 'system:platform';

export function formatList(row: ListRow, ctx: FormatCtx = { shared: false }) {
  return {
    id: row.id,
    organization_id: row.organization_id,
    key: row.key,
    source_locale: row.source_locale,
    status: row.status,
    name: row.name ?? '',
    description: row.description ?? null,
    resolved_locale: row.resolved_locale ?? row.source_locale,
    is_machine: row.is_machine ?? false,
    item_count: row.item_count !== undefined && row.item_count !== null
      ? Number(row.item_count)
      : undefined,
    created_by: ctx.callerOrgId !== undefined && !sameOrg(row.organization_id, ctx.callerOrgId) ? FOREIGN_AUTHOR : row.created_by,
    seed: formatSeed(row),
    // 4.1.0: always emitted. Flag OFF = the 4.0.0 state of every list (private, not a fork).
    visibility: ctx.shared && isVisibility(row.visibility) ? row.visibility : 'private',
    forked_from: ctx.shared ? formatForkedFrom(row) : null,
    ...(ctx.editable !== undefined ? { editable: ctx.editable } : {}),
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : row.created_at,
    updated_at: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : row.updated_at,
  };
}

/**
 * `FormatCtx` for ONE list the caller just fetched or mutated: flag OFF -> 4.0.0 shape (no hint); flag ON ->
 * `editable` per the caller's roles (`knownEditable` when the handler already knows, e.g. after a mutation
 * only a write-role holder can make).
 */
export async function singleCtx(req: Request, row: ListRow, knownEditable?: boolean): Promise<FormatCtx> {
  const shared = await sharedListsOn(req);
  if (!shared) return { shared: false };
  if (knownEditable !== undefined) return { shared, editable: knownEditable, callerOrgId: req.orgId };
  return { shared, editable: (await editableIds(req, [row])).has(row.id), callerOrgId: req.orgId };
}
