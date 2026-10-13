// fork.ts — POST /v1/selection-lists/{listId}/fork (openapi `forkSelectionList`, 4.1.0; design record D6).
//
// Copy-on-write: an organization copies a common (`platform`) list into itself as an ordinary list it owns,
// keeping the SAME key (so the fork shadows the common list for the org) and getting NEW service-minted ids
// for the list and every item, with provenance (`forked_from`, `origin_item_id`).
//
// Everything user-visible is behind the release flag `fuzefront.selection-lists.shared-lists`: while OFF the
// route answers 404 as if it did not exist. Authorization never routes through the flag:
//   - `SelectionListCatalog:create` (the fork is a new list in the caller's org) — route guard;
//   - READ on the source (instance grant or the shared read) — `canRead`; an unreadable source is a 404;
//   - quotas org_lists / user_lists / list_items / list_locales — under the advisory lock, in the transaction.
//
// Answers: 201 new fork | 200 the org's existing fork (caller can read it) | 409 reason fork_exists (it
// cannot) | 409 reason fork_not_applicable (source is the caller's own org's) | 409 plain (the key is held by
// another list) | 400 (body, or > 5000 items) | 403 QUOTA_EXCEEDED | 404 (unreadable source, flag OFF).
// The body carries no `id` and no `key`; unknown properties are a 400 (governance/identifier-standard.md §1).

import { NextFunction, Request, Response } from 'express';
import { createRouter } from '../lib/http';
import { acceptOnlyBodyProps, registerIdParams } from '../middleware/validateInput';
import { getLog } from '../lib/logger';
import { db } from '../db';
import { mintId } from '@izzywdev/fuzefront-identity';
import { requireCatalogCheck, bearer } from '../middleware/authz';
import { canRead, lookupList } from '../middleware/listAccess';
import { canonicalOrgId, orgForms, resolvePlatformOrgId, sameOrg, sharedListsOn } from '../lib/sharedLists';
import { QuotaExceededError } from '../services/quota.service';
import { sendQuotaExceeded } from '../middleware/quota';
import { forkList, FORK_MAX_ITEMS } from '../services/fork.service';
import { restoreAuthority } from '../services/authority';
import { eventContextFromRequest } from '../events/emitters';
import { formatList, LIST_COLUMNS, singleCtx, type ListRow } from './listShape';

const router = createRouter();
registerIdParams(router);

/** Release flag `fuzefront.selection-lists.shared-lists` OFF => the route does not exist (404). */
async function requireSharedListsFlag(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await sharedListsOn(req))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }
  next();
}

const FORK_VISIBILITIES = ['org', 'private'];

async function readFork(listId: string): Promise<ListRow | undefined> {
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
  return result.rows[0];
}

router.post('/:listId/fork', requireSharedListsFlag, requireCatalogCheck('create'), async (req: Request, res: Response): Promise<void> => {
  if (!req.orgId || !req.userId) {
    res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Organization context required.' });
    return;
  }
  const orgId = req.orgId;
  const userId = req.userId;
  const sourceId = req.params.listId;

  // SelectionListForkRequest: additionalProperties false — NO `id`, no `key`.
  if (!acceptOnlyBodyProps(req, res, ['visibility'])) return;
  const requested = (req.body ?? {}).visibility;
  if (requested !== undefined && !FORK_VISIBILITIES.includes(requested)) {
    res.status(400).json({ code: 'VALIDATION_ERROR', message: 'visibility must be one of: org, private.' });
    return;
  }
  const visibility: 'org' | 'private' = requested ?? 'org';

  // The fork id is minted here, never accepted (and so the route can compensate the grant by id).
  const forkId = mintId('selectionList');
  let grantAttempted = false;
  // Set the moment the fork transaction has COMMITTED. From then on the list exists and the creator's owner
  // grant is legitimate: a later failure (reading the row back, formatting) must never take it away.
  let committed = false;

  try {
    // The source must be readable by the caller (grant or shared read) — else it does not exist for them.
    const source = await lookupList(req, sourceId);
    if (!source || !(await canRead(req, source))) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
      return;
    }
    if (sameOrg(source.organization_id, orgId)) {
      res.status(409).json({
        code: 'CONFLICT',
        reason: 'fork_not_applicable',
        message: 'This list belongs to your organization; ask its owner for a role instead of forking it.',
      });
      return;
    }
    const platformOrg = await resolvePlatformOrgId();
    if (!platformOrg) {
      // A readable foreign list can only be a common list, which needs the platform org to resolve.
      res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
      return;
    }

    const outcome = await forkList({
      forkId,
      orgId,
      userId,
      sourceId,
      visibility,
      ctx: eventContextFromRequest(req),
      platformOrg,
      onGrantAttempt: () => {
        grantAttempted = true;
      },
    });

    committed = outcome.kind === 'created';
    switch (outcome.kind) {
      case 'created': {
        const row = await readFork(forkId);
        if (!row) {
          res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Fork succeeded but fetch failed.' });
          return;
        }
        getLog(req).info({ forkId, sourceId, items: outcome.itemCount, events: outcome.eventCount }, 'list forked');
        res.status(201).json(formatList(row, await singleCtx(req, row, true)));
        return;
      }
      case 'exists':
        await answerExisting(req, res, outcome.listId);
        return;
      case 'own-org':
        res.status(409).json({
          code: 'CONFLICT',
          reason: 'fork_not_applicable',
          message: 'This list belongs to your organization; ask its owner for a role instead of forking it.',
        });
        return;
      case 'too-large':
        res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: `The source has ${outcome.items} items; a list with more than ${FORK_MAX_ITEMS} items cannot be forked.`,
        });
        return;
      case 'key-taken':
        res.status(409).json({ code: 'CONFLICT', message: 'A list with the same key already exists in your organization.' });
        return;
      case 'source-gone':
        res.status(404).json({ code: 'NOT_FOUND', message: 'Selection list not found.' });
        return;
    }
  } catch (err: unknown) {
    // The Security API grant is not part of the database transaction: if it was attempted and the
    // transaction (or anything after the grant) failed, take the new role assignment back so no assignment
    // outlives a list that was never created. Best-effort and idempotent; never masks the original error.
    if (committed) {
      // The fork is committed (and idempotent per (org, source)): answer retry-safely, keep the grant.
      getLog(req).error({ err, forkId, op: 'lists POST /:listId/fork post-commit' }, 'fork committed but the response could not be built; owner grant kept');
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'The list was forked but the response could not be built; repeat the request to fetch it.',
      });
      return;
    }
    if (grantAttempted) {
      await restoreAuthority({
        op: 'put',
        subject: userId,
        tenant: orgId,
        listId: forkId,
        prior: null,
        target: 'list-owner',
        writes: { grantAttempted: true, revokeAttempted: false },
        token: bearer(req) ?? '',
        log: getLog(req),
      });
    }

    if (err instanceof QuotaExceededError) {
      sendQuotaExceeded(res, err);
      return;
    }
    const pg = err as { code?: string; constraint?: string };
    if (pg?.code === '23505') {
      if (pg.constraint === 'ux_sl_fork_per_org') {
        // Lost a race with a concurrent fork of the same source: answer as the idempotent repeat.
        const winner = await db('selection_lists').whereIn('organization_id', orgForms(canonicalOrgId(orgId) ?? orgId)).where({ forked_from_list_id: sourceId }).first('id');
        if (winner) {
          await answerExisting(req, res, winner.id);
          return;
        }
      }
      res.status(409).json({ code: 'CONFLICT', message: 'A list with that key already exists in your organization.' });
      return;
    }
    getLog(req).error(
      { err, op: 'lists POST /:listId/fork error', userId, orgId, params: req.params },
      'lists POST /:listId/fork error failed',
    );
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
  }
});

/** The organization already holds a fork of this source: 200 with it if the caller can read it, else 409 fork_exists. */
async function answerExisting(req: Request, res: Response, existingId: string): Promise<void> {
  const access = await lookupList(req, existingId);
  if (!access || !(await canRead(req, access))) {
    res.status(409).json({
      code: 'CONFLICT',
      reason: 'fork_exists',
      message: 'Your organization already has a fork of this list that you cannot read; ask its owner for a role.',
    });
    return;
  }
  const row = await readFork(existingId);
  if (!row) {
    res.status(409).json({ code: 'CONFLICT', reason: 'fork_exists', message: 'Your organization already has a fork of this list.' });
    return;
  }
  res.status(200).json(formatList(row, await singleCtx(req, row)));
}

export default router;
