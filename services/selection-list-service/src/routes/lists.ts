// lists.ts — SelectionList CRUD routes (S4 — FFRNT-187).
//
// All routes require a valid JWT (authMiddleware upstream).
// All DB queries are scoped to req.orgId — never cross-org.
//
// TODO(S7): add permit.check() before each mutating operation.
//
// Pagination: cursor-based (opaque base64url JSON cursor), newest-first.
//   DEFAULT_PAGE_SIZE = 50, MAX_PAGE_SIZE = 200.
//   Cursor encodes { createdAt: ISO string, id: string }.
//
// Locale fallback chain (per OpenAPI §55-70):
//   1. ?locale query param (if valid and supplied)
//   2. Accept-Language header best-match
//   3. source_locale of the list
//   4. 'en' (last-resort)
//
// Soft-delete (archive) vs purge:
//   DELETE /:listId           — archives (status = 'archived') by default
//   DELETE /:listId?purge=true — hard deletes the row (translations first)
//   POST   /:listId/archive   — always archives (soft-delete)

import { Router, Request, Response } from 'express';
import { db } from '../db';
import { mintId } from '@izzywdev/fuzefront-identity';
import { isSelectionListsEnabled } from '../flags';
import { enforceListQuota } from '../middleware/quota';

const router = Router();

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const SUPPORTED_LOCALES = new Set([
  'en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'ja', 'zh',
]);

// ─── Pagination helpers ───────────────────────────────────────────────────────

interface ListCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: ListCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): ListCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed.createdAt === 'string' &&
      typeof parsed.id === 'string'
    ) {
      return parsed as ListCursor;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Locale helpers ───────────────────────────────────────────────────────────

function parseAcceptLanguage(header: string | undefined): string | null {
  if (!header) return null;
  // Parse "fr-CA,fr;q=0.9,en;q=0.8" → ['fr', 'en', ...]
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
  // Simple deterministic hash for source_hash tracking (not security).
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return hash.toString(16);
}

// ─── Row formatters ───────────────────────────────────────────────────────────

interface ListRow {
  id: string;
  organization_id: string;
  key: string;
  source_locale: string;
  status: string;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
  name: string | null;
  description: string | null;
  resolved_locale: string | null;
  is_machine: boolean | null;
  item_count?: number | string | null;
}

function formatList(row: ListRow) {
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
    created_by: row.created_by,
    created_at: row.created_at instanceof Date
      ? row.created_at.toISOString()
      : row.created_at,
    updated_at: row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : row.updated_at,
  };
}

// ─── DB helper: fetch single list with locale resolution ─────────────────────

async function fetchList(
  listId: string,
  orgId: string,
  localeChain: string[],
): Promise<ListRow | null> {
  const localeParams = localeChain.map(() => '?').join(', ');
  const result = await db.raw<{ rows: ListRow[] }>(
    `
    SELECT
      sl.id,
      sl.organization_id,
      sl.key,
      sl.source_locale,
      sl.status,
      sl.created_by,
      sl.created_at,
      sl.updated_at,
      COALESCE(${localeChain.map(() => 't?.name').join(', t')}) AS name,
      COALESCE(${localeChain.map(() => 't?.description').join(', t')}) AS description,
      COALESCE(${localeChain.map(() => 't?.locale').join(', t')}) AS resolved_locale,
      COALESCE(${localeChain.map(() => 't?.is_machine').join(', t')}) AS is_machine,
      (
        SELECT COUNT(*) FROM selection_list_items
        WHERE list_id = sl.id AND status = 'active'
      ) AS item_count
    FROM selection_lists sl
    ${localeChain.map((_, i) => `LEFT JOIN selection_list_translations t${i} ON t${i}.list_id = sl.id AND t${i}.locale = ?`).join('\n      ')}
    WHERE sl.id = ? AND sl.organization_id = ?
    `,
    [...localeChain, listId, orgId],
  );
  return result.rows[0] ?? null;
}

// ─── GET / — list all selection lists ────────────────────────────────────────

router.get('/', async (req: Request, res: Response): Promise<void> => {
  // Feature flag gate
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  // TODO(S7): permit.check({ user: req.userId, action: 'read', resource: 'SelectionList' })

  // Parse + clamp pagination params
  const rawLimit = parseInt(String(req.query.limit ?? DEFAULT_PAGE_SIZE), 10);
  const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_PAGE_SIZE : Math.min(rawLimit, MAX_PAGE_SIZE);

  const rawCursor = req.query.cursor as string | undefined;
  const statusFilter = (req.query.status as string) ?? 'active';
  const keyFilter = req.query.key as string | undefined;

  // Validate status filter
  if (!['active', 'archived'].includes(statusFilter)) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'status must be one of: active, archived',
    });
    return;
  }

  // Decode cursor if supplied
  let cursor: ListCursor | null = null;
  if (rawCursor) {
    cursor = decodeCursor(rawCursor);
    if (!cursor) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Invalid pagination cursor.' });
      return;
    }
  }

  // Resolve locale chain (we don't know source_locale at query time for each row,
  // so we join fallback translations in order). For the list endpoint, use
  // a fixed fallback order and let COALESCE sort it out.
  const queryLocale = req.query.locale as string | undefined;
  const acceptLang = req.headers['accept-language'] as string | undefined;

  // Build the locale chain for the translation JOIN; source_locale varies per row.
  // We use the fallback chain with the requested locales first, then join on each.
  // The COALESCE picks the first non-null from the joins.
  const requestedLocales: string[] = [];
  if (queryLocale && SUPPORTED_LOCALES.has(queryLocale)) requestedLocales.push(queryLocale);
  const al = parseAcceptLanguage(acceptLang);
  if (al && !requestedLocales.includes(al)) requestedLocales.push(al);
  if (!requestedLocales.includes('en')) requestedLocales.push('en');

  // Build parameterized WHERE clauses
  const whereClause: string[] = ['sl.organization_id = ?'];
  const params: (string | number | boolean | null | Date)[] = [req.orgId as string];

  whereClause.push('sl.status = ?');
  params.push(statusFilter);

  if (keyFilter) {
    whereClause.push('sl.key = ?');
    params.push(keyFilter);
  }

  if (cursor) {
    whereClause.push('(sl.created_at < ? OR (sl.created_at = ? AND sl.id < ?))');
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  // Build translation JOINs - one per requested locale
  const joinClauses = requestedLocales.map(
    (_, i) => `LEFT JOIN selection_list_translations t${i} ON t${i}.list_id = sl.id AND t${i}.locale = ?`,
  );
  const joinParams = requestedLocales;

  // COALESCE across translation rows for name, description, resolved_locale, is_machine
  const nameCoalesce = requestedLocales.length > 0
    ? `COALESCE(${requestedLocales.map((_, i) => `t${i}.name`).join(', ')})`
    : 'NULL';
  const descCoalesce = requestedLocales.length > 0
    ? `COALESCE(${requestedLocales.map((_, i) => `t${i}.description`).join(', ')})`
    : 'NULL';
  const localeCoalesce = requestedLocales.length > 0
    ? `COALESCE(${requestedLocales.map((_, i) => `t${i}.locale`).join(', ')})`
    : 'NULL';
  const machineCoalesce = requestedLocales.length > 0
    ? `COALESCE(${requestedLocales.map((_, i) => `t${i}.is_machine`).join(', ')})`
    : 'NULL';

  try {
    const allParams = [...joinParams, ...params];
    const result = await db.raw<{ rows: ListRow[] }>(
      `
      SELECT
        sl.id,
        sl.organization_id,
        sl.key,
        sl.source_locale,
        sl.status,
        sl.created_by,
        sl.created_at,
        sl.updated_at,
        ${nameCoalesce} AS name,
        ${descCoalesce} AS description,
        ${localeCoalesce} AS resolved_locale,
        ${machineCoalesce} AS is_machine,
        (
          SELECT COUNT(*) FROM selection_list_items
          WHERE list_id = sl.id AND status = 'active'
        ) AS item_count
      FROM selection_lists sl
      ${joinClauses.join('\n      ')}
      WHERE ${whereClause.join(' AND ')}
      ORDER BY sl.created_at DESC, sl.id DESC
      LIMIT ?
      `,
      [...allParams, limit + 1],
    );

    const rows = result.rows;
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = encodeCursor({
        createdAt: last.created_at instanceof Date
          ? last.created_at.toISOString()
          : String(last.created_at),
        id: last.id,
      });
    }

    // Total count (for current filter, ignoring cursor/pagination)
    const countResult = await db.raw<{ rows: [{ total: string }] }>(
      `
      SELECT COUNT(*) AS total
      FROM selection_lists sl
      WHERE sl.organization_id = ? AND sl.status = ?
      ${keyFilter ? 'AND sl.key = ?' : ''}
      `,
      keyFilter ? [req.orgId, statusFilter, keyFilter] : [req.orgId, statusFilter],
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    res.status(200).json({
      items: items.map(formatList),
      page: {
        nextCursor,
        hasMore,
        total,
      },
    });
  } catch (err) {
    console.error('[lists] GET / error:', err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── POST / — create a selection list ────────────────────────────────────────

router.post('/', enforceListQuota, async (req: Request, res: Response): Promise<void> => {
  // Flag already checked by enforceListQuota middleware

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  // TODO(S7): permit.check({ user: req.userId, action: 'add_value', resource: 'SelectionList' })

  const { key, name, description, source_locale } = req.body ?? {};

  // Validate required fields and reject unknown props
  const allowedProps = new Set(['key', 'name', 'description', 'source_locale']);
  const unknownProps = Object.keys(req.body ?? {}).filter((k) => !allowedProps.has(k));
  if (unknownProps.length > 0) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: `Unknown properties: ${unknownProps.join(', ')}`,
    });
    return;
  }

  if (!key || typeof key !== 'string' || key.trim().length === 0) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'key is required.' });
    return;
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'key must be lowercase alphanumeric with hyphens/underscores.',
    });
    return;
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'name is required.' });
    return;
  }
  if (name.length > 200) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'name must be ≤ 200 characters.' });
    return;
  }

  const locale = (source_locale ?? 'en') as string;
  if (!SUPPORTED_LOCALES.has(locale)) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: `source_locale '${locale}' is not supported.`,
    });
    return;
  }

  // Mint the id — never accept one from the client (governance/identifier-standard.md §1)
  const id = mintId('selectionList');

  try {
    // Insert list row + seed source-locale translation in a transaction
    await db.transaction(async (trx) => {
      await trx.raw(
        `
        INSERT INTO selection_lists (id, organization_id, key, source_locale, status, created_by)
        VALUES (?, ?, ?, ?, 'active', ?)
        `,
        [id, req.orgId, key.trim(), locale, req.userId ?? ''],
      );

      await trx.raw(
        `
        INSERT INTO selection_list_translations (list_id, locale, name, description, source_hash, is_machine)
        VALUES (?, ?, ?, ?, ?, false)
        `,
        [
          id,
          locale,
          name.trim(),
          description?.trim() ?? null,
          hashText(name.trim()),
        ],
      );
    });

    // Fetch the newly created list (with translation) to return the canonical shape
    const listResult = await db.raw<{ rows: ListRow[] }>(
      `
      SELECT
        sl.id,
        sl.organization_id,
        sl.key,
        sl.source_locale,
        sl.status,
        sl.created_by,
        sl.created_at,
        sl.updated_at,
        t.name,
        t.description,
        t.locale AS resolved_locale,
        t.is_machine,
        0 AS item_count
      FROM selection_lists sl
      LEFT JOIN selection_list_translations t ON t.list_id = sl.id AND t.locale = sl.source_locale
      WHERE sl.id = ?
      `,
      [id],
    );

    const row = listResult.rows[0];
    if (!row) {
      res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Insert succeeded but fetch failed.' });
      return;
    }

    res.status(201).json(formatList(row));
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg?.code === '23505') {
      res.status(409).json({ code: 'CONFLICT', message: `A list with key '${key}' already exists.` });
      return;
    }
    console.error('[lists] POST / error:', err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── GET /:listId — fetch a single list ──────────────────────────────────────

router.get('/:listId', async (req: Request, res: Response): Promise<void> => {
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
  const queryLocale = req.query.locale as string | undefined;
  const acceptLang = req.headers['accept-language'] as string | undefined;

  // We need the source_locale to build the chain — do a quick fetch first
  const slResult = await db.raw<{ rows: [{ source_locale: string }] }>(
    `SELECT source_locale FROM selection_lists WHERE id = ? AND organization_id = ?`,
    [listId, req.orgId],
  );
  if (!slResult.rows[0]) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
    return;
  }

  const sourceLocale = slResult.rows[0].source_locale;
  const localeChain = resolveLocaleChain(queryLocale, acceptLang, sourceLocale);

  // Build JOIN + COALESCE for locale fallback
  const joinClauses = localeChain.map(
    (_, i) => `LEFT JOIN selection_list_translations t${i} ON t${i}.list_id = sl.id AND t${i}.locale = ?`,
  );
  const nameCoalesce = `COALESCE(${localeChain.map((_, i) => `t${i}.name`).join(', ')})`;
  const descCoalesce = `COALESCE(${localeChain.map((_, i) => `t${i}.description`).join(', ')})`;
  const localeCoalesce = `COALESCE(${localeChain.map((_, i) => `t${i}.locale`).join(', ')})`;
  const machineCoalesce = `COALESCE(${localeChain.map((_, i) => `t${i}.is_machine`).join(', ')})`;

  try {
    const result = await db.raw<{ rows: ListRow[] }>(
      `
      SELECT
        sl.id,
        sl.organization_id,
        sl.key,
        sl.source_locale,
        sl.status,
        sl.created_by,
        sl.created_at,
        sl.updated_at,
        ${nameCoalesce} AS name,
        ${descCoalesce} AS description,
        ${localeCoalesce} AS resolved_locale,
        ${machineCoalesce} AS is_machine,
        (
          SELECT COUNT(*) FROM selection_list_items
          WHERE list_id = sl.id AND status = 'active'
        ) AS item_count
      FROM selection_lists sl
      ${joinClauses.join('\n      ')}
      WHERE sl.id = ? AND sl.organization_id = ?
      `,
      [...localeChain, listId, req.orgId],
    );

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
      return;
    }

    res.status(200).json(formatList(row));
  } catch (err) {
    console.error('[lists] GET /:listId error:', err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── PATCH /:listId — partial update ─────────────────────────────────────────

router.patch('/:listId', async (req: Request, res: Response): Promise<void> => {
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
  const body = req.body ?? {};

  // Validate: reject unknown properties
  const allowedProps = new Set(['key', 'source_locale', 'status', 'name', 'description']);
  const unknownProps = Object.keys(body).filter((k) => !allowedProps.has(k));
  if (unknownProps.length > 0) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: `Unknown properties: ${unknownProps.join(', ')}`,
    });
    return;
  }

  // Validate: at least one field
  if (Object.keys(body).length === 0) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Request body must have at least one field.' });
    return;
  }

  // Field validations
  if (body.key !== undefined) {
    if (typeof body.key !== 'string' || body.key.trim().length === 0) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'key must be a non-empty string.' });
      return;
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(body.key)) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'key must be lowercase alphanumeric with hyphens/underscores.',
      });
      return;
    }
  }
  if (body.source_locale !== undefined && !SUPPORTED_LOCALES.has(body.source_locale)) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: `source_locale '${body.source_locale}' is not supported.` });
    return;
  }
  if (body.status !== undefined && !['active', 'archived'].includes(body.status)) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'status must be active or archived.' });
    return;
  }
  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length === 0)) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'name must be a non-empty string.' });
    return;
  }
  if (body.name !== undefined && body.name.length > 200) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'name must be ≤ 200 characters.' });
    return;
  }

  try {
    // Fetch the existing list row (scoped to org)
    const existing = await db.raw<{ rows: [{ id: string; source_locale: string; status: string; key: string }] }>(
      `SELECT id, source_locale, status, key FROM selection_lists WHERE id = ? AND organization_id = ?`,
      [listId, req.orgId],
    );
    if (!existing.rows[0]) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
      return;
    }

    const current = existing.rows[0];

    await db.transaction(async (trx) => {
      // Update the list row — always bump updated_at (plus any changed scalars)
      const listUpdates: Record<string, string | number | boolean | Date | null> = { updated_at: new Date() };
      if (body.key !== undefined) listUpdates.key = body.key.trim();
      if (body.source_locale !== undefined) listUpdates.source_locale = body.source_locale;
      if (body.status !== undefined) listUpdates.status = body.status;

      const setClause = Object.keys(listUpdates)
        .map((k) => `${k} = ?`)
        .join(', ');
      await trx.raw(
        `UPDATE selection_lists SET ${setClause} WHERE id = ?`,
        [...Object.values(listUpdates), listId],
      );

      // Update translation if name or description changed
      if (body.name !== undefined || body.description !== undefined) {
        const targetLocale = body.source_locale ?? current.source_locale;
        const newName = body.name?.trim();
        const newDesc = body.description !== undefined ? body.description : undefined;

        if (newName) {
          await trx.raw(
            `
            INSERT INTO selection_list_translations (list_id, locale, name, description, source_hash, is_machine)
            VALUES (?, ?, ?, ?, ?, false)
            ON CONFLICT (list_id, locale) DO UPDATE
            SET name = EXCLUDED.name,
                description = COALESCE(EXCLUDED.description, selection_list_translations.description),
                source_hash = EXCLUDED.source_hash,
                is_machine = false,
                updated_at = now()
            `,
            [
              listId,
              targetLocale,
              newName,
              newDesc !== undefined ? newDesc : null,
              hashText(newName),
            ],
          );
        } else if (newDesc !== undefined) {
          await trx.raw(
            `
            UPDATE selection_list_translations
            SET description = ?, updated_at = now()
            WHERE list_id = ? AND locale = ?
            `,
            [newDesc, listId, current.source_locale],
          );
        }
      }
    });

    // Return the updated list with source-locale translation
    const updatedResult = await db.raw<{ rows: ListRow[] }>(
      `
      SELECT
        sl.id,
        sl.organization_id,
        sl.key,
        sl.source_locale,
        sl.status,
        sl.created_by,
        sl.created_at,
        sl.updated_at,
        t.name,
        t.description,
        t.locale AS resolved_locale,
        t.is_machine,
        (
          SELECT COUNT(*) FROM selection_list_items
          WHERE list_id = sl.id AND status = 'active'
        ) AS item_count
      FROM selection_lists sl
      LEFT JOIN selection_list_translations t ON t.list_id = sl.id AND t.locale = sl.source_locale
      WHERE sl.id = ?
      `,
      [listId],
    );

    res.status(200).json(formatList(updatedResult.rows[0]));
  } catch (err: unknown) {
    const pg = err as { code?: string };
    if (pg?.code === '23505') {
      res.status(409).json({ code: 'CONFLICT', message: 'A list with that key already exists.' });
      return;
    }
    console.error('[lists] PATCH /:listId error:', err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── DELETE /:listId — archive or purge ──────────────────────────────────────

router.delete('/:listId', async (req: Request, res: Response): Promise<void> => {
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  // TODO(S7): permit.check({ user: req.userId, action: 'delete', resource: 'SelectionList', resourceInstance: req.params.listId })

  const { listId } = req.params;
  const purge = req.query.purge === 'true';

  try {
    const existing = await db.raw<{ rows: [{ id: string }] }>(
      `SELECT id FROM selection_lists WHERE id = ? AND organization_id = ?`,
      [listId, req.orgId],
    );
    if (!existing.rows[0]) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
      return;
    }

    if (purge) {
      // Hard delete — translations and items must be removed first
      await db.transaction(async (trx) => {
        // Delete item translations first (FK constraint)
        await trx.raw(
          `
          DELETE FROM selection_list_item_translations
          WHERE item_id IN (
            SELECT id FROM selection_list_items WHERE list_id = ?
          )
          `,
          [listId],
        );
        // Delete items
        await trx.raw(`DELETE FROM selection_list_items WHERE list_id = ?`, [listId]);
        // Delete list translations
        await trx.raw(`DELETE FROM selection_list_translations WHERE list_id = ?`, [listId]);
        // Delete the list
        await trx.raw(`DELETE FROM selection_lists WHERE id = ?`, [listId]);
      });
      res.status(204).send();
    } else {
      // Soft delete: archive
      await db.raw(
        `UPDATE selection_lists SET status = 'archived', updated_at = now() WHERE id = ?`,
        [listId],
      );

      // Return the archived list
      const result = await db.raw<{ rows: ListRow[] }>(
        `
        SELECT
          sl.id,
          sl.organization_id,
          sl.key,
          sl.source_locale,
          sl.status,
          sl.created_by,
          sl.created_at,
          sl.updated_at,
          t.name,
          t.description,
          t.locale AS resolved_locale,
          t.is_machine,
          (
            SELECT COUNT(*) FROM selection_list_items
            WHERE list_id = sl.id AND status = 'active'
          ) AS item_count
        FROM selection_lists sl
        LEFT JOIN selection_list_translations t ON t.list_id = sl.id AND t.locale = sl.source_locale
        WHERE sl.id = ?
        `,
        [listId],
      );
      res.status(200).json(formatList(result.rows[0]));
    }
  } catch (err) {
    console.error('[lists] DELETE /:listId error:', err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── POST /:listId/archive — explicit archive ─────────────────────────────────

router.post('/:listId/archive', async (req: Request, res: Response): Promise<void> => {
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  // TODO(S7): permit.check({ user: req.userId, action: 'delete', resource: 'SelectionList', resourceInstance: req.params.listId })

  const { listId } = req.params;

  try {
    const existing = await db.raw<{ rows: [{ id: string }] }>(
      `SELECT id FROM selection_lists WHERE id = ? AND organization_id = ?`,
      [listId, req.orgId],
    );
    if (!existing.rows[0]) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
      return;
    }

    await db.raw(
      `UPDATE selection_lists SET status = 'archived', updated_at = now() WHERE id = ?`,
      [listId],
    );

    const result = await db.raw<{ rows: ListRow[] }>(
      `
      SELECT
        sl.id,
        sl.organization_id,
        sl.key,
        sl.source_locale,
        sl.status,
        sl.created_by,
        sl.created_at,
        sl.updated_at,
        t.name,
        t.description,
        t.locale AS resolved_locale,
        t.is_machine,
        (
          SELECT COUNT(*) FROM selection_list_items
          WHERE list_id = sl.id AND status = 'active'
        ) AS item_count
      FROM selection_lists sl
      LEFT JOIN selection_list_translations t ON t.list_id = sl.id AND t.locale = sl.source_locale
      WHERE sl.id = ?
      `,
      [listId],
    );

    res.status(200).json(formatList(result.rows[0]));
  } catch (err) {
    console.error('[lists] POST /:listId/archive error:', err);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

export default router;
