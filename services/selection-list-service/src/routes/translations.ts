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
//   isSelectionListsEnabled() (fuzefront.selection-lists.service, release, default
//   OFF) is checked at the top of every handler; returns 404 when OFF. Both flag
//   states are exercised in tests/translations.test.ts.
//
// Authorization:
//   Every route carries requireAuthzCheck('SelectionList', read|translate) per the
//   contract's x-permit-action (middleware/authz.ts).
//
// source_hash semantics:
//   A translation row records the hash of the source-locale text it was produced
//   from: md5(`${name}|${description ?? ''}`). When the source changes the hash
//   no longer matches, marking the row stale and eligible for autofill refresh.

import { Request, Response } from 'express';
import { createRouter } from '../lib/http';
import { registerIdParams } from '../middleware/validateInput';
import { createHash } from 'crypto';
import { db } from '../db';
import { isSelectionListsEnabled } from '../flags';
import { requireAuthzCheck } from '../middleware/authz';
import type { Knex } from 'knex';
import { lockOrgOutbox } from '../events/outbox';
import {
  eventContextFromRequest,
  emitItemTranslationUpserted,
  emitListTranslationUpserted,
  emitTranslationDeleted,
} from '../events/emitters';
import { refreshItemUserModified, refreshListUserModified } from '../seed/content';

const router = createRouter();
registerIdParams(router);

// Supported BCP-47 locales — must stay in sync with openapi.yaml Locale enum
// and packages/i18n/src/languages.ts.
const SUPPORTED_LOCALES = new Set([
  'en', 'es', 'fr', 'de', 'pt', 'ru', 'zh', 'ja', 'hi', 'ar', 'he',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Field limits (openapi + the event schemas the translation events validate against).
const NAME_MAX = 200;
const DESCRIPTION_MAX = 2000;

/**
 * Noop machine-translation provider: "[MT] " + source text, clamped to the
 * field limit so a source at its own limit cannot produce an over-long
 * translation (which the published translation.upserted schema would refuse).
 */
function machineText(source: string, max: number): string {
  return `[MT] ${source}`.slice(0, max);
}

export function computeSourceHash(name: string, description?: string | null): string {
  return createHash('md5').update(`${name}|${description ?? ''}`).digest('hex');
}

type Executor = Knex | Knex.Transaction;

async function getListByOrg(listId: string, orgId: string, ex: Executor = db) {
  return ex('selection_lists')
    .where({ id: listId, organization_id: orgId })
    .first();
}

async function getItemByList(itemId: string, listId: string, ex: Executor = db) {
  return ex('selection_list_items')
    .where({ id: itemId, list_id: listId })
    .first();
}

/** What a transactional mutation hands back to the route: a ready HTTP answer. */
interface Answer {
  status: number;
  body?: unknown;
}

function reply(res: Response, a: Answer) {
  return a.body === undefined ? res.status(a.status).send() : res.status(a.status).json(a.body);
}

async function requireFeatureEnabled(req: Request, res: Response): Promise<boolean> {
  // Pass the request context so per-org / percentage rollout targets correctly
  // (a context-less evaluation can only ever see the default).
  const enabled = await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId });
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

router.get('/:listId/translations', requireAuthzCheck('SelectionList', 'read'), async (req: Request, res: Response) => {
  if (!await requireFeatureEnabled(req, res)) return;
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

router.put('/:listId/translations/:locale', requireAuthzCheck('SelectionList', 'translate'), async (req: Request, res: Response) => {
  if (!await requireFeatureEnabled(req, res)) return;
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
  if (name.trim().length > NAME_MAX) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: `name must be at most ${NAME_MAX} characters.` });
  }
  if (description !== undefined && description !== null && (typeof description !== 'string' || description.length > DESCRIPTION_MAX)) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: `description must be a string of at most ${DESCRIPTION_MAX} characters.` });
  }

  // One transaction: the upsert, the revision bump and the outbox event commit
  // (or roll back) together. Lock order: org outbox lock first (events/outbox.ts).
  const answer: Answer = await db.transaction(async (trx) => {
    await lockOrgOutbox(trx, orgId);

    const list = await getListByOrg(listId, orgId, trx);
    if (!list) {
      return { status: 404, body: { code: 'NOT_FOUND', message: 'List not found.' } };
    }

    if (locale === list.source_locale) {
      return {
        status: 400,
        body: {
          code: 'VALIDATION_ERROR',
          message:
            'Cannot write to source_locale via this endpoint. ' +
            'Use PATCH /v1/selection-lists/{listId} to update source text.',
        },
      };
    }

    const sourceTrans = await trx('selection_list_translations')
      .where({ list_id: listId, locale: list.source_locale })
      .first();

    const source_hash = sourceTrans
      ? computeSourceHash(sourceTrans.name, sourceTrans.description)
      : null;

    const now = new Date().toISOString();

    await trx('selection_list_translations')
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

    const saved = await trx('selection_list_translations')
      .where({ list_id: listId, locale })
      .first();

    // A human wrote a translation of a (possibly seeded) list: persist seed_user_modified if the
    // content no longer hashes to seed_hash (before the emit).
    await refreshListUserModified(trx, listId);

    // Outbox, same transaction: translation.upserted (non-source locale).
    await emitListTranslationUpserted(trx, eventContextFromRequest(req), listId, locale);

    return {
      status: 200,
      body: {
        list_id: saved.list_id,
        locale: saved.locale,
        name: saved.name,
        description: saved.description ?? null,
        source_hash: saved.source_hash ?? null,
        is_machine: saved.is_machine,
        updated_at: saved.updated_at,
      },
    };
  });
  return reply(res, answer);
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:listId/translations/:locale
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/:listId/translations/:locale', requireAuthzCheck('SelectionList', 'translate'), async (req: Request, res: Response) => {
  if (!await requireFeatureEnabled(req, res)) return;
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

  const answer: Answer = await db.transaction(async (trx) => {
    await lockOrgOutbox(trx, orgId);

    const list = await getListByOrg(listId, orgId, trx);
    if (!list) {
      return { status: 404, body: { code: 'NOT_FOUND', message: 'List not found.' } };
    }

    if (locale === list.source_locale) {
      return {
        status: 400,
        body: { code: 'VALIDATION_ERROR', message: 'Cannot delete the source_locale translation.' },
      };
    }

    const removed = await trx('selection_list_translations')
      .where({ list_id: listId, locale })
      .delete();

    // Outbox, same transaction. DELETE is idempotent (204 either way) but only a
    // row that actually existed is a change worth announcing.
    if (Number(removed) > 0) {
      await refreshListUserModified(trx, listId);
      await emitTranslationDeleted(trx, eventContextFromRequest(req), listId, locale);
    }

    return { status: 204 };
  });
  return reply(res, answer);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:listId/items/:itemId/translations
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:listId/items/:itemId/translations', requireAuthzCheck('SelectionList', 'read'), async (req: Request, res: Response) => {
  if (!await requireFeatureEnabled(req, res)) return;
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

router.put('/:listId/items/:itemId/translations/:locale', requireAuthzCheck('SelectionList', 'translate'), async (req: Request, res: Response) => {
  if (!await requireFeatureEnabled(req, res)) return;
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
  if (label.trim().length > NAME_MAX) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: `label must be at most ${NAME_MAX} characters.` });
  }
  if (description !== undefined && description !== null && (typeof description !== 'string' || description.length > DESCRIPTION_MAX)) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: `description must be a string of at most ${DESCRIPTION_MAX} characters.` });
  }

  const answer: Answer = await db.transaction(async (trx) => {
    await lockOrgOutbox(trx, orgId);

    const list = await getListByOrg(listId, orgId, trx);
    if (!list) {
      return { status: 404, body: { code: 'NOT_FOUND', message: 'List not found.' } };
    }

    if (locale === list.source_locale) {
      return {
        status: 400,
        body: { code: 'VALIDATION_ERROR', message: 'Cannot write to source_locale via this endpoint.' },
      };
    }

    const item = await getItemByList(itemId, listId, trx);
    if (!item) {
      return { status: 404, body: { code: 'NOT_FOUND', message: 'Item not found.' } };
    }

    const sourceTrans = await trx('selection_list_item_translations')
      .where({ item_id: itemId, locale: list.source_locale })
      .first();

    const source_hash = sourceTrans
      ? computeSourceHash(sourceTrans.label, sourceTrans.description)
      : null;

    const now = new Date().toISOString();

    await trx('selection_list_item_translations')
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

    const saved = await trx('selection_list_item_translations')
      .where({ item_id: itemId, locale })
      .first();

    await refreshItemUserModified(trx, itemId);

    // Outbox, same transaction: translation.upserted (non-source locale).
    await emitItemTranslationUpserted(trx, eventContextFromRequest(req), listId, itemId, locale);

    return {
      status: 200,
      body: {
        item_id: saved.item_id,
        locale: saved.locale,
        label: saved.label,
        description: saved.description ?? null,
        source_hash: saved.source_hash ?? null,
        is_machine: saved.is_machine,
        updated_at: saved.updated_at,
      },
    };
  });
  return reply(res, answer);
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:listId/items/:itemId/translations/:locale
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/:listId/items/:itemId/translations/:locale', requireAuthzCheck('SelectionList', 'translate'), async (req: Request, res: Response) => {
  if (!await requireFeatureEnabled(req, res)) return;
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

  const answer: Answer = await db.transaction(async (trx) => {
    await lockOrgOutbox(trx, orgId);

    const list = await getListByOrg(listId, orgId, trx);
    if (!list) {
      return { status: 404, body: { code: 'NOT_FOUND', message: 'List not found.' } };
    }

    if (locale === list.source_locale) {
      return {
        status: 400,
        body: { code: 'VALIDATION_ERROR', message: 'Cannot delete the source_locale translation.' },
      };
    }

    const item = await getItemByList(itemId, listId, trx);
    if (!item) {
      return { status: 404, body: { code: 'NOT_FOUND', message: 'Item not found.' } };
    }

    const removed = await trx('selection_list_item_translations')
      .where({ item_id: itemId, locale })
      .delete();

    if (Number(removed) > 0) {
      await refreshItemUserModified(trx, itemId);
      await emitTranslationDeleted(trx, eventContextFromRequest(req), listId, locale, {
        itemId,
        itemCode: item.code,
      });
    }

    return { status: 204 };
  });
  return reply(res, answer);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:listId/translations/:locale/autofill
//   Machine-translate missing or stale translations for one locale.
//   Noop provider: prefix source text with "[MT]", set is_machine=true.
//   Human translations (is_machine=false) are NEVER overwritten.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/:listId/translations/:locale/autofill', requireAuthzCheck('SelectionList', 'translate'), async (req: Request, res: Response) => {
  if (!await requireFeatureEnabled(req, res)) return;
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

  // The whole autofill is ONE transaction: every machine translation written
  // gets its own translation.upserted outbox row (and revision), and a failure
  // anywhere rolls all of them back together with the data. Lock order: org
  // outbox lock first (events/outbox.ts).
  const answer: Answer = await db.transaction(async (trx) => {
    await lockOrgOutbox(trx, orgId);
    const ctx = eventContextFromRequest(req);

    const list = await getListByOrg(listId, orgId, trx);
    if (!list) {
      return { status: 404, body: { code: 'NOT_FOUND', message: 'List not found.' } };
    }

    if (locale === list.source_locale) {
      return {
        status: 400,
        body: { code: 'VALIDATION_ERROR', message: 'locale must differ from the list source_locale.' },
      };
    }

    const sourceListTrans = await trx('selection_list_translations')
      .where({ list_id: listId, locale: list.source_locale })
      .first();

    if (!sourceListTrans) {
      return {
        status: 400,
        body: {
          code: 'VALIDATION_ERROR',
          message: 'Source-locale translation missing for this list — nothing to translate from.',
        },
      };
    }

    const listSourceHash = computeSourceHash(
      sourceListTrans.name,
      sourceListTrans.description
    );
    const now = new Date().toISOString();

    // ── List-level ─────────────────────────────────────────────────────────
    const existingListTrans = await trx('selection_list_translations')
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
      const translatedName = machineText(sourceListTrans.name, NAME_MAX);
      const translatedDesc = sourceListTrans.description
        ? machineText(sourceListTrans.description, DESCRIPTION_MAX)
        : null;

      await trx('selection_list_translations')
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

      await emitListTranslationUpserted(trx, ctx, listId, locale);
      list_translated = true;
    }

    // ── Items ──────────────────────────────────────────────────────────────
    let itemQuery = trx('selection_list_items')
      .where({ list_id: listId, status: 'active' })
      .select('id');

    if (Array.isArray(item_ids) && item_ids.length > 0) {
      itemQuery = itemQuery.whereIn('id', item_ids);
    }

    const items: Array<{ id: string }> = await itemQuery;

    let items_translated = 0;
    let items_skipped = 0;

    for (const item of items) {
      const sourceItemTrans = await trx('selection_list_item_translations')
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

      const existingItemTrans = await trx('selection_list_item_translations')
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

      const translatedLabel = machineText(sourceItemTrans.label, NAME_MAX);
      const translatedDesc = sourceItemTrans.description
        ? machineText(sourceItemTrans.description, DESCRIPTION_MAX)
        : null;

      await trx('selection_list_item_translations')
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

      // One event per written translation (plan section 4).
      await emitItemTranslationUpserted(trx, ctx, listId, item.id, locale);
      items_translated++;
    }

    return {
      status: 200,
      body: {
        locale,
        source_locale: list.source_locale,
        list_translated,
        items_translated,
        items_skipped,
      },
    };
  });
  return reply(res, answer);
});

export default router;
