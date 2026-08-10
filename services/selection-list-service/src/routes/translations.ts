// translations.ts — Translation workbench routes for selection-list-service.
//
// Routes (mounted under /v1/selection-lists in app.ts):
//   GET    /:listId/translations                         — list locales + status
//   PUT    /:listId/translations/:locale                 — upsert list translation
//   DELETE /:listId/translations/:locale                 — remove a translation
//   GET    /:listId/items/:itemId/translations           — list item locale status
//   PUT    /:listId/items/:itemId/translations/:locale   — upsert item translation
//   DELETE /:listId/items/:itemId/translations/:locale   — remove item translation
//   POST   /:listId/translations/:locale/autofill        — machine-translate locale
//
// Auth scope:
//   ALL routes require req.userId + req.orgId (populated by authMiddleware).
//   Org-scoping: organization_id = req.orgId enforced at the list-lookup step.
//   A list not owned by the caller's org returns 404, not 403 — not an oracle.
//
// Feature flag:
//   isSelectionListsEnabled() (fuzefront.selection-list.enabled, release, default
//   OFF) is checked at the top of every handler; returns 404 when OFF. Both flag
//   states are exercised in tests/translations.test.ts.
//
// Authorization stubs:
//   S7 adds Permit.io permit.check() calls. Each handler has a TODO(S7) marker.
//
// source_hash semantics:
//   A translation row records the hash of the source-locale text it was produced
//   from: md5(`${name}|${description ?? ''}`). When the source changes the hash
//   no longer matches, marking the row stale and eligible for autofill refresh.

import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { db } from '../db';
import { isSelectionListsEnabled } from '../flags';

const router = Router();

// Supported BCP-47 locales — must stay in sync with openapi.yaml Locale enum
// and packages/i18n/src/languages.ts.
const SUPPORTED_LOCALES = new Set([
  'en', 'es', 'fr', 'de', 'pt', 'ru', 'zh', 'ja', 'hi', 'ar', 'he',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function computeSourceHash(name: string, description?: string | null): string {
  return createHash('md5').update(`${name}|${description ?? ''}`).digest('hex');
}

async function getListByOrg(listId: string, orgId: string) {
  return db('selection_lists')
    .where({ id: listId, organization_id: orgId })
    .first();
}

async function getItemByList(itemId: string, listId: string) {
  return db('selection_list_items')
    .where({ id: itemId, list_id: listId })
    .first();
}

async function requireFeatureEnabled(res: Response): Promise<boolean> {
  const enabled = await isSelectionListsEnabled();
  if (!enabled) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return false;
  }
  return true;
}

function requireAuth(req: Request, res: Response): boolean {
  if (!req.userId || !req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Missing identity claims.' });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /:listId/translations
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:listId/translations', async (req: Request, res: Response) => {
  if (!await requireFeatureEnabled(res)) return;
  if (!requireAuth(req, res)) return;

  const { listId } = req.params;
  const orgId = req.orgId as string;

  // TODO(S7): permit.check('read', listId, req.userId)

  const list = await getListByOrg(listId, orgId);
  if (!list) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'List not found.' });
  }

  const sourceTrans = await db('selection_list_translations')
    .where({ list_id: listId, locale: list.source_locale })
    .first();

  const currentSourceHash = sourceTrans
    ? computeSourceHash(sourceTrans.name, sourceTrans.description)
    : null;

  const translations: Array<{
    locale: string;
    is_machine: boolean;
    source_hash: string | null;
  }> = await db('selection_list_translations')
    .where({ list_id: listId })
    .whereNot({ locale: list.source_locale });

  const [{ count: rawCount }] = await db('selection_list_items')
    .where({ list_id: listId, status: 'active' })
    .count({ count: '*' });
  const activeItemCount = Number(rawCount);
  const totalTranslatable = 1 + activeItemCount;

  const itemCountRows: Array<{ locale: string; count: string | number }> = await db(
    'selection_list_item_translations as slit'
  )
    .join('selection_list_items as sli', 'sli.id', 'slit.item_id')
    .where({ 'sli.list_id': listId, 'sli.status': 'active' })
    .groupBy('slit.locale')
    .select('slit.locale')
    .count({ count: 'slit.item_id' });

  const itemCountByLocale = new Map<string, number>(
    itemCountRows.map((r) => [r.locale, Number(r.count)])
  );

  const result = translations.map((t) => {
    const itemsTranslated = itemCountByLocale.get(t.locale) ?? 0;
    const completeness_pct =
      totalTranslatable > 0
        ? Math.round(((1 + itemsTranslated) / totalTranslatable) * 100)
        : 100;
    return {
      locale: t.locale,
      completeness_pct,
      machine_translated: t.is_machine,
      source_changed:
        currentSourceHash !== null && t.source_hash !== currentSourceHash,
    };
  });

  return res.status(200).json(result);
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /:listId/translations/:locale
// ─────────────────────────────────────────────────────────────────────────────

router.put('/:listId/translations/:locale', async (req: Request, res: Response) => {
  if (!await requireFeatureEnabled(res)) return;
  if (!requireAuth(req, res)) return;

  const { listId, locale } = req.params;
  const orgId = req.orgId as string;

  // TODO(S7): permit.check('translate', listId, req.userId)

  if (!SUPPORTED_LOCALES.has(locale)) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: `Unsupported locale: ${locale}.`,
    });
  }

  const { name, description } = req.body ?? {};
  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'name is required.' });
  }

  const list = await getListByOrg(listId, orgId);
  if (!list) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'List not found.' });
  }

  if (locale === list.source_locale) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message:
        'Cannot write to source_locale via this endpoint. ' +
        'Use PATCH /v1/selection-lists/{listId} to update source text.',
    });
  }

  const sourceTrans = await db('selection_list_translations')
    .where({ list_id: listId, locale: list.source_locale })
    .first();

  const source_hash = sourceTrans
    ? computeSourceHash(sourceTrans.name, sourceTrans.description)
    : null;

  const now = new Date().toISOString();

  await db('selection_list_translations')
    .insert({
      list_id: listId,
      locale,
      name: name.trim(),
      description: description ?? null,
      source_hash,
      is_machine: false,
      updated_at: now,
    })
    .onConflict(['list_id', 'locale'])
    .merge(['name', 'description', 'source_hash', 'is_machine', 'updated_at']);

  const saved = await db('selection_list_translations')
    .where({ list_id: listId, locale })
    .first();

  return res.status(200).json({
    list_id: saved.list_id,
    locale: saved.locale,
    name: saved.name,
    description: saved.description ?? null,
    source_hash: saved.source_hash ?? null,
    is_machine: saved.is_machine,
    updated_at: saved.updated_at,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:listId/translations/:locale
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/:listId/translations/:locale', async (req: Request, res: Response) => {
  if (!await requireFeatureEnabled(res)) return;
  if (!requireAuth(req, res)) return;

  const { listId, locale } = req.params;
  const orgId = req.orgId as string;

  // TODO(S7): permit.check('translate', listId, req.userId)

  if (!SUPPORTED_LOCALES.has(locale)) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: `Unsupported locale: ${locale}.`,
    });
  }

  const list = await getListByOrg(listId, orgId);
  if (!list) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'List not found.' });
  }

  if (locale === list.source_locale) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Cannot delete the source_locale translation.',
    });
  }

  await db('selection_list_translations')
    .where({ list_id: listId, locale })
    .delete();

  return res.status(204).send();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:listId/items/:itemId/translations
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:listId/items/:itemId/translations', async (req: Request, res: Response) => {
  if (!await requireFeatureEnabled(res)) return;
  if (!requireAuth(req, res)) return;

  const { listId, itemId } = req.params;
  const orgId = req.orgId as string;

  // TODO(S7): permit.check('read', listId, req.userId)

  const list = await getListByOrg(listId, orgId);
  if (!list) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'List not found.' });
  }

  const item = await getItemByList(itemId, listId);
  if (!item) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Item not found.' });
  }

  const sourceTrans = await db('selection_list_item_translations')
    .where({ item_id: itemId, locale: list.source_locale })
    .first();

  const currentSourceHash = sourceTrans
    ? computeSourceHash(sourceTrans.label, sourceTrans.description)
    : null;

  const translations: Array<{
    locale: string;
    is_machine: boolean;
    source_hash: string | null;
  }> = await db('selection_list_item_translations')
    .where({ item_id: itemId })
    .whereNot({ locale: list.source_locale });

  const result = translations.map((t) => ({
    locale: t.locale,
    machine_translated: t.is_machine,
    source_changed:
      currentSourceHash !== null && t.source_hash !== currentSourceHash,
  }));

  return res.status(200).json(result);
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /:listId/items/:itemId/translations/:locale
// ─────────────────────────────────────────────────────────────────────────────

router.put('/:listId/items/:itemId/translations/:locale', async (req: Request, res: Response) => {
  if (!await requireFeatureEnabled(res)) return;
  if (!requireAuth(req, res)) return;

  const { listId, itemId, locale } = req.params;
  const orgId = req.orgId as string;

  // TODO(S7): permit.check('translate', listId, req.userId)

  if (!SUPPORTED_LOCALES.has(locale)) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: `Unsupported locale: ${locale}.`,
    });
  }

  const { label, description } = req.body ?? {};
  if (!label || typeof label !== 'string' || label.trim() === '') {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: 'label is required.' });
  }

  const list = await getListByOrg(listId, orgId);
  if (!list) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'List not found.' });
  }

  if (locale === list.source_locale) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Cannot write to source_locale via this endpoint.',
    });
  }

  const item = await getItemByList(itemId, listId);
  if (!item) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Item not found.' });
  }

  const sourceTrans = await db('selection_list_item_translations')
    .where({ item_id: itemId, locale: list.source_locale })
    .first();

  const source_hash = sourceTrans
    ? computeSourceHash(sourceTrans.label, sourceTrans.description)
    : null;

  const now = new Date().toISOString();

  await db('selection_list_item_translations')
    .insert({
      item_id: itemId,
      locale,
      label: label.trim(),
      description: description ?? null,
      source_hash,
      is_machine: false,
      updated_at: now,
    })
    .onConflict(['item_id', 'locale'])
    .merge(['label', 'description', 'source_hash', 'is_machine', 'updated_at']);

  const saved = await db('selection_list_item_translations')
    .where({ item_id: itemId, locale })
    .first();

  return res.status(200).json({
    item_id: saved.item_id,
    locale: saved.locale,
    label: saved.label,
    description: saved.description ?? null,
    source_hash: saved.source_hash ?? null,
    is_machine: saved.is_machine,
    updated_at: saved.updated_at,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:listId/items/:itemId/translations/:locale
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/:listId/items/:itemId/translations/:locale', async (req: Request, res: Response) => {
  if (!await requireFeatureEnabled(res)) return;
  if (!requireAuth(req, res)) return;

  const { listId, itemId, locale } = req.params;
  const orgId = req.orgId as string;

  // TODO(S7): permit.check('translate', listId, req.userId)

  if (!SUPPORTED_LOCALES.has(locale)) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: `Unsupported locale: ${locale}.`,
    });
  }

  const list = await getListByOrg(listId, orgId);
  if (!list) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'List not found.' });
  }

  if (locale === list.source_locale) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Cannot delete the source_locale translation.',
    });
  }

  const item = await getItemByList(itemId, listId);
  if (!item) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Item not found.' });
  }

  await db('selection_list_item_translations')
    .where({ item_id: itemId, locale })
    .delete();

  return res.status(204).send();
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:listId/translations/:locale/autofill
//   Machine-translate missing or stale translations for one locale.
//   Noop provider: prefix source text with "[MT]", set is_machine=true.
//   Human translations (is_machine=false) are NEVER overwritten.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/:listId/translations/:locale/autofill', async (req: Request, res: Response) => {
  if (!await requireFeatureEnabled(res)) return;
  if (!requireAuth(req, res)) return;

  const { listId, locale } = req.params;
  const orgId = req.orgId as string;
  const { overwrite_machine = false, item_ids } = req.body ?? {};

  // TODO(S7): permit.check('translate', listId, req.userId)

  if (!SUPPORTED_LOCALES.has(locale)) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: `Unsupported locale: ${locale}.`,
    });
  }

  const list = await getListByOrg(listId, orgId);
  if (!list) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'List not found.' });
  }

  if (locale === list.source_locale) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'locale must differ from the list source_locale.',
    });
  }

  const sourceListTrans = await db('selection_list_translations')
    .where({ list_id: listId, locale: list.source_locale })
    .first();

  if (!sourceListTrans) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message:
        'Source-locale translation missing for this list — nothing to translate from.',
    });
  }

  const listSourceHash = computeSourceHash(
    sourceListTrans.name,
    sourceListTrans.description
  );
  const now = new Date().toISOString();

  // ── List-level ───────────────────────────────────────────────────────────
  const existingListTrans = await db('selection_list_translations')
    .where({ list_id: listId, locale })
    .first();

  // Translate when: no existing row OR (machine-produced AND (overwrite requested
  // OR source changed)). Human translations (is_machine=false) are never touched.
  const shouldTranslateList =
    !existingListTrans ||
    (existingListTrans.is_machine &&
      (overwrite_machine || existingListTrans.source_hash !== listSourceHash));

  let list_translated = false;

  if (shouldTranslateList) {
    const translatedName = `[MT] ${sourceListTrans.name}`;
    const translatedDesc = sourceListTrans.description
      ? `[MT] ${sourceListTrans.description}`
      : null;

    await db('selection_list_translations')
      .insert({
        list_id: listId,
        locale,
        name: translatedName,
        description: translatedDesc,
        source_hash: listSourceHash,
        is_machine: true,
        updated_at: now,
      })
      .onConflict(['list_id', 'locale'])
      .merge(['name', 'description', 'source_hash', 'is_machine', 'updated_at']);

    list_translated = true;
  }

  // ── Items ────────────────────────────────────────────────────────────────
  let itemQuery = db('selection_list_items')
    .where({ list_id: listId, status: 'active' })
    .select('id');

  if (Array.isArray(item_ids) && item_ids.length > 0) {
    itemQuery = itemQuery.whereIn('id', item_ids);
  }

  const items: Array<{ id: string }> = await itemQuery;

  let items_translated = 0;
  let items_skipped = 0;

  for (const item of items) {
    const sourceItemTrans = await db('selection_list_item_translations')
      .where({ item_id: item.id, locale: list.source_locale })
      .first();

    if (!sourceItemTrans) {
      items_skipped++;
      continue;
    }

    const itemSourceHash = computeSourceHash(
      sourceItemTrans.label,
      sourceItemTrans.description
    );

    const existingItemTrans = await db('selection_list_item_translations')
      .where({ item_id: item.id, locale })
      .first();

    // Human translation → always skip.
    if (existingItemTrans && !existingItemTrans.is_machine) {
      items_skipped++;
      continue;
    }

    // Fresh machine translation and no overwrite requested → skip.
    if (
      existingItemTrans &&
      existingItemTrans.is_machine &&
      !overwrite_machine &&
      existingItemTrans.source_hash === itemSourceHash
    ) {
      items_skipped++;
      continue;
    }

    const translatedLabel = `[MT] ${sourceItemTrans.label}`;
    const translatedDesc = sourceItemTrans.description
      ? `[MT] ${sourceItemTrans.description}`
      : null;

    await db('selection_list_item_translations')
      .insert({
        item_id: item.id,
        locale,
        label: translatedLabel,
        description: translatedDesc,
        source_hash: itemSourceHash,
        is_machine: true,
        updated_at: now,
      })
      .onConflict(['item_id', 'locale'])
      .merge(['label', 'description', 'source_hash', 'is_machine', 'updated_at']);

    items_translated++;
  }

  return res.status(200).json({
    locale,
    source_locale: list.source_locale,
    list_translated,
    items_translated,
    items_skipped,
  });
});

export default router;
