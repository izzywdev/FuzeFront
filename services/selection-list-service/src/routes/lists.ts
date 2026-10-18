// lists.ts — SelectionList CRUD routes (S4 — FFRNT-187).
//
// All routes require a valid JWT (authMiddleware upstream).
// All WRITE queries are scoped to req.orgId — never cross-org. READ queries are scoped to req.orgId plus, when
// the release flag `fuzefront.selection-lists.shared-lists` is ON, the common (`platform`) lists
// (services/sharedReads.ts); who may read what is decided by middleware/listAccess.ts, not by this scope.
//
// Authorization (middleware/authz.ts; matrix: docs/planning/selection-lists-permit-actions.md):
//   - tenant-level routes use the keyless SelectionListCatalog resource:
//     GET / -> `list`, POST / -> `create`. GET / additionally filters every
//     returned list through the per-list SelectionList `read` action.
//   - every :listId route carries a SelectionList guard keyed on the list id: requireListRead (the shared-read
//     operations) / requireListMutation (every mutation) from middleware/listAccess.ts, which delegate to the
//     4.0.0 requireAuthzCheck unchanged while the shared-lists flag is OFF and for lists of the caller's org.
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

import { Request, Response } from 'express';
import { createRouter } from '../lib/http';
import { acceptOnlyBodyProps, parseLimitParam, registerIdParams } from '../middleware/validateInput';
import { getLog } from '../lib/logger';
import { db } from '../db';
import { mintId } from '@izzywdev/fuzefront-identity';
import { isSelectionListsEnabled } from '../flags';
import { enforceListQuota, sendQuotaExceeded } from '../middleware/quota';
import {
  lockQuotaScope,
  checkListQuota,
  checkListQuotaAcross,
  checkActiveListQuotaAcross,
  checkActiveListQuota,
  checkLocaleQuota,
  isUserPrincipal,
  QuotaExceededError,
} from '../services/quota.service';
import { revokeInstanceGrants, type InstanceGrant } from '../services/authority';
import { getGrantToken } from '../lib/machineIdentity';
import { grantCleanupFailedTotal } from '../lib/metrics';
import { requireAuthzCheckWhen, requireCatalogCheck, grantListOwner, filterReadable, isAuthzEnabled, bearer } from '../middleware/authz';
import {
  assertMayPurgeLocked,
  assertPlatformWritable,
  replyPlatformSuspended,
  catalogAllowed,
  PLATFORM_PURGE_DENIED_BODY,
  PlatformPurgeDenied,
  requireListMutation,
  requireListRead,
  requireManageAccessWhenVisibilityGiven,
  requirePublishForPlatformList,
  requirePublishWhenBodyIsPlatform,
} from '../middleware/listAccess';
import { sameUser, canonicalOrgId, isVisibility, orgForms, orgIs, orgRenderings, writeOrgs, resolvePlatformOrgId, sameOrg, sharedListsOn, sharedPredicate } from '../lib/sharedLists';
import { editableIds, getReadScope, notOutrankedByRendering, readableByOrg } from '../services/sharedReads';
import { formatList, LIST_COLUMNS, singleCtx, type ListRow } from './listShape';
import { lockOrgOutbox, wireUserId } from '../events/outbox';
import { refreshListUserModified } from '../seed/content';
import {
  eventContextFromRequest,
  emitAccessGranted,
  emitListChanged,
  emitListCreated,
  emitListDeleted,
  emitVisibilityChanged,
  readList,
} from '../events/emitters';

const router = createRouter();
registerIdParams(router);

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// Must equal the openapi `Locale` enum / i18n.languages.json (and the Zod
// `SELECTION_LIST_LOCALES` the published events validate against): a locale
// outside it would be accepted here but make the list.* event invalid.
const SUPPORTED_LOCALES = new Set([
  'en', 'es', 'fr', 'de', 'pt', 'ru', 'zh', 'ja', 'hi', 'ar', 'he',
]);

// openapi SelectionListKey (the event schemas use the same rule).
const LIST_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;
const DESCRIPTION_MAX = 2000;

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

// ─── GET / — list all selection lists ────────────────────────────────────────

/** `filterReadable` in chunks of the Security API's bulk-check ceiling. */
async function filterReadableChunked<T extends { id: string }>(req: Request, rows: T[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += 200) out.push(...(await filterReadable(req, rows.slice(i, i + 200))));
  return out;
}

/**
 * Keys of `platform` lists that the caller's organization SHADOWS: it has its own ACTIVE list with that key
 * (normally its fork) that the caller can read — through an instance role, or through `org` visibility given
 * `read_shared`. A private fork shadows only for the people who can read it (design record D8).
 * Computed up front (not per page) so a page walk is deterministic: the same platform row is dropped on
 * every page.
 */
async function shadowedPlatformKeys(
  req: Request,
  orgId: string,
  platformOrg: string,
  keyFilter: string | undefined,
): Promise<string[]> {
  // Only the rendering WINNER of each key can shadow: the listing keeps exactly that row per key (the same
  // `notOutrankedByRendering` predicate), so a losing duplicate - which the listing drops - must not hide the common
  // list. (If the winner itself is unreadable for the caller it is simply not a candidate below, the common list
  // stays visible and no key is left without an effective row.)
  const winner = notOutrankedByRendering('o', orgRenderings(orgId), orgId);
  const res = await db.raw<{ rows: Array<{ id: string; organization_id: string; key: string; visibility: string }> }>(
    `
    SELECT o.id, o.organization_id, o.key, o.visibility
      FROM selection_lists o
     WHERE o.organization_id = ANY(?)
       AND o.status = 'active'
       AND o.visibility <> 'platform'
       AND ${winner.sql}
       ${keyFilter ? 'AND o.key = ?' : ''}
       AND EXISTS (
         SELECT 1 FROM selection_lists p
          WHERE p.visibility = 'platform' AND p.status = 'active' AND p.key = o.key AND p.organization_id = ANY(?)
       )
    `,
    [orgRenderings(orgId), ...winner.params, ...(keyFilter ? [keyFilter] : []), orgForms(platformOrg)],
  );
  const candidates = res.rows ?? [];
  if (candidates.length === 0) return [];
  const viaShared = candidates.some((c) => c.visibility === 'org') && (await catalogAllowed(req, 'read_shared'));
  const sharedReadable = new Set(candidates.filter((c) => c.visibility === 'org' && viaShared).map((c) => c.id));
  const rest = candidates.filter((c) => !sharedReadable.has(c.id));
  const instanceReadable = rest.length > 0 ? new Set((await filterReadableChunked(req, rest)).map((c) => c.id)) : new Set<string>();
  return [...new Set(candidates.filter((c) => sharedReadable.has(c.id) || instanceReadable.has(c.id)).map((c) => c.key))];
}

router.get('/', requireCatalogCheck('list'), async (req: Request, res: Response): Promise<void> => {
  // Feature flag gate
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  // Parse + clamp pagination params
  const limit = parseLimitParam(req, res, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  if (limit === undefined) return;

  const rawCursor = req.query.cursor as string | undefined;
  const statusFilter = (req.query.status as string) ?? 'active';
  const keyFilter = req.query.key as string | undefined;

  // Validate status filter
  if (!['active', 'archived', 'all'].includes(statusFilter)) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'status must be one of: active, archived, all',
    });
    return;
  }

  // An unsupported `locale` is a 400, never a silent fallback (openapi: so a
  // client bug does not masquerade as missing translations).
  if (req.query.locale !== undefined && !SUPPORTED_LOCALES.has(String(req.query.locale))) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: `locale '${String(req.query.locale)}' is not supported.`,
    });
    return;
  }

  // 4.1.0 query parameters. With the shared-lists flag OFF they are accepted and IGNORED (the 4.0.0
  // result set, exactly); with it ON they are validated.
  const shared = await sharedListsOn(req);
  let includeShared = false;
  let visibilityFilter: string | undefined;
  if (shared) {
    const rawShared = req.query.include_shared;
    if (rawShared !== undefined) {
      if (rawShared !== 'true' && rawShared !== 'false') {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'include_shared must be true or false.' });
        return;
      }
      includeShared = rawShared === 'true';
    }
    const rawVisibility = req.query.visibility;
    if (rawVisibility !== undefined) {
      if (!isVisibility(rawVisibility)) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'visibility must be one of: private, org, platform.' });
        return;
      }
      visibilityFilter = rawVisibility;
    }
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
  // Chain slots: the requested locales, then the ROW's own source_locale (per-row, so a list whose source is
  // not 'en' - e.g. a 'de' common list read by an en-only caller with no Accept-Language - still resolves
  // its name/description instead of an empty string), then the last-resort 'en'. `null` marks the
  // per-row source slot.
  const chain: Array<string | null> = [...requestedLocales, null];
  if (!requestedLocales.includes('en')) chain.push('en');

  try {
    // The platform organization (common lists) only matters for include_shared; unresolved => fail closed
    // (the scope falls back to the caller's own organization).
    // The org's own rows match every rendering of its id whenever the feature is on (and the platform org
    // resolves), including the default listing; the common lists are added only for include_shared.
    const platformOrg = shared ? (await getReadScope(req)).platformOrg : null;

    // Build parameterized WHERE clauses (the scope first, then the filters; the cursor is page-only)
    const scope = readableByOrg('sl', req.orgId as string, { shared, platformOrg, includePlatform: includeShared });
    const whereClause: string[] = [scope.sql];
    const params: (string | number | boolean | null | Date | string[])[] = [...scope.params] as never[];

    // Shared lists ON merges the renderings of the caller's org (and of the platform org): when the same key exists
    // under several of them, exactly ONE row per key is effective (sharedReads.renderingWinnerOrder). Applies to every
    // listing, so `key=` returns at most one row and a picker never sees two lists for one key.
    if (shared) {
      const own = notOutrankedByRendering('sl', orgRenderings(req.orgId as string), req.orgId as string);
      whereClause.push(own.sql);
      params.push(...own.params);
      // The common-list group is the platform org's renderings. When the caller IS the platform org the two groups are
      // the SAME set of rows: a second predicate (a different claim, so a different winner) would be ANDed with the
      // first and reject both rows of a duplicated key. One scope, one winner rule: the caller's claim decides.
      if (includeShared && platformOrg && !sameOrg(req.orgId, platformOrg)) {
        const common = notOutrankedByRendering('sl', orgForms(platformOrg), platformOrg);
        whereClause.push(common.sql);
        params.push(...common.params);
      }
    }

    if (statusFilter !== 'all') {
      whereClause.push('sl.status = ?');
      params.push(statusFilter);
    }

    if (keyFilter) {
      whereClause.push('sl.key = ?');
      params.push(keyFilter);
    }

    if (shared && visibilityFilter) {
      whereClause.push('sl.visibility = ?');
      params.push(visibilityFilter);
    }

    // Shadowing: a common list the caller's organization has its own readable active list for is omitted,
    // unless a `visibility` filter turns it off (an administrator's view of the list behind the fork).
    if (shared && includeShared && platformOrg && !visibilityFilter) {
      const shadowed = await shadowedPlatformKeys(req, req.orgId as string, platformOrg, keyFilter);
      if (shadowed.length > 0) {
        whereClause.push(`NOT (sl.visibility = 'platform' AND NOT (sl.organization_id = ANY(?)) AND sl.key = ANY(?))`);
        params.push(orgRenderings(req.orgId as string), shadowed);
      }
    }

    const countWhere = [...whereClause];
    const countParams = [...params];

    if (cursor) {
      whereClause.push('(sl.created_at < ? OR (sl.created_at = ? AND sl.id < ?))');
      params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }

    // Build translation JOINs - one per requested locale
    const joinClauses = chain.map((slot, i) =>
      slot === null
        ? `LEFT JOIN selection_list_translations t${i} ON t${i}.list_id = sl.id AND t${i}.locale = sl.source_locale`
        : `LEFT JOIN selection_list_translations t${i} ON t${i}.list_id = sl.id AND t${i}.locale = ?`,
    );
    const joinParams = chain.filter((slot): slot is string => slot !== null);

    // COALESCE across translation rows for name, description, resolved_locale, is_machine
    const coalesceOf = (col: string): string => `COALESCE(${chain.map((_, i) => `t${i}.${col}`).join(', ')})`;
    const nameCoalesce = coalesceOf('name');
    const descCoalesce = coalesceOf('description');
    const localeCoalesce = coalesceOf('locale');
    const machineCoalesce = coalesceOf('is_machine');

    const allParams = [...joinParams, ...params];
    const result = await db.raw<{ rows: ListRow[] }>(
      `
      SELECT
        ${LIST_COLUMNS}
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
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    // Which rows of the page the caller may see. A list the caller may not read is absent from the page,
    // never a 403. The cursor still follows the DB order, so a page may be shorter than `limit` but the
    // walk stays gap- and dupe-free.
    let items: ListRow[];
    if (shared && includeShared && (await isAuthzEnabled(req))) {
      // include_shared: admit a row by the shared read (data predicate + `read_shared`, one memoised
      // catalog decision per request) OR by an instance role (bulk). A row of another organization can only
      // ever be admitted by the shared read: instance roles live in the owning tenant.
      const sharedRows = pageRows.filter((r) => sharedPredicate(r, req.orgId as string, platformOrg));
      const sharedOk = sharedRows.length > 0 && (await catalogAllowed(req, 'read_shared'));
      const admitted = new Set<string>(sharedOk ? sharedRows.map((r) => r.id) : []);
      const needInstance = pageRows.filter((r) => !admitted.has(r.id) && sameOrg(r.organization_id, req.orgId));
      for (const r of needInstance.length > 0 ? await filterReadable(req, needInstance) : []) admitted.add(r.id);
      items = pageRows.filter((r) => admitted.has(r.id));
    } else if (shared && includeShared) {
      items = pageRows; // authz not enforced (non-production dev switch): like filterReadable, everything passes
    } else {
      items = await filterReadable(req, pageRows);
    }

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length > 0) {
      const last = pageRows[pageRows.length - 1];
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
      WHERE ${countWhere.join(' AND ')}
      `,
      countParams,
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    // `total` counts every list in the org, including ones the caller cannot
    // read; once instance-level authz is enforced that would leak how many
    // lists exist, so it is omitted (the field is optional in the contract).
    const authzEnforced = await isAuthzEnabled(req);

    // `editable`: one bulk `translate` check over the page (ON only).
    const editable = shared ? await editableIds(req, items) : undefined;

    res.status(200).json({
      items: items.map((r) => formatList(r, { shared, editable: editable ? editable.has(r.id) : undefined, callerOrgId: req.orgId })),
      page: authzEnforced ? { nextCursor, hasMore } : { nextCursor, hasMore, total },
    });
  } catch (err) {
    getLog(req).error(
      { err, op: 'lists GET / error', userId: req.userId, orgId: req.orgId, params: req.params },
      'lists GET / error failed',
    );
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── POST / — create a selection list ────────────────────────────────────────

router.post('/', requireCatalogCheck('create'), requirePublishWhenBodyIsPlatform(), enforceListQuota, async (req: Request, res: Response): Promise<void> => {
  // Flag already checked by enforceListQuota middleware

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  const { key, name, description, source_locale, visibility: rawVisibility } = req.body ?? {};

  // Validate required fields and reject unknown props
  const allowedProps = new Set(['key', 'name', 'description', 'source_locale', 'visibility']);
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
  if (!LIST_KEY_PATTERN.test(key.trim())) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'key must be 2-64 characters of lowercase alphanumerics and hyphens, starting and ending with an alphanumeric.',
    });
    return;
  }
  if (description !== undefined && description !== null && (typeof description !== 'string' || description.length > DESCRIPTION_MAX)) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: `description must be a string of at most ${DESCRIPTION_MAX} characters.` });
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

  // visibility (4.1.0): defaults to private. While the shared-lists flag is OFF only `private` is
  // acceptable (a non-private list cannot exist before the feature is released); ON: the enum.
  // `platform` additionally passed requirePublishWhenBodyIsPlatform (platform operator, platform tenant).
  const shared = await sharedListsOn(req);
  const visibility = rawVisibility === undefined ? 'private' : rawVisibility;
  if (!isVisibility(visibility)) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'visibility must be one of: private, org, platform.' });
    return;
  }
  if (visibility !== 'private' && !shared) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: `visibility '${visibility}' is not available.` });
    return;
  }

  // A COMMON list is owned by the platform organization under ITS configured id, whatever rendering of that
  // org the operator's token presents: stored under the configured TypeID, so the (organization_id, key)
  // uniqueness holds across renderings (plus an explicit all-renderings check below). requirePublish... has
  // already established the caller is acting in the platform org.
  let ownerOrg = req.orgId as string;
  if (visibility === 'platform') {
    const platformOrg = await resolvePlatformOrgId();
    if (!platformOrg) {
      res.status(403).json({ code: 'FORBIDDEN', message: 'Only a platform operator may publish a common list.' });
      return;
    }
    ownerOrg = platformOrg;
  }

  // Mint the id — never accept one from the client (governance/identifier-standard.md §1)
  const id = mintId('selectionList');

  try {
    // Insert list row + seed source-locale translation + grant the creator
    // list-owner, all in one transaction.
    await db.transaction(async (trx) => {
      // Lock order is ALWAYS org outbox lock -> quota lock -> list row (events/outbox.ts):
      // the seed algorithm takes them in that order too, so taking the quota lock first here
      // could deadlock against a concurrent seed of the same org.
      await lockOrgOutbox(trx, req.orgId as string);
      // Creating a COMMON list into a platform org whose writes are suspended: re-checked fresh under the lock a
      // deactivation also takes (see assertPlatformWritable) - nothing written yet, so the throw rolls back clean.
      if (visibility === 'platform') await assertPlatformWritable(trx, null, { ownerOrg });
      // Exact quota enforcement: serialise creates for this org, re-check the
      // ceiling under the lock, then insert (see quota.service.ts header).
      // Shared lists ON: the org is ONE org whatever rendering the token carries - lists are counted and quota
      // overrides loaded across every rendering, under one lock (canonical id). OFF: the 4.0.0 exact scope.
      const quotaOrgs = await writeOrgs(req);
      if (quotaOrgs) {
        await lockQuotaScope(trx, `org_lists:${canonicalOrgId(req.orgId as string) ?? req.orgId}`);
        await checkListQuotaAcross(quotaOrgs, trx, req.userId);
      } else {
        await lockQuotaScope(trx, `org_lists:${req.orgId}`);
        await checkListQuota(req.orgId as string, trx, req.userId);
      }

      // Shared lists ON: (organization_id, key) is unique per ORG, not per rendering of its id. The DB
      // constraint is exact on the stored text, so a bare-UUID claim and an `org_...` claim of the same org
      // could each create the same key; check every rendering of the owning org (any visibility, any status),
      // under the canonical org lock taken above. OFF: nothing extra (the 4.0.0 exact constraint only).
      if (shared) {
        const taken = await trx.raw(`SELECT 1 FROM selection_lists WHERE organization_id = ANY(?) AND key = ?`, [orgRenderings(ownerOrg), key.trim()]);
        if ((taken as { rows?: unknown[] }).rows?.length) {
          throw Object.assign(new Error('list key taken'), { code: '23505' });
        }
      }

      await trx.raw(
        `
        INSERT INTO selection_lists (id, organization_id, key, source_locale, status, created_by, visibility)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
        `,
        [id, ownerOrg, key.trim(), locale, req.userId ?? '', visibility],
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

      // The creator becomes list-owner: Security API grant FIRST (source of
      // truth), mirror row second, both inside this transaction — if the grant
      // throws, the list row rolls back, so no list is ever created that
      // nobody (but an org admin) can administer.
      // (Written with this service's machine identity, not the caller's token.)
      await grantListOwner(req.userId as string, req.orgId as string, id, req.userId as string, trx);

      // Outbox, same transaction (docs/planning/selection-lists-events.md section 6):
      // list.created (revision 1) then the creator's owner grant. Written AFTER the
      // Security API call so the per-org outbox lock is held only for the commit.
      const ctx = eventContextFromRequest(req);
      await emitListCreated(trx, ctx, id);
      await emitAccessGranted(trx, ctx, id, {
        userId: wireUserId(req.userId as string),
        role: 'list-owner',
        previousRole: null,
      });
    });

    // Fetch the newly created list (with translation) to return the canonical shape
    const listResult = await db.raw<{ rows: ListRow[] }>(
      `
      SELECT
        ${LIST_COLUMNS}
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

    // The creator was just made list-owner, so the list is editable for them.
    res.status(201).json(formatList(row, await singleCtx(req, row, true)));
  } catch (err: unknown) {
    if (replyPlatformSuspended(err, res)) return;
    if (err instanceof QuotaExceededError) {
      sendQuotaExceeded(res, err);
      return;
    }
    const pg = err as { code?: string };
    if (pg?.code === '23505') {
      res.status(409).json({ code: 'CONFLICT', message: `A list with key '${key}' already exists.` });
      return;
    }
    getLog(req).error(
      { err, op: 'lists POST / error', userId: req.userId, orgId: req.orgId, params: req.params },
      'lists POST / error failed',
    );
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── GET /:listId — fetch a single list ──────────────────────────────────────

router.get('/:listId', requireListRead(), async (req: Request, res: Response): Promise<void> => {
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  const { listId } = req.params;
  const queryLocale = req.query.locale as string | undefined;
  const acceptLang = req.headers['accept-language'] as string | undefined;

  // READ scope: the caller's organization, plus (shared-lists flag ON) the common lists. The guard above
  // already decided WHETHER the caller may read this list; the scope keeps another org's row unreachable.
  const readScope = await getReadScope(req);
  const readable = readableByOrg('', req.orgId, readScope);

  // We need the source_locale to build the chain — do a quick fetch first
  const slResult = await db.raw<{ rows: [{ source_locale: string }] }>(
    `SELECT source_locale FROM selection_lists WHERE id = ? AND ${readable.sql}`,
    [listId, ...readable.params],
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

  const readableSl = readableByOrg('sl', req.orgId, readScope);
  try {
    const result = await db.raw<{ rows: ListRow[] }>(
      `
      SELECT
        ${LIST_COLUMNS}
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
      WHERE sl.id = ? AND ${readableSl.sql}
      `,
      [...localeChain, listId, ...readableSl.params],
    );

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
      return;
    }

    res.status(200).json(formatList(row, await singleCtx(req, row)));
  } catch (err) {
    getLog(req).error(
      { err, op: 'lists GET /:listId error', userId: req.userId, orgId: req.orgId, params: req.params },
      'lists GET /:listId error failed',
    );
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── PATCH /:listId — partial update ─────────────────────────────────────────

// PATCH {status:"archived"} IS an archive, so it needs the same action as
// POST /:listId/archive and DELETE /:listId — `delete` (list-owner only) —
// otherwise a list-editor could archive via PATCH what it cannot archive via
// the archive endpoint (review L-1). Un-archiving ({status:"active"}) stays on
// the route's base `update` action. Stacked AFTER the base check, so it can
// only tighten.
const requireArchiveAuthzOnStatusChange = requireAuthzCheckWhen(
  (req) => req.body?.status === 'archived',
  'SelectionList',
  'delete',
);

// 4.1.0: a body carrying `visibility` is an ACCESS decision (who may read the list without a grant), so it
// additionally needs `manage_access` (list-owner), and promoting to `platform` additionally needs
// `publish_platform` in the platform tenant. Both only when the shared-lists flag is ON; stacked after the
// base checks, so they can only tighten.
router.patch('/:listId', requireListMutation('update'), requireArchiveAuthzOnStatusChange, requireManageAccessWhenVisibilityGiven(), requirePublishWhenBodyIsPlatform(), async (req: Request, res: Response): Promise<void> => {
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

  // Validate: reject unknown properties
  const allowedProps = new Set(['key', 'source_locale', 'status', 'name', 'description', 'visibility']);
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
    if (!LIST_KEY_PATTERN.test(body.key.trim())) {
      res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'key must be 2-64 characters of lowercase alphanumerics and hyphens, starting and ending with an alphanumeric.',
      });
      return;
    }
  }
  if (body.description !== undefined && body.description !== null && (typeof body.description !== 'string' || body.description.length > DESCRIPTION_MAX)) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: `description must be a string of at most ${DESCRIPTION_MAX} characters.` });
    return;
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
  // visibility (4.1.0). Flag OFF: only `private` is acceptable (a no-op); anything else is a 400, exactly
  // like any value the 4.0.0 contract does not know. Flag ON: the enum; the transition rules run in the
  // transaction below (they need the stored row).
  const shared = await sharedListsOn(req);
  if (body.visibility !== undefined) {
    if (!isVisibility(body.visibility)) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'visibility must be one of: private, org, platform.' });
      return;
    }
    if (!shared && body.visibility !== 'private') {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: `visibility '${body.visibility}' is not available.` });
      return;
    }
  }
  const wantsVisibility: string | undefined = shared ? body.visibility : undefined;

  try {
    let previousVisibility: string | null = null;
    let commonKeyTaken = false;
    const outcome = await db.transaction(async (trx): Promise<'not-found' | 'ok' | 'visibility-locked' | 'not-platform-owned' | 'key-taken'> => {
      // Lock order is ALWAYS org outbox lock -> list row (emitters/outbox.ts), so a
      // concurrent item create / purge / access write on this org cannot deadlock.
      await lockOrgOutbox(trx, req.orgId as string);
      const writeScope = await writeOrgs(req);
      const patchScope = orgIs('organization_id', req.orgId as string, writeScope);

      // Fetch the existing list row (scoped to org) inside the transaction; it is
      // also the `before` state the event diff is taken against.
      const existing = await trx.raw<{ rows: Array<{ id: string; source_locale: string; status: string; key: string; created_by?: string; organization_id?: string; visibility?: string | null }> }>(
        `SELECT id, source_locale, status, key, created_by, organization_id, visibility FROM selection_lists WHERE id = ? AND ${patchScope.sql} FOR NO KEY UPDATE`,
        [listId, ...patchScope.params],
      );
      if (!existing.rows[0]) return 'not-found';
      const current = existing.rows[0];
      // Re-check the suspension of the row's OWNER fresh, under the lock a deactivation also takes; promoting INTO a
      // suspended platform org is refused too. Nothing is written yet: the throw rolls back with no event queued.
      await assertPlatformWritable(trx, listId, wantsVisibility === 'platform' ? { ownerOrg: current.organization_id } : {});
      const before = await readList(trx, listId);

      // Visibility transitions (design record D10). `platform` is one-way: a common list is never demoted
      // (it would turn every tenant's stored ids into `missing`; archive it instead). Promoting needs a list
      // owned by the platform organization (a tenant cannot donate a list to every tenant).
      const currentVisibility = isVisibility(current.visibility) ? current.visibility : 'private';
      const visibilityChanging = wantsVisibility !== undefined && wantsVisibility !== currentVisibility;
      if (visibilityChanging) {
        if (currentVisibility === 'platform') return 'visibility-locked';
        if (wantsVisibility === 'platform') {
          const platformOrg = await resolvePlatformOrgId(trx);
          if (!platformOrg || !sameOrg(current.organization_id, platformOrg)) return 'not-platform-owned';
        }
        previousVisibility = currentVisibility;
      }
      // Keys are unique per ORG across EVERY rendering of its id (a list may have been stored under either),
      // not just per stored text: checked on every rename and on a promotion while shared lists are ON. A
      // common list is also checked against the platform org's configured id. OFF: the exact 4.0.0 constraint.
      const newKey = body.key !== undefined ? body.key.trim() : current.key;
      const promoting = visibilityChanging && wantsVisibility === 'platform';
      let keyTakenByCommon = false;
      if (shared && (promoting || newKey !== current.key)) {
        const owners = new Set<string>(orgRenderings(current.organization_id as string));
        if (promoting || currentVisibility === 'platform') {
          const platformOrg = await resolvePlatformOrgId(trx);
          if (platformOrg) for (const o of orgRenderings(platformOrg)) owners.add(o);
          keyTakenByCommon = true;
        }
        const dup = await trx.raw(
          `SELECT 1 FROM selection_lists WHERE organization_id = ANY(?) AND key = ? AND id <> ?`,
          [[...owners], newKey, listId],
        );
        if ((dup as { rows?: unknown[] }).rows?.length) {
          commonKeyTaken = keyTakenByCommon;
          return 'key-taken';
        }
      }

      // Un-archiving raises the ACTIVE count without any create, so it is subject
      // to the same ceilings (review M-4): org_lists, and user_lists for a list a
      // user authored (system / deleted-user authors are not users). Exact: under
      // the same advisory lock the create handler takes.
      if (body.status === 'active' && current.status === 'archived') {
        const creator = current.created_by && isUserPrincipal(current.created_by) ? current.created_by : undefined;
        if (writeScope) {
          // shared lists ON: one org, every rendering (a common list lives under the platform org's configured id)
          await lockQuotaScope(trx, `org_lists:${canonicalOrgId(req.orgId as string) ?? req.orgId}`);
          await checkActiveListQuotaAcross(writeScope, creator, trx);
        } else {
          await lockQuotaScope(trx, `org_lists:${req.orgId}`);
          await checkActiveListQuota(req.orgId as string, creator, trx);
        }
      }

      // Update the list row — always bump updated_at (plus any changed scalars)
      const listUpdates: Record<string, string | number | boolean | Date | null> = { updated_at: new Date() };
      if (body.key !== undefined) listUpdates.key = body.key.trim();
      if (body.source_locale !== undefined) listUpdates.source_locale = body.source_locale;
      if (body.status !== undefined) listUpdates.status = body.status;
      if (visibilityChanging) listUpdates.visibility = wantsVisibility as string;

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
          // Writing a locale the list does not have yet adds one (list_locales).
          await lockQuotaScope(trx, `list_locales:${listId}`);
          await checkLocaleQuota(listId, writeScope ?? (req.orgId as string), targetLocale, trx);
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

      // A human edited this list: if it is a seeded one whose content no longer hashes to
      // `seed_hash`, persist seed_user_modified (before the emit, so the snapshot carries it).
      await refreshListUserModified(trx, listId);

      // Outbox, same transaction: list.updated (what changed) and/or list.archived.
      const ctx = eventContextFromRequest(req);
      await emitListChanged(trx, ctx, listId, before);
      // A visibility change is its own event (its own listRevision), after any list.updated for the other fields.
      if (visibilityChanging) await emitVisibilityChanged(trx, ctx, listId, previousVisibility as string);
      return 'ok';
    });
    if (outcome === 'not-found') {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
      return;
    }
    if (outcome === 'visibility-locked') {
      res.status(409).json({
        code: 'CONFLICT',
        reason: 'visibility_locked',
        message: 'A common (platform) list can never be given another visibility; archive it instead.',
      });
      return;
    }
    if (outcome === 'key-taken') {
      res.status(409).json({
        code: 'CONFLICT',
        message: commonKeyTaken ? 'A common list with that key already exists.' : 'A list with that key already exists.',
      });
      return;
    }
    if (outcome === 'not-platform-owned') {
      res.status(403).json({ code: 'FORBIDDEN', message: 'Only a list owned by the platform organization can be made a common list.' });
      return;
    }

    // Return the updated list with source-locale translation
    const updatedResult = await db.raw<{ rows: ListRow[] }>(
      `
      SELECT
        ${LIST_COLUMNS}
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

    res.status(200).json(formatList(updatedResult.rows[0], await singleCtx(req, updatedResult.rows[0], true)));
  } catch (err: unknown) {
    if (replyPlatformSuspended(err, res)) return;
    if (err instanceof QuotaExceededError) {
      sendQuotaExceeded(res, err);
      return;
    }
    const pg = err as { code?: string };
    if (pg?.code === '23505') {
      res.status(409).json({ code: 'CONFLICT', message: 'A list with that key already exists.' });
      return;
    }
    if (pg?.code === '23514') {
      res.status(409).json({ code: 'CONFLICT', message: 'The change violates a list constraint.' });
      return;
    }
    getLog(req).error(
      { err, op: 'lists PATCH /:listId error', userId: req.userId, orgId: req.orgId, params: req.params },
      'lists PATCH /:listId error failed',
    );
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── DELETE /:listId — archive or purge ──────────────────────────────────────

/**
 * Revoke the Security API assignments of a purged list (review L-5). Never
 * throws: the purge has committed.
 *
 * Credential: the purging human's own token. They are a `list-owner` (`delete`
 * and `manage_access` are held by that role alone), the Security API re-checks
 * `manage_access` on the exact instance for every revoke, and this service holds
 * no broader standing to do it for them (lib/machineIdentity.ts). The actor's
 * OWN assignment is revoked LAST, since it is what authorizes the others. A grant
 * the human token is refused (typically a grantee who has since left the tenant)
 * is retried once through the workload token, which the Security API honours only
 * for a gone principal — never for a live member.
 *
 * Whatever neither path removes is logged with list/user/role, counted
 * (`selection_list_grant_cleanup_failed_total{cause="purge"}`) and left for the
 * reconciler; the list itself no longer exists, so a leftover assignment on it
 * confers nothing.
 */
async function cleanupPurgedGrants(req: Request, listId: string, grants: InstanceGrant[]): Promise<void> {
  if (grants.length === 0) return;
  const log = getLog(req);
  const token = bearer(req);
  if (!token) {
    grantCleanupFailedTotal.inc({ cause: 'purge' }, grants.length);
    log.warn({ listId, orgId: req.orgId, grants: grants.length }, 'purge: no caller token to revoke Security API grants with — orphan role assignments left for reconciliation');
    return;
  }
  try {
    const actor = req.userId;
    const ordered = [...grants].sort((x, y) => Number(sameUser(x.user_id, actor)) - Number(sameUser(y.user_id, actor)));
    const { revoked, failed } = await revokeInstanceGrants({
      orgId: req.orgId as string,
      listId,
      grants: ordered,
      token,
      fallbackToken: getGrantToken,
      cause: 'purge',
      log,
    });
    log.info({ listId, revoked, failed: failed.length }, 'purge: revoked Security API grants on the purged list');
  } catch (err) {
    grantCleanupFailedTotal.inc({ cause: 'purge' }, grants.length);
    log.warn(
      { err, listId, orgId: req.orgId, grants: grants.length },
      'purge: could not revoke Security API grants — orphan role assignments left for reconciliation',
    );
  }
}

// Purging a COMMON list turns stored ids in every tenant into `missing`: besides `delete` (owner) it needs
// `publish_platform` in the platform tenant (flag ON, platform list, ?purge=true).
router.delete('/:listId', requireListMutation('delete'), requirePublishForPlatformList((req) => req.query.purge === 'true'), async (req: Request, res: Response): Promise<void> => {
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  const { listId } = req.params;
  const purge = req.query.purge === 'true';
  // Grants that were live on a purged list (read inside the transaction, before
  // the mirror rows are deleted) — revoked in the Security API after commit (L-5).
  let purgedGrants: InstanceGrant[] = [];

  try {
    // One transaction for the existence check, the change and its outbox event.
    // Lock order: org outbox lock -> list row (see events/outbox.ts).
    const outcome = await db.transaction(async (trx): Promise<'not-found' | 'ok'> => {
      await lockOrgOutbox(trx, req.orgId as string);
      const rowScope = orgIs('organization_id', req.orgId as string, await writeOrgs(req));
      const existing = await trx.raw<{ rows: [{ id: string; visibility: string | null }] }>(
        `SELECT id, visibility FROM selection_lists WHERE id = ? AND ${rowScope.sql} FOR NO KEY UPDATE`,
        [listId, ...rowScope.params],
      );
      if (!existing.rows[0]) return 'not-found';
      // archive AND purge of a common list: its owner's suspension re-checked fresh under the org lock
      await assertPlatformWritable(trx, listId);

      const ctx = eventContextFromRequest(req);
      if (purge) {
        // The pre-transaction guard decided from an earlier read: re-check the LOCKED row (it may have been
        // promoted to a common list since).
        await assertMayPurgeLocked(req, existing.rows[0]?.visibility);
        // list.deleted tombstone FIRST: it reads the key and bumps the revision,
        // which needs the row. No per-item/translation/access events: it implies them.
        await emitListDeleted(trx, ctx, listId);
        // Hard delete — translations and items must be removed first
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
        // Delete the access-grant mirror rows (FK ON DELETE RESTRICT) — purge
        // cascades to every access grant (openapi DELETE /{listId}). The live
        // ones are remembered so the Security API assignments can be revoked
        // once this transaction has committed (review L-5).
        const liveGrants = await trx.raw<{ rows?: InstanceGrant[] }>(
          `SELECT user_id, role, org_id FROM selection_list_access WHERE list_id = ? AND revoked_at IS NULL`,
          [listId],
        );
        purgedGrants = liveGrants?.rows ?? [];
        await trx.raw(`DELETE FROM selection_list_access WHERE list_id = ?`, [listId]);
        // Detach the audit rows (selection_list_audit.list_id is an FK without cascade; seeding writes
        // list-level rows) - the trail is kept, the list reference is dropped (seed audit rows also carry
        // the list id/key in `after`).
        await trx.raw(`UPDATE selection_list_audit SET list_id = NULL WHERE list_id = ?`, [listId]);
        // Delete the list
        await trx.raw(`DELETE FROM selection_lists WHERE id = ?`, [listId]);
      } else {
        // Soft delete: archive (no event if it already was archived)
        const before = await readList(trx, listId);
        await trx.raw(`UPDATE selection_lists SET status = 'archived', updated_at = now() WHERE id = ?`, [listId]);
        await refreshListUserModified(trx, listId);
        await emitListChanged(trx, ctx, listId, before);
      }
      return 'ok';
    });
    if (outcome === 'not-found') {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
      return;
    }

    if (purge) {
      // After commit, best-effort: the list and its mirror rows are already gone,
      // so a Security API hiccup must not turn a successful purge into an error.
      // Orphaned `SelectionList:<id>` assignments are harmless (ids are never
      // reused) but are PDP clutter; failures are logged per grant and counted
      // (selection_list_grant_cleanup_failed_total{cause="purge"}).
      await cleanupPurgedGrants(req, listId, purgedGrants);
      res.status(204).send();
    } else {
      // Return the archived list
      const result = await db.raw<{ rows: ListRow[] }>(
        `
        SELECT
          ${LIST_COLUMNS}
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
      res.status(200).json(formatList(result.rows[0], await singleCtx(req, result.rows[0], true)));
    }
  } catch (err) {
    if (replyPlatformSuspended(err, res)) return;
    if (err instanceof PlatformPurgeDenied) {
      res.status(403).json(PLATFORM_PURGE_DENIED_BODY);
      return;
    }
    getLog(req).error(
      { err, op: 'lists DELETE /:listId error', userId: req.userId, orgId: req.orgId, params: req.params },
      'lists DELETE /:listId error failed',
    );
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

// ─── POST /:listId/archive — explicit archive ─────────────────────────────────

router.post('/:listId/archive', requireListMutation('delete'), async (req: Request, res: Response): Promise<void> => {
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }

  const { listId } = req.params;

  try {
    const outcome = await db.transaction(async (trx): Promise<'not-found' | 'ok'> => {
      await lockOrgOutbox(trx, req.orgId as string);
      const rowScope = orgIs('organization_id', req.orgId as string, await writeOrgs(req));
      const existing = await trx.raw<{ rows: [{ id: string }] }>(
        `SELECT id FROM selection_lists WHERE id = ? AND ${rowScope.sql} FOR NO KEY UPDATE`,
        [listId, ...rowScope.params],
      );
      if (!existing.rows[0]) return 'not-found';
      await assertPlatformWritable(trx, listId);

      const before = await readList(trx, listId);
      await trx.raw(`UPDATE selection_lists SET status = 'archived', updated_at = now() WHERE id = ?`, [listId]);
      await refreshListUserModified(trx, listId);
      await emitListChanged(trx, eventContextFromRequest(req), listId, before);
      return 'ok';
    });
    if (outcome === 'not-found') {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
      return;
    }

    const result = await db.raw<{ rows: ListRow[] }>(
      `
      SELECT
        ${LIST_COLUMNS}
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

    res.status(200).json(formatList(result.rows[0], await singleCtx(req, result.rows[0], true)));
  } catch (err) {
    if (replyPlatformSuspended(err, res)) return;
    getLog(req).error(
      { err, op: 'lists POST /:listId/archive error', userId: req.userId, orgId: req.orgId, params: req.params },
      'lists POST /:listId/archive error failed',
    );
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

export default router;
