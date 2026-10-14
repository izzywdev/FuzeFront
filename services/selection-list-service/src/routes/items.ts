// items.ts — SelectionListItem CRUD routes (S4 — FFRNT-187).
//
// All routes require a valid JWT (authMiddleware upstream).
// All DB queries are scoped to req.orgId via the parent list — never cross-org.
//
// Authorization: every route carries requireAuthzCheck per the contract x-permit-action.
//
// Pagination: cursor-based (opaque base64url JSON cursor), sort_order ASC.
//   DEFAULT_PAGE_SIZE = 50, MAX_PAGE_SIZE = 200.
//   Cursor encodes { sortOrder: number, id: string }.
//
// Locale fallback chain:
//   1. ?locale query param (if valid and supplied)
//   2. Accept-Language header best-match
//   3. list's source_locale
//   4. 'en' (last-resort)
//
// IMPORTANT: route /:listId/items/reorder MUST be declared BEFORE
// /:listId/items/:itemId so Express does not match "reorder" as an itemId.

import { Request, Response } from 'express';
import { createRouter } from '../lib/http';
import { acceptOnlyBodyProps, isItemId, parseLimitParam, registerIdParams } from '../middleware/validateInput';
import { getLog } from '../lib/logger';
import { db } from '../db';
import { ENTITY_PREFIXES, mintId } from '@izzywdev/fuzefront-identity';
import { requireAuthzCheckWhen } from '../middleware/authz';
import {
  assertMayPurgeLocked,
  PLATFORM_PURGE_DENIED_BODY,
  PlatformPurgeDenied,
  requireListMutation,
  requireListRead,
  requirePublishForPlatformList,
} from '../middleware/listAccess';
import { orgIs, sameOrg, sharedListsOn, writeOrgs } from '../lib/sharedLists';
import { getReadScope, readableByOrg } from '../services/sharedReads';
import { isSelectionListsEnabled } from '../flags';
import { enforceItemQuota, sendQuotaExceeded } from '../middleware/quota';
import { lockQuotaScope, checkItemQuota, checkActiveItemQuota, QuotaExceededError } from '../services/quota.service';
import { lockOrgOutbox } from '../events/outbox';
import { refreshItemUserModified } from '../seed/content';
import {
  eventContextFromRequest,
  emitItemChanged,
  emitItemCreated,
  emitItemDeleted,
  emitItemReordered,
  readItem,
} from '../events/emitters';

const router = createRouter();
registerIdParams(router);

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
/** SelectionListItemReorder.item_ids maxItems. */
const REORDER_MAX_IDS = 5000;

// Must equal the openapi `Locale` enum / i18n.languages.json (and the Zod
// `SELECTION_LIST_LOCALES` the published events validate against).
const SUPPORTED_LOCALES = new Set([
  'en', 'es', 'fr', 'de', 'pt', 'ru', 'zh', 'ja', 'hi', 'ar', 'he',
]);

// openapi SelectionListItemCode (the event schemas use the same rule).
const ITEM_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const DESCRIPTION_MAX = 2000;

// ─── Pagination helpers ───────────────────────────────────────────────────────

interface ItemCursor {
  sortOrder: number;
  id: string;
}

function encodeCursor(c: ItemCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): ItemCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed.sortOrder === 'number' &&
      typeof parsed.id === 'string'
    ) {
      return parsed as ItemCursor;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Locale helpers ───────────────────────────────────────────────────────────

function parseAcceptLanguage(header: string | undefined): string | null {
  if (!header) return null;
  const locales = header
    .split(',')
    .map((part) => {
      const [lang] = part.trim().split(';');
      return lang.split('-')[0].toLowerCase().trim();
    })
    .filter(Boolean);
  for (const locale of locales) {
    if (SUPPORTED_LOCALES.has(locale)) return locale;
  }
  return null;
}

function resolveLocaleChain(
  queryLocale: string | undefined,
  acceptLang: string | undefined,
  sourceLocale: string,
): string[] {
  const chain: string[] = [];
  if (queryLocale && SUPPORTED_LOCALES.has(queryLocale)) chain.push(queryLocale);
  const al = parseAcceptLanguage(acceptLang);
  if (al && !chain.includes(al)) chain.push(al);
  if (!chain.includes(sourceLocale)) chain.push(sourceLocale);
  if (!chain.includes('en')) chain.push('en');
  return chain;
}

// ─── Hash helper ─────────────────────────────────────────────────────────────

function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return hash.toString(16);
}

/** `created_by` shown for rows of another organization's list (never that organization's user ids). */
const FOREIGN_AUTHOR = 'system:platform';

// ─── Row formatter ────────────────────────────────────────────────────────────

interface ItemRow {
  id: string;
  list_id: string;
  code: string;
  sort_order: number | string;
  status: string;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
  seed_source?: string | null;
  seed_key?: string | null;
  seed_version?: number | string | null;
  seed_user_modified?: boolean | null;
  origin_item_id?: string | null;
  label: string | null;
  description: string | null;
  resolved_locale: string | null;
  is_machine: boolean | null;
}

/** openapi `SeedProvenance`: `null` for a user-authored row, else where the row came from. */
function formatSeed(row: ItemRow) {
  if (row.seed_source === null || row.seed_source === undefined) return null;
  return {
    source: row.seed_source,
    pack_key: row.seed_key as string,
    pack_version: Number(row.seed_version),
    user_modified: Boolean(row.seed_user_modified),
  };
}

/**
 * `shared`: the shared-lists flag is ON, so `origin_item_id` is the stored provenance; OFF reports null (4.0.0).
 * `foreign`: the item belongs to a list of ANOTHER organization (a common list read through visibility): its
 * author is that organization's business, so `created_by` is rendered as the system principal `system:platform`
 * (a valid AuthorPrincipal) instead of leaking the platform operator's user id to every tenant.
 */
function formatItem(row: ItemRow, shared = false, foreign = false) {
  return {
    id: row.id,
    list_id: row.list_id,
    code: row.code,
    sort_order: Number(row.sort_order),
    status: row.status,
    label: row.label ?? '',
    description: row.description ?? null,
    resolved_locale: row.resolved_locale ?? 'en',
    is_machine: row.is_machine ?? false,
    created_by: foreign ? FOREIGN_AUTHOR : row.created_by,
    seed: formatSeed(row),
    origin_item_id: shared ? (row.origin_item_id ?? null) : null,
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : row.created_at,
    updated_at: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : row.updated_at,
  };
}

// ─── DB helper: get list source_locale + org check ───────────────────────────

async function getListSourceLocale(
  req: Request,
  listId: string,
  orgId: string,
): Promise<string | null> {
  const scope = orgIs('organization_id', orgId, await writeOrgs(req));
  const result = await db.raw<{ rows: [{ source_locale: string }] }>(
    `SELECT source_locale FROM selection_lists WHERE id = ? AND ${scope.sql}`,
    [listId, ...scope.params],
  );
  return result.rows[0]?.source_locale ?? null;
}

/**
 * Source locale of a list the caller may READ: its own organization's, or (shared-lists flag ON) a common
 * list. The route guard (`requireListRead`) has already decided Permit-side readability.
 */
async function getReadableListSourceLocale(
  req: Request,
  listId: string,
  orgId: string,
): Promise<{ sourceLocale: string; foreign: boolean } | null> {
  const readable = readableByOrg('', orgId, await getReadScope(req));
  const result = await db.raw<{ rows: [{ source_locale: string; organization_id?: string }] }>(
    `SELECT source_locale, organization_id FROM selection_lists WHERE id = ? AND ${readable.sql}`,
    [listId, ...readable.params],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { sourceLocale: row.source_locale, foreign: row.organization_id !== undefined && !sameOrg(row.organization_id, orgId) };
}

// ─── GET /:listId/items ───────────────────────────────────────────────────────

router.get('/:listId/items', requireListRead(), async (req: Request, res: Response): Promise<void> => {
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  const { listId } = req.params;

  // Verify the list exists and is readable by this org (its own, or a common list)
  const readableList = await getReadableListSourceLocale(req, listId, req.orgId);
  if (!readableList) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
    return;
  }
  const { sourceLocale, foreign } = readableList;

  // Parse + clamp pagination
  const limit = parseLimitParam(req, res, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  if (limit === undefined) return;

  const rawCursor = req.query.cursor as string | undefined;
  const statusFilter = (req.query.status as string) ?? 'active';

  if (!['active', 'archived'].includes(statusFilter)) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'status must be active or archived.' });
    return;
  }

  let cursor: ItemCursor | null = null;
  if (rawCursor) {
    cursor = decodeCursor(rawCursor);
    if (!cursor) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid pagination cursor.' });
      return;
    }
  }

  // Build locale chain
  const queryLocale = req.query.locale as string | undefined;
  const acceptLang = req.headers['accept-language'] as string | undefined;
  const localeChain = resolveLocaleChain(queryLocale, acceptLang, sourceLocale);

  const joinClauses = localeChain.map(
    (_, i) => `LEFT JOIN selection_list_item_translations t${i} ON t${i}.item_id = i.id AND t${i}.locale = ?`,
  );
  const labelCoalesce = `COALESCE(${localeChain.map((_, i) => `t${i}.label`).join(', ')})`;
  const descCoalesce = `COALESCE(${localeChain.map((_, i) => `t${i}.description`).join(', ')})`;
  const localeCoalesce = `COALESCE(${localeChain.map((_, i) => `t${i}.locale`).join(', ')})`;
  const machineCoalesce = `COALESCE(${localeChain.map((_, i) => `t${i}.is_machine`).join(', ')})`;

  const whereClause: string[] = ['i.list_id = ?', 'i.status = ?'];
  const whereParams: (string | number | boolean | null)[] = [listId, statusFilter];

  if (cursor) {
    whereClause.push('(i.sort_order > ? OR (i.sort_order = ? AND i.id > ?))');
    whereParams.push(cursor.sortOrder, cursor.sortOrder, cursor.id);
  }

  try {
    const result = await db.raw<{ rows: ItemRow[] }>(
      `
      SELECT
        i.id,
        i.list_id,
        i.code,
        i.sort_order,
        i.status,
        i.created_by,
        i.seed_source, i.seed_key, i.seed_version, i.seed_user_modified, i.origin_item_id,
        i.created_at,
        i.updated_at,
        ${labelCoalesce} AS label,
        ${descCoalesce} AS description,
        ${localeCoalesce} AS resolved_locale,
        ${machineCoalesce} AS is_machine
      FROM selection_list_items i
      ${joinClauses.join('\n      ')}
      WHERE ${whereClause.join(' AND ')}
      ORDER BY i.sort_order ASC, i.id ASC
      LIMIT ?
      `,
      [...localeChain, ...whereParams, limit + 1],
    );

    const rows = result.rows;
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({
        sortOrder: Number(last.sort_order),
        id: last.id,
      });
    }

    const countResult = await db.raw<{ rows: [{ total: string }] }>(
      `SELECT COUNT(*) AS total FROM selection_list_items WHERE list_id = ? AND status = ?`,
      [listId, statusFilter],
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    const shared = await sharedListsOn(req);
    res.status(200).json({
      items: items.map((r) => formatItem(r, shared, foreign)),
      page: {
        nextCursor,
        hasMore,
        total,
      },
    });
  } catch (err) {
    getLog(req).error(
      { err, op: 'items GET /:listId/items error', userId: req.userId, orgId: req.orgId, params: req.params },
      'items GET /:listId/items error failed',
    );
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── POST /:listId/items — create an item ────────────────────────────────────

router.post('/:listId/items', requireListMutation('add_value'), enforceItemQuota, async (req: Request, res: Response): Promise<void> => {
  // Flag is also checked by enforceItemQuota, but we re-check here so that tests
  // which mock the middleware as a pass-through still see the correct 404 behavior.
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  const { listId } = req.params;
  const body = req.body ?? {};

  // Reject unknown properties (additionalProperties: false in schema)
  const allowedProps = new Set(['code', 'label', 'description', 'sort_order']);
  const unknownProps = Object.keys(body).filter((k) => !allowedProps.has(k));
  if (unknownProps.length > 0) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: `Unknown properties: ${unknownProps.join(', ')}`,
    });
    return;
  }

  const { code, label, description, sort_order } = body;

  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'code is required.' });
    return;
  }
  if (!ITEM_CODE_PATTERN.test(code.trim())) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'code must be 1-63 characters: letters, digits, dot, underscore or hyphen, starting with a letter or digit.',
    });
    return;
  }
  if (description !== undefined && description !== null && (typeof description !== 'string' || description.length > DESCRIPTION_MAX)) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: `description must be a string of at most ${DESCRIPTION_MAX} characters.` });
    return;
  }
  if (!label || typeof label !== 'string' || label.trim().length === 0) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'label is required.' });
    return;
  }
  if (label.length > 200) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'label must be ≤ 200 characters.' });
    return;
  }

  // Verify the list exists and belongs to this org
  const sourceLocale = await getListSourceLocale(req, listId, req.orgId);
  if (!sourceLocale) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
    return;
  }

  // Validate an explicit sort_order up front; the implicit "append" order is
  // computed inside the transaction (below) so concurrent creates cannot read
  // the same MAX().
  let explicitSortOrder: number | undefined;
  if (sort_order !== undefined) {
    // Contract: `type: integer, minimum: 0` — a numeric string or a fraction is a 400, not coerced.
    explicitSortOrder = typeof sort_order === 'number' ? sort_order : NaN;
    if (!Number.isSafeInteger(explicitSortOrder) || explicitSortOrder < 0) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'sort_order must be a non-negative integer.' });
      return;
    }
  }

  // Mint the id — never accept one from the client
  const id = mintId('selectionListItem');

  try {
    await db.transaction(async (trx) => {
      // Lock order is ALWAYS org outbox lock -> quota lock -> list row (events/outbox.ts).
      await lockOrgOutbox(trx, req.orgId as string);
      // Exact quota enforcement: serialise creates for this list, re-check the
      // ceiling under the lock, then insert (see quota.service.ts header).
      await lockQuotaScope(trx, `list_items:${listId}`);
      await checkItemQuota(listId, (await writeOrgs(req)) ?? (req.orgId as string), trx);

      let resolvedSortOrder: number;
      if (explicitSortOrder !== undefined) {
        resolvedSortOrder = explicitSortOrder;
      } else {
        // Append: max(sort_order) + 100, or 100 if empty
        const maxResult = await trx.raw<{ rows: [{ max_order: string | null }] }>(
          `SELECT MAX(sort_order) AS max_order FROM selection_list_items WHERE list_id = ?`,
          [listId],
        );
        const maxOrder = maxResult.rows[0]?.max_order;
        resolvedSortOrder =
          maxOrder !== null && maxOrder !== undefined ? parseInt(String(maxOrder), 10) + 100 : 100;
      }

      await trx.raw(
        `
        INSERT INTO selection_list_items (id, list_id, code, sort_order, status, created_by)
        VALUES (?, ?, ?, ?, 'active', ?)
        `,
        [id, listId, code.trim(), resolvedSortOrder, req.userId ?? ''],
      );

      await trx.raw(
        `
        INSERT INTO selection_list_item_translations
          (item_id, locale, label, description, source_hash, is_machine)
        VALUES (?, ?, ?, ?, ?, false)
        `,
        [
          id,
          sourceLocale,
          label.trim(),
          description?.trim() ?? null,
          hashText(label.trim()),
        ],
      );

      // Outbox, same transaction: item.created (event-carried snapshot, own revision).
      await emitItemCreated(trx, eventContextFromRequest(req), listId, id);
    });

    // Fetch the created item
    const result = await db.raw<{ rows: ItemRow[] }>(
      `
      SELECT
        i.id,
        i.list_id,
        i.code,
        i.sort_order,
        i.status,
        i.created_by,
        i.seed_source, i.seed_key, i.seed_version, i.seed_user_modified, i.origin_item_id,
        i.created_at,
        i.updated_at,
        t.label,
        t.description,
        t.locale AS resolved_locale,
        t.is_machine
      FROM selection_list_items i
      LEFT JOIN selection_list_item_translations t ON t.item_id = i.id AND t.locale = ?
      WHERE i.id = ?
      `,
      [sourceLocale, id],
    );

    res.status(201).json(formatItem(result.rows[0], await sharedListsOn(req)));
  } catch (err: unknown) {
    if (err instanceof QuotaExceededError) {
      sendQuotaExceeded(res, err);
      return;
    }
    const pg = err as { code?: string };
    if (pg?.code === '23505') {
      res.status(409).json({ code: 'CONFLICT', message: `An item with code '${code}' already exists in this list.` });
      return;
    }
    getLog(req).error(
      { err, op: 'items POST /:listId/items error', userId: req.userId, orgId: req.orgId, params: req.params },
      'items POST /:listId/items error failed',
    );
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── PUT /:listId/items/reorder — whole-collection reorder ───────────────────
// MUST be declared before /:listId/items/:itemId to prevent "reorder" matching as itemId

router.put('/:listId/items/reorder', requireListMutation('update_value'), async (req: Request, res: Response): Promise<void> => {
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  const { listId } = req.params;
  // SelectionListItemReorder: additionalProperties false (no `id`, no `organization_id`).
  if (!acceptOnlyBodyProps(req, res, ['item_ids'])) return;
  const { item_ids } = req.body ?? {};

  // item_ids: 1..5000 unique `front_sli_` ids (contract: minItems 1, maxItems 5000, uniqueItems).
  if (!Array.isArray(item_ids) || item_ids.length === 0) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'item_ids must be a non-empty array.' });
    return;
  }
  if (item_ids.length > REORDER_MAX_IDS) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: `item_ids must contain at most ${REORDER_MAX_IDS} ids.` });
    return;
  }
  if (!item_ids.every(isItemId)) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: `item_ids must all be '${ENTITY_PREFIXES.selectionListItem}_' ids.` });
    return;
  }
  if (new Set(item_ids).size !== item_ids.length) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'item_ids must not contain duplicates.' });
    return;
  }

  // Verify list exists + org scope
  const sourceLocale = await getListSourceLocale(req, listId, req.orgId);
  if (!sourceLocale) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
    return;
  }

  try {
    // Fetch current active item ids to validate the permutation
    const currentResult = await db.raw<{ rows: { id: string }[] }>(
      `SELECT id FROM selection_list_items WHERE list_id = ? AND status = 'active' ORDER BY id`,
      [listId],
    );
    const currentIds = new Set(currentResult.rows.map((r) => r.id));

    if (item_ids.length !== currentIds.size) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: `item_ids must contain exactly ${currentIds.size} items (all active items in the list).`,
      });
      return;
    }

    for (const id of item_ids) {
      if (!currentIds.has(id)) {
        res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: `Item '${id}' is not an active item in this list.`,
        });
        return;
      }
    }

    // Apply new sort_order in a transaction (100-gap convention)
    await db.transaction(async (trx) => {
      await lockOrgOutbox(trx, req.orgId as string);
      for (let i = 0; i < item_ids.length; i++) {
        await trx.raw(
          `UPDATE selection_list_items SET sort_order = ?, updated_at = now() WHERE id = ?`,
          [(i + 1) * 100, item_ids[i]],
        );
      }
      // Outbox, same transaction: item.reordered carries the full resulting order.
      await emitItemReordered(trx, eventContextFromRequest(req), listId);
    });

    // Return the reordered items with source-locale translations
    const result = await db.raw<{ rows: ItemRow[] }>(
      `
      SELECT
        i.id,
        i.list_id,
        i.code,
        i.sort_order,
        i.status,
        i.created_by,
        i.seed_source, i.seed_key, i.seed_version, i.seed_user_modified, i.origin_item_id,
        i.created_at,
        i.updated_at,
        t.label,
        t.description,
        t.locale AS resolved_locale,
        t.is_machine
      FROM selection_list_items i
      LEFT JOIN selection_list_item_translations t ON t.item_id = i.id AND t.locale = ?
      WHERE i.list_id = ? AND i.status = 'active'
      ORDER BY i.sort_order ASC, i.id ASC
      `,
      [sourceLocale, listId],
    );

    const sharedReorder = await sharedListsOn(req);
    res.status(200).json({ items: result.rows.map((r) => formatItem(r, sharedReorder)) });
  } catch (err) {
    getLog(req).error(
      { err, op: 'items PUT /:listId/items/reorder error', userId: req.userId, orgId: req.orgId, params: req.params },
      'items PUT /:listId/items/reorder error failed',
    );
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── PATCH /:listId/items/:itemId — partial update ───────────────────────────

router.patch('/:listId/items/:itemId', requireListMutation('update_value'), async (req: Request, res: Response): Promise<void> => {
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  const { listId, itemId } = req.params;
  const body = req.body ?? {};

  // code is immutable — reject it explicitly (additionalProperties: false)
  const allowedProps = new Set(['label', 'description', 'sort_order', 'status']);
  const unknownProps = Object.keys(body).filter((k) => !allowedProps.has(k));
  if (unknownProps.length > 0) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: `Unknown or immutable properties: ${unknownProps.join(', ')}. 'code' cannot be changed after creation.`,
    });
    return;
  }

  if (Object.keys(body).length === 0) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Request body must have at least one field.' });
    return;
  }

  if (body.label !== undefined && (typeof body.label !== 'string' || body.label.trim().length === 0)) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'label must be a non-empty string.' });
    return;
  }
  if (body.label !== undefined && body.label.length > 200) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'label must be ≤ 200 characters.' });
    return;
  }
  if (body.status !== undefined && !['active', 'archived'].includes(body.status)) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'status must be active or archived.' });
    return;
  }
  if (body.description !== undefined && body.description !== null && (typeof body.description !== 'string' || body.description.length > DESCRIPTION_MAX)) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: `description must be a string of at most ${DESCRIPTION_MAX} characters.` });
    return;
  }
  if (body.sort_order !== undefined) {
    const so = typeof body.sort_order === 'number' ? body.sort_order : NaN;
    if (!Number.isSafeInteger(so) || so < 0) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'sort_order must be a non-negative integer.' });
      return;
    }
  }

  // Verify list exists + org scope
  const sourceLocale = await getListSourceLocale(req, listId, req.orgId);
  if (!sourceLocale) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
    return;
  }

  try {
    const found = await db.transaction(async (trx): Promise<boolean> => {
      await lockOrgOutbox(trx, req.orgId as string);
      // Verify item exists and belongs to this list (inside the txn: it is also
      // the `before` state the event diff is taken against).
      const existing = await trx.raw<{ rows: [{ id: string; status?: string }] }>(
        `SELECT id, status FROM selection_list_items WHERE id = ? AND list_id = ? FOR NO KEY UPDATE`,
        [itemId, listId],
      );
      if (!existing.rows[0]) return false;
      const before = await readItem(trx, itemId);

      // Un-archiving raises the ACTIVE item count without any create, so it is
      // subject to `list_items` too (review M-4), under the create path's lock.
      if (body.status === 'active' && existing.rows[0].status === 'archived') {
        await lockQuotaScope(trx, `list_items:${listId}`);
        await checkActiveItemQuota(listId, (await writeOrgs(req)) ?? (req.orgId as string), trx);
      }

      // Update item row — always bump updated_at (plus any changed scalars)
      const itemUpdates: Record<string, string | number | boolean | Date | null> = { updated_at: new Date() };
      if (body.sort_order !== undefined) itemUpdates.sort_order = parseInt(String(body.sort_order), 10);
      if (body.status !== undefined) itemUpdates.status = body.status;

      const setClause = Object.keys(itemUpdates).map((k) => `${k} = ?`).join(', ');
      await trx.raw(
        `UPDATE selection_list_items SET ${setClause} WHERE id = ?`,
        [...Object.values(itemUpdates), itemId],
      );

      // Update translation for label/description
      if (body.label !== undefined || body.description !== undefined) {
        const newLabel = body.label?.trim();
        const newDesc = body.description;

        if (newLabel) {
          await trx.raw(
            `
            INSERT INTO selection_list_item_translations
              (item_id, locale, label, description, source_hash, is_machine)
            VALUES (?, ?, ?, ?, ?, false)
            ON CONFLICT (item_id, locale) DO UPDATE
            SET label = EXCLUDED.label,
                description = CASE WHEN CAST(? AS text) IS NOT NULL THEN CAST(? AS text) ELSE selection_list_item_translations.description END,
                source_hash = EXCLUDED.source_hash,
                is_machine = false,
                updated_at = now()
            `,
            [
              itemId,
              sourceLocale,
              newLabel,
              newDesc !== undefined ? newDesc : null,
              hashText(newLabel),
              newDesc !== undefined ? newDesc : null,
              newDesc !== undefined ? newDesc : null,
            ],
          );
        } else if (newDesc !== undefined) {
          await trx.raw(
            `
            UPDATE selection_list_item_translations
            SET description = ?, updated_at = now()
            WHERE item_id = ? AND locale = ?
            `,
            [newDesc, itemId, sourceLocale],
          );
        }
      }

      // A human edited this item: if it is a seeded one whose content no longer hashes to
      // `seed_hash`, persist seed_user_modified (before the emit, so the snapshot carries it).
      await refreshItemUserModified(trx, itemId);

      // Outbox, same transaction: item.updated (diffed) and/or item.archived.
      await emitItemChanged(trx, eventContextFromRequest(req), listId, itemId, before);
      return true;
    });
    if (!found) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list item not found.' });
      return;
    }

    // Return the updated item
    const result = await db.raw<{ rows: ItemRow[] }>(
      `
      SELECT
        i.id,
        i.list_id,
        i.code,
        i.sort_order,
        i.status,
        i.created_by,
        i.seed_source, i.seed_key, i.seed_version, i.seed_user_modified, i.origin_item_id,
        i.created_at,
        i.updated_at,
        t.label,
        t.description,
        t.locale AS resolved_locale,
        t.is_machine
      FROM selection_list_items i
      LEFT JOIN selection_list_item_translations t ON t.item_id = i.id AND t.locale = ?
      WHERE i.id = ?
      `,
      [sourceLocale, itemId],
    );

    res.status(200).json(formatItem(result.rows[0], await sharedListsOn(req)));
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      sendQuotaExceeded(res, err);
      return;
    }
    getLog(req).error(
      { err, op: 'items PATCH /:listId/items/:itemId error', userId: req.userId, orgId: req.orgId, params: req.params },
      'items PATCH /:listId/items/:itemId error failed',
    );
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── DELETE /:listId/items/:itemId — archive or purge ────────────────────────

// Purge is irreversible and orphans every consumer row that stores the item id,
// so it is owner-only (openapi §"Archive is the default; purge is explicit"):
// `?purge=true` additionally needs `delete` on the parent list (list-owner), on
// top of the route's base `remove_value` (which is all an archive needs).
// Review M-1.
const requireDeleteOnPurge = requireAuthzCheckWhen(
  (req) => req.query.purge === 'true',
  'SelectionList',
  'delete',
);

// Purging an item of a COMMON list additionally needs `publish_platform` (platform tenant): it turns the
// stored ids of every tenant into `missing`.
const requirePublishOnCommonPurge = requirePublishForPlatformList((req) => req.query.purge === 'true');

router.delete('/:listId/items/:itemId', requireListMutation('remove_value'), requireDeleteOnPurge, requirePublishOnCommonPurge, async (req: Request, res: Response): Promise<void> => {
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  const { listId, itemId } = req.params;
  const purge = req.query.purge === 'true';

  // Verify list exists + org scope
  const sourceLocale = await getListSourceLocale(req, listId, req.orgId);
  if (!sourceLocale) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
    return;
  }

  try {
    const found = await db.transaction(async (trx): Promise<boolean> => {
      await lockOrgOutbox(trx, req.orgId as string);
      const existing = await trx.raw<{ rows: [{ id: string; code: string }] }>(
        `SELECT id, code FROM selection_list_items WHERE id = ? AND list_id = ? FOR NO KEY UPDATE`,
        [itemId, listId],
      );
      if (!existing.rows[0]) return false;

      const ctx = eventContextFromRequest(req);
      if (purge) {
        // The pre-transaction guard decided from an earlier read of the list: re-check it under the org lock
        // (a promotion to a common list takes the same lock, so what we read now cannot change under us).
        const listRow = await trx.raw<{ rows: Array<{ visibility: string | null }> }>(`SELECT visibility FROM selection_lists WHERE id = ?`, [listId]);
        await assertMayPurgeLocked(req, listRow?.rows?.[0]?.visibility);
        await trx.raw(
          `DELETE FROM selection_list_item_translations WHERE item_id = ?`,
          [itemId],
        );
        await trx.raw(`DELETE FROM selection_list_items WHERE id = ?`, [itemId]);
        // item.deleted only: it implies the item's translations (no translation events).
        await emitItemDeleted(trx, ctx, listId, { itemId, code: existing.rows[0].code });
      } else {
        // Soft delete: archive (no event if it already was archived)
        const before = await readItem(trx, itemId);
        await trx.raw(`UPDATE selection_list_items SET status = 'archived', updated_at = now() WHERE id = ?`, [itemId]);
        await refreshItemUserModified(trx, itemId);
        await emitItemChanged(trx, ctx, listId, itemId, before);
      }
      return true;
    });
    if (!found) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list item not found.' });
      return;
    }

    if (purge) {
      res.status(204).send();
    } else {
      const result = await db.raw<{ rows: ItemRow[] }>(
        `
        SELECT
          i.id,
          i.list_id,
          i.code,
          i.sort_order,
          i.status,
          i.created_by,
          i.seed_source, i.seed_key, i.seed_version, i.seed_user_modified, i.origin_item_id,
          i.created_at,
          i.updated_at,
          t.label,
          t.description,
          t.locale AS resolved_locale,
          t.is_machine
        FROM selection_list_items i
        LEFT JOIN selection_list_item_translations t ON t.item_id = i.id AND t.locale = ?
        WHERE i.id = ?
        `,
        [sourceLocale, itemId],
      );
      res.status(200).json(formatItem(result.rows[0], await sharedListsOn(req)));
    }
  } catch (err) {
    if (err instanceof PlatformPurgeDenied) {
      res.status(403).json(PLATFORM_PURGE_DENIED_BODY);
      return;
    }
    getLog(req).error(
      { err, op: 'items DELETE /:listId/items/:itemId error', userId: req.userId, orgId: req.orgId, params: req.params },
      'items DELETE /:listId/items/:itemId error failed',
    );
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── POST /:listId/items/:itemId/archive — explicit archive ──────────────────

router.post('/:listId/items/:itemId/archive', requireListMutation('remove_value'), async (req: Request, res: Response): Promise<void> => {
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  const { listId, itemId } = req.params;

  // Verify list exists + org scope
  const sourceLocale = await getListSourceLocale(req, listId, req.orgId);
  if (!sourceLocale) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
    return;
  }

  try {
    const found = await db.transaction(async (trx): Promise<boolean> => {
      await lockOrgOutbox(trx, req.orgId as string);
      const existing = await trx.raw<{ rows: [{ id: string }] }>(
        `SELECT id FROM selection_list_items WHERE id = ? AND list_id = ? FOR NO KEY UPDATE`,
        [itemId, listId],
      );
      if (!existing.rows[0]) return false;

      const before = await readItem(trx, itemId);
      await trx.raw(`UPDATE selection_list_items SET status = 'archived', updated_at = now() WHERE id = ?`, [itemId]);
      await refreshItemUserModified(trx, itemId);
      await emitItemChanged(trx, eventContextFromRequest(req), listId, itemId, before);
      return true;
    });
    if (!found) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list item not found.' });
      return;
    }

    const result = await db.raw<{ rows: ItemRow[] }>(
      `
      SELECT
        i.id,
        i.list_id,
        i.code,
        i.sort_order,
        i.status,
        i.created_by,
        i.seed_source, i.seed_key, i.seed_version, i.seed_user_modified, i.origin_item_id,
        i.created_at,
        i.updated_at,
        t.label,
        t.description,
        t.locale AS resolved_locale,
        t.is_machine
      FROM selection_list_items i
      LEFT JOIN selection_list_item_translations t ON t.item_id = i.id AND t.locale = ?
      WHERE i.id = ?
      `,
      [sourceLocale, itemId],
    );

    res.status(200).json(formatItem(result.rows[0], await sharedListsOn(req)));
  } catch (err) {
    getLog(req).error(
      { err, op: 'items POST /:listId/items/:itemId/archive error', userId: req.userId, orgId: req.orgId, params: req.params },
      'items POST /:listId/items/:itemId/archive error failed',
    );
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

export default router;
