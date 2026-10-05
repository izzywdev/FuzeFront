// quota.ts — Quota enforcement middleware for selection-list-service.
//
// Two Express middlewares:
//   enforceListQuota  — gates POST /v1/selection-lists
//   enforceItemQuota  — gates POST /v1/selection-lists/:listId/items
//
// Both middlewares:
//   1. Check the fuzefront.selection-lists.service feature flag (404 if OFF).
//   2. Require req.orgId (populated by authMiddleware from the JWT).
//   3. Run the relevant quota check (soft fast-path; the create handler re-checks
//      under an advisory lock, which is the exact one). Lists: org_lists,
//      user_lists and the storage ceiling; items: list_items + storage ceiling.
//   4. On QuotaExceededError → 403 QUOTA_EXCEEDED (OpenAPI Forbidden response).
//   5. On any other error → forward to the default Express error handler.
//
// Authz: the route chain runs requireAuthzCheck BEFORE these middlewares, so a
// caller without `add_value` never reaches the quota check path.

import { Request, Response, NextFunction } from 'express';
import { checkListQuota, checkItemQuota, QuotaExceededError } from '../services/quota.service';
import { isSelectionListsEnabled } from '../flags';
import { getLog } from '../lib/logger';

/** Wire-format 403 QUOTA_EXCEEDED body (shared with the create handlers' locked re-check). */
export function sendQuotaExceeded(res: Response, err: QuotaExceededError): void {
  // HTTP 403: per OpenAPI spec, QUOTA_EXCEEDED shares the Forbidden status
  // because "you may not, and retrying identically will not help".
  res.status(403).json({
    code: 'QUOTA_EXCEEDED',
    scope: err.scope,
    current: err.current,
    limit: err.limit,
    message: err.message,
  });
}

// ─── enforceListQuota ─────────────────────────────────────────────────────────

/**
 * Express middleware that enforces the `org_lists` quota ceiling.
 *
 * Mount BEFORE the POST /v1/selection-lists handler. The quota check runs
 * BEFORE the insert (not after) and is NOT transactional — minor overshoot
 * under concurrent load is acceptable (soft limit).
 */
export const enforceListQuota = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  // Feature flag gate (release flag, default OFF — ships dark until enabled).
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({
      code: 'UNAUTHENTICATED',
      message: 'Organization context required. Ensure the JWT includes an orgId claim.',
    });
    return;
  }

  try {
    await checkListQuota(req.orgId, undefined, req.userId);
    next();
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      getLog(req).info({ orgId: req.orgId, scope: err.scope, current: err.current, limit: err.limit }, 'quota exceeded — 403');
      // HTTP 403: per OpenAPI spec, QUOTA_EXCEEDED shares the Forbidden status
      // because "you may not, and retrying identically will not help".
      res.status(403).json({
        code: 'QUOTA_EXCEEDED',
        scope: err.scope,
        current: err.current,
        limit: err.limit,
        message: err.message,
      });
      return;
    }
    getLog(req).error({ err, orgId: req.orgId }, 'quota check failed — forwarding to error handler');
    next(err);
  }
};

// ─── enforceItemQuota ─────────────────────────────────────────────────────────

/**
 * Express middleware that enforces the `list_items` quota ceiling.
 *
 * Mount BEFORE the POST /v1/selection-lists/:listId/items handler. Expects
 * `req.params.listId` to be populated by the router.
 *
 * The quota check runs BEFORE the insert (not after) and is NOT transactional
 * (soft limit).
 */
export const enforceItemQuota = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  // Feature flag gate (release flag, default OFF — ships dark until enabled).
  if (!(await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId }))) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }

  if (!req.orgId) {
    res.status(401).json({
      code: 'UNAUTHENTICATED',
      message: 'Organization context required. Ensure the JWT includes an orgId claim.',
    });
    return;
  }

  const listId = req.params.listId;
  if (!listId) {
    res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'listId path parameter is required.',
    });
    return;
  }

  try {
    await checkItemQuota(listId, req.orgId);
    next();
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      getLog(req).info({ orgId: req.orgId, scope: err.scope, current: err.current, limit: err.limit }, 'quota exceeded — 403');
      // HTTP 403: per OpenAPI spec, QUOTA_EXCEEDED shares the Forbidden status.
      res.status(403).json({
        code: 'QUOTA_EXCEEDED',
        scope: err.scope,
        current: err.current,
        limit: err.limit,
        message: err.message,
      });
      return;
    }
    getLog(req).error({ err, orgId: req.orgId }, 'quota check failed — forwarding to error handler');
    next(err);
  }
};
