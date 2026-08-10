// items.ts — SelectionListItem CRUD routes (S4 — FFRNT-187).
//
// All routes require a valid JWT (authMiddleware upstream).
// All DB queries are scoped to req.orgId via the parent list — never cross-org.
//
// TODO(S7): add permit.check() before each mutating operation.
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

import { Router, Request, Response } from 'express';
import { db } from '../db';
import { mintId } from '@izzywdev/fuzefront-identity';
import { isSelectionListsEnabled } from '../flags';
import { enforceItemQuota } from '../middleware/quota';

const router = Router();

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const SUPPORTED_LOCALES = new Set([
  'en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'ja', 'zh',
]);

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
  label: string | null;
  description: string | null;
  resolved_locale: string | null;
  is_machine: boolean | null;
}

function formatItem(row: ItemRow) {
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
    created_by: row.created_by,
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
  listId: string,
  orgId: string,
): Promise<string | null> {
  const result = await db.raw<{ rows: [{ source_locale: string }] }>(
    `SELECT source_locale FROM selection_lists WHERE id = ? AND organization_id = ?`,
    [listId, orgId],
  );
  return result.rows[0]?.source_locale ?? null;
}

// ─── GET /:listId/items ───────────────────────────────────────────────────────

router.get('/:listId/items', async (req: Request, res: Response): Promise<void> => {
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  // TODO(S7): permit.check({ user: req.userId, action: 'read', resource: 'SelectionList', resourceInstance: req.params.listId })

  const { listId } = req.params;

  // Verify the list exists and belongs to this org
  const sourceLocale = await getListSourceLocale(listId, req.orgId);
  if (!sourceLocale) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
    return;
  }

  // Parse + clamp pagination
  const rawLimit = parseInt(String(req.query.limit ?? DEFAULT_PAGE_SIZE), 10);
  const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_PAGE_SIZE : Math.min(rawLimit, MAX_PAGE_SIZE);

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
  const whereParams: unknown[] = [listId, statusFilter];

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

    res.status(200).json({
      items: items.map(formatItem),
      page: {
        nextCursor,
        hasMore,
        total,
      },
    });
  } catch (err) {
    console.error('[items] GET /:listId/items error:', err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── POST /:listId/items — create an item ────────────────────────────────────

router.post('/:listId/items', enforceItemQuota, async (req: Request, res: Response): Promise<void> => {
  // Flag + orgId already checked by enforceItemQuota

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  // TODO(S7): permit.check({ user: req.userId, action: 'add_value', resource: 'SelectionList', resourceInstance: req.params.listId })

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
  if (!label || typeof label !== 'string' || label.trim().length === 0) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'label is required.' });
    return;
  }
  if (label.length > 200) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'label must be ≤ 200 characters.' });
    return;
  }

  // Verify the list exists and belongs to this org
  const sourceLocale = await getListSourceLocale(listId, req.orgId);
  if (!sourceLocale) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
    return;
  }

  // Determine sort_order: explicit or max+100
  let resolvedSortOrder: number;
  if (sort_order !== undefined) {
    resolvedSortOrder = parseInt(String(sort_order), 10);
    if (isNaN(resolvedSortOrder) || resolvedSortOrder < 0) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'sort_order must be a non-negative integer.' });
      return;
    }
  } else {
    // Append: max(sort_order) + 100, or 100 if empty
    const maxResult = await db.raw<{ rows: [{ max_order: string | null }] }>(
      `SELECT MAX(sort_order) AS max_order FROM selection_list_items WHERE list_id = ?`,
      [listId],
    );
    const maxOrder = maxResult.rows[0]?.max_order;
    resolvedSortOrder = maxOrder !== null && maxOrder !== undefined ? parseInt(String(maxOrder), 10) + 100 : 100;
  }

  // Mint the id — never accept one from the client
  const id = mintId('selectionListItem');

  try {
    await db.transaction(async (trx) => {
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

    res.status(201).json(formatItem(result.rows[0]));
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg?.code === '23505') {
      res.status(409).json({ code: 'CONFLICT', message: `An item with code '${code}' already exists in this list.` });
      return;
    }
    console.error('[items] POST /:listId/items error:', err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── PUT /:listId/items/reorder — whole-collection reorder ───────────────────
// MUST be declared before /:listId/items/:itemId to prevent "reorder" matching as itemId

router.put('/:listId/items/reorder', async (req: Request, res: Response): Promise<void> => {
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  // TODO(S7): permit.check({ user: req.userId, action: 'edit', resource: 'SelectionList', resourceInstance: req.params.listId })

  const { listId } = req.params;
  const { item_ids } = req.body ?? {};

  if (!Array.isArray(item_ids) || item_ids.length === 0) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'item_ids must be a non-empty array.' });
    return;
  }

  // Verify list exists + org scope
  const sourceLocale = await getListSourceLocale(listId, req.orgId);
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
      for (let i = 0; i < item_ids.length; i++) {
        await trx.raw(
          `UPDATE selection_list_items SET sort_order = ?, updated_at = now() WHERE id = ?`,
          [(i + 1) * 100, item_ids[i]],
        );
      }
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

    res.status(200).json({ items: result.rows.map(formatItem) });
  } catch (err) {
    console.error('[items] PUT /:listId/items/reorder error:', err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── PATCH /:listId/items/:itemId — partial update ───────────────────────────

router.patch('/:listId/items/:itemId', async (req: Request, res: Response): Promise<void> => {
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  // TODO(S7): permit.check({ user: req.userId, action: 'edit', resource: 'SelectionList', resourceInstance: req.params.listId })

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
  if (body.sort_order !== undefined) {
    const so = parseInt(String(body.sort_order), 10);
    if (isNaN(so) || so < 0) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'sort_order must be a non-negative integer.' });
      return;
    }
  }

  // Verify list exists + org scope
  const sourceLocale = await getListSourceLocale(listId, req.orgId);
  if (!sourceLocale) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
    return;
  }

  try {
    // Verify item exists and belongs to this list
    const existing = await db.raw<{ rows: [{ id: string }] }>(
      `SELECT id FROM selection_list_items WHERE id = ? AND list_id = ?`,
      [itemId, listId],
    );
    if (!existing.rows[0]) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list item not found.' });
      return;
    }

    await db.transaction(async (trx) => {
      // Update item row for scalar fields
      const itemUpdates: Record<string, unknown> = { updated_at: new Date() };
      if (body.sort_order !== undefined) itemUpdates.sort_order = parseInt(String(body.sort_order), 10);
      if (body.status !== undefined) itemUpdates.status = body.status;

      if (Object.keys(itemUpdates).length > 1) {
        const setClause = Object.keys(itemUpdates).map((k) => `${k} = ?`).join(', ');
        await trx.raw(
          `UPDATE selection_list_items SET ${setClause} WHERE id = ?`,
          [...Object.values(itemUpdates), itemId],
        );
      }

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
                description = CASE WHEN ? IS NOT NULL THEN ? ELSE selection_list_item_translations.description END,
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
    });

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

    res.status(200).json(formatItem(result.rows[0]));
  } catch (err) {
    console.error('[items] PATCH /:listId/items/:itemId error:', err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── DELETE /:listId/items/:itemId — archive or purge ────────────────────────

router.delete('/:listId/items/:itemId', async (req: Request, res: Response): Promise<void> => {
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  // TODO(S7): permit.check({ user: req.userId, action: 'delete', resource: 'SelectionList', resourceInstance: req.params.listId })

  const { listId, itemId } = req.params;
  const purge = req.query.purge === 'true';

  // Verify list exists + org scope
  const sourceLocale = await getListSourceLocale(listId, req.orgId);
  if (!sourceLocale) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
    return;
  }

  try {
    const existing = await db.raw<{ rows: [{ id: string }] }>(
      `SELECT id FROM selection_list_items WHERE id = ? AND list_id = ?`,
      [itemId, listId],
    );
    if (!existing.rows[0]) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list item not found.' });
      return;
    }

    if (purge) {
      await db.transaction(async (trx) => {
        await trx.raw(
          `DELETE FROM selection_list_item_translations WHERE item_id = ?`,
          [itemId],
        );
        await trx.raw(`DELETE FROM selection_list_items WHERE id = ?`, [itemId]);
      });
      res.status(204).send();
    } else {
      // Soft delete: archive
      await db.raw(
        `UPDATE selection_list_items SET status = 'archived', updated_at = now() WHERE id = ?`,
        [itemId],
      );

      const result = await db.raw<{ rows: ItemRow[] }>(
        `
        SELECT
          i.id,
          i.list_id,
          i.code,
          i.sort_order,
          i.status,
          i.created_by,
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
      res.status(200).json(formatItem(result.rows[0]));
    }
  } catch (err) {
    console.error('[items] DELETE /:listId/items/:itemId error:', err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── POST /:listId/items/:itemId/archive — explicit archive ──────────────────

router.post('/:listId/items/:itemId/archive', async (req: Request, res: Response): Promise<void> => {
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  // TODO(S7): permit.check({ user: req.userId, action: 'delete', resource: 'SelectionList', resourceInstance: req.params.listId })

  const { listId, itemId } = req.params;

  // Verify list exists + org scope
  const sourceLocale = await getListSourceLocale(listId, req.orgId);
  if (!sourceLocale) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
    return;
  }

  try {
    const existing = await db.raw<{ rows: [{ id: string }] }>(
      `SELECT id FROM selection_list_items WHERE id = ? AND list_id = ?`,
      [itemId, listId],
    );
    if (!existing.rows[0]) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list item not found.' });
      return;
    }

    await db.raw(
      `UPDATE selection_list_items SET status = 'archived', updated_at = now() WHERE id = ?`,
      [itemId],
    );

    const result = await db.raw<{ rows: ItemRow[] }>(
      `
      SELECT
        i.id,
        i.list_id,
        i.code,
        i.sort_order,
        i.status,
        i.created_by,
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

    res.status(200).json(formatItem(result.rows[0]));
  } catch (err) {
    console.error('[items] POST /:listId/items/:itemId/archive error:', err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

export default router;
