// resolve.ts — POST /v1/resolve — bulk item-id → localized-label hot path.
//
// FFRNT-191 (S8). Implements resolveSelectionListItems from the frozen OpenAPI
// contract (openapi.yaml: POST /v1/resolve).
//
// Design contract:
//   - Hard limit: 500 ids per call (400 VALIDATION_ERROR if exceeded).
//   - Security boundary: org membership from JWT (`req.orgId`). Items belonging
//     to any other org are silently placed in `missing` — never a 403 or 404
//     so the endpoint cannot be used as a cross-org existence oracle. No
//     per-list Permit.io checks — intentional for hot-path performance.
//   - Locale fallback order: body.locale → Accept-Language (first supported
//     tag) → per-item source_locale (via SQL COALESCE) → 'en'.
//   - Archived items resolve normally (they are still valid references);
//     only purged or never-created ids go to `missing`.
//   - Single DB query: JOIN items → lists → translations with three LEFT JOINs
//     (preferred locale, source_locale, 'en'). No N+1 queries.
//   - Feature flag gate: returns 404 if `fuzefront.selection-lists.service`
//     is OFF (release flag, default OFF).
//   - Empty ids: 200 with { results: {}, missing: [] } (short-circuits DB).

import { Router, Request, Response } from 'express';
import { db } from '../db';
import { isSelectionListsEnabled } from '../flags';

const router = Router();

const SUPPORTED_LOCALES = new Set<string>([
  'en', 'es', 'fr', 'de', 'pt', 'ru', 'zh', 'ja', 'hi', 'ar', 'he',
]);

const MAX_IDS = 500;

// Regex for a basic front_sli_ prefix check (fast pre-filter before hitting DB).
const ITEM_ID_PREFIX = 'front_sli_';

/**
 * Parse the first supported language code from an Accept-Language header.
 * "fr-CH, fr;q=0.9, en;q=0.8" → "fr"
 */
function parseAcceptLanguage(header: string | undefined): string | null {
  if (!header) return null;
  const tags = header.split(',').map((t) => t.split(';')[0].trim().toLowerCase());
  for (const tag of tags) {
    const lang = tag.split('-')[0];
    if (SUPPORTED_LOCALES.has(lang)) return lang;
  }
  return null;
}

router.post('/resolve', async (req: Request, res: Response) => {
  // ── Feature flag gate (release, default OFF) ───────────────────────────────
  const enabled = await isSelectionListsEnabled({
    organizationId: req.orgId,
    userId: req.userId,
  });
  if (!enabled) {
    return res.status(404).json({ code: 'NOT_FOUND', message: 'Service not enabled.' });
  }

  // ── Input validation ───────────────────────────────────────────────────────
  const body = req.body ?? {};
  const { ids, locale: bodyLocale } = body;

  if (!Array.isArray(ids)) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'ids must be an array.',
      details: [{ field: '/ids', message: 'must be an array of selection-list-item ids' }],
    });
  }

  if (ids.length > MAX_IDS) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: `Maximum ${MAX_IDS} ids per resolve call.`,
      details: [{ field: '/ids', message: `array must have at most ${MAX_IDS} items` }],
    });
  }

  // ── Empty ids short-circuit ────────────────────────────────────────────────
  if (ids.length === 0) {
    return res.status(200).json({ results: {}, missing: [] });
  }

  // ── Org-scope requirement ──────────────────────────────────────────────────
  // authMiddleware guarantees a valid JWT, but orgId is optional in claims.
  // Without orgId we cannot scope the query → refuse.
  if (!req.orgId) {
    return res.status(401).json({
      code: 'UNAUTHENTICATED',
      message: 'Token is missing organization claim.',
    });
  }

  const orgId = req.orgId;

  // ── Pre-filter: invalid-prefix IDs go straight to missing ─────────────────
  // Avoids DB round-trips for clearly-wrong IDs (wrong type, empty string, etc.)
  // and upholds the governance rule that references carry their type.
  const validIds: string[] = [];
  const invalidIds: string[] = [];
  for (const id of ids) {
    if (typeof id === 'string' && id.startsWith(ITEM_ID_PREFIX) && id.length > ITEM_ID_PREFIX.length) {
      validIds.push(id);
    } else {
      invalidIds.push(String(id));
    }
  }

  // ── Locale resolution ──────────────────────────────────────────────────────
  // Priority: body.locale > Accept-Language > per-item source_locale (SQL) > 'en'.
  // null effectiveLocale means "use per-item source_locale via SQL fallback".
  const effectiveLocale: string | null =
    (typeof bodyLocale === 'string' && SUPPORTED_LOCALES.has(bodyLocale) ? bodyLocale : null) ??
    parseAcceptLanguage(req.headers['accept-language'] as string | undefined) ??
    null;

  // ── Single-query hot path ──────────────────────────────────────────────────
  //
  // LEFT JOIN strategy (one query, three translation fallback slots):
  //   t1 = preferred locale (effectiveLocale; NULL join when effectiveLocale is null)
  //   t2 = list's source_locale
  //   t3 = 'en' hardcoded fallback
  //
  // COALESCE picks the first non-null label/is_machine across t1→t2→t3.
  // CASE WHEN resolves which locale actually contributed the label.
  //
  // Security: AND sl.organization_id = ? ensures items from other orgs are
  // silently absent from the result set (they end up in `missing`).
  // No purged_at column — purged items are deleted rows, so they're absent naturally.

  let dbRows: Array<{
    id: string;
    list_id: string;
    status: string;
    label: string | null;
    is_machine: boolean;
    resolved_locale: string | null;
  }> = [];

  if (validIds.length > 0) {
    const result = await db.raw<{ rows: typeof dbRows }>(
      `
      SELECT
        sli.id,
        sli.list_id,
        sli.status,
        COALESCE(t1.label, t2.label, t3.label)                           AS label,
        COALESCE(t1.is_machine, t2.is_machine, t3.is_machine, false)     AS is_machine,
        CASE
          WHEN t1.label IS NOT NULL THEN CAST(? AS text)
          WHEN t2.label IS NOT NULL THEN sl.source_locale
          ELSE 'en'
        END                                                               AS resolved_locale
      FROM selection_list_items sli
      JOIN selection_lists sl
        ON sl.id = sli.list_id
      LEFT JOIN selection_list_item_translations t1
        ON t1.item_id = sli.id AND t1.locale = ?
      LEFT JOIN selection_list_item_translations t2
        ON t2.item_id = sli.id AND t2.locale = sl.source_locale
      LEFT JOIN selection_list_item_translations t3
        ON t3.item_id = sli.id AND t3.locale = 'en'
      WHERE sli.id = ANY(?)
        AND sl.organization_id = ?
      `,
      [effectiveLocale, effectiveLocale, validIds, orgId]
    );
    dbRows = result.rows;
  }

  // ── Build response ─────────────────────────────────────────────────────────
  const foundIds = new Set<string>(dbRows.map((r) => r.id));

  // Items found in DB but with no label (no translation in any fallback slot):
  // data integrity issue, but treat defensively as missing rather than crashing.
  const noLabelIds: string[] = dbRows
    .filter((r) => r.label === null || r.resolved_locale === null)
    .map((r) => r.id);

  const noLabelSet = new Set<string>(noLabelIds);

  // Collect resolved results (items that have a label).
  const results: Record<
    string,
    { label: string; locale: string; is_machine: boolean; status: string }
  > = {};
  for (const row of dbRows) {
    if (row.label !== null && row.resolved_locale !== null) {
      results[row.id] = {
        label: row.label,
        locale: row.resolved_locale,
        is_machine: Boolean(row.is_machine),
        status: row.status,
      };
    }
  }

  // missing = invalid-prefix ids + ids not in DB + ids with no label (deduped)
  const missingSet = new Set<string>([
    ...invalidIds,
    ...validIds.filter((id) => !foundIds.has(id)),
    ...noLabelIds,
  ]);

  const missing = [...missingSet];

  return res.status(200).json({ results, missing });
});

export default router;
