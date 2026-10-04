// quota.ts — GET /v1/selection-lists/quota handler.
//
// Returns the org-scoped quota status for the authenticated caller.
// Annotated x-pagination: exempt in the OpenAPI contract — the response is a
// fixed set of four quota scopes, not a user-data collection.
//
// Auth: requires req.orgId from the JWT (authMiddleware must run first).
// AuthZ: requireAuthzCheck(SelectionList, read) on the route.
//
// Feature flag: fuzefront.selection-lists.service (release, default OFF).
// Return 404 when the flag is OFF so the service is invisible until enabled.

import { Router, Request, Response } from 'express';
import { getLog } from '../lib/logger';
import { getQuotaUsage } from '../services/quota.service';
import { isSelectionListsEnabled } from '../flags';
import { requireAuthzCheck } from '../middleware/authz';

const router = Router();

/**
 * GET /v1/selection-lists/quota
 *
 * Returns quota usage and ceilings for the caller's organization.
 * Response shape: SelectionListQuotaStatus (OpenAPI).
 *
 * x-pagination: exempt — a fixed, closed set of four quota scopes for one
 * org; not a user-data collection that grows over time.
 */
router.get('/quota', requireAuthzCheck('SelectionList', 'read'), async (req: Request, res: Response): Promise<void> => {
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
    const usage = await getQuotaUsage(req.orgId, req.userId);
    res.status(200).json(usage);
  } catch (err) {
    getLog(req).error(
      { err, op: 'quota getQuotaUsage error', userId: req.userId, orgId: req.orgId, params: req.params },
      'quota getQuotaUsage error failed',
    );
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred retrieving quota usage.',
    });
  }
});

export default router;
