// quota.ts — GET /v1/selection-lists/quota handler.
//
// Returns the org-scoped quota status for the authenticated caller.
// Annotated x-pagination: exempt in the OpenAPI contract — the response is a
// fixed set of four quota scopes, not a user-data collection.
//
// Auth: requires req.orgId from the JWT (authMiddleware must run first).
// AuthZ: TODO(S7) — permit.check for the `read` action on SelectionList.
//
// Feature flag: fuzefront.selection-lists.service (release, default OFF).
// Return 404 when the flag is OFF so the service is invisible until enabled.

import { Router, Request, Response } from 'express';
import { getQuotaUsage } from '../services/quota.service';
import { isSelectionListsEnabled } from '../flags';

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
router.get('/quota', async (req: Request, res: Response): Promise<void> => {
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

  // TODO(S7): permit.check({ user: req.userId, action: 'read', resource: 'SelectionList' })

  try {
    const usage = await getQuotaUsage(req.orgId, req.userId);
    res.status(200).json(usage);
  } catch (err) {
    console.error('[quota] getQuotaUsage error:', err);
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred retrieving quota usage.',
    });
  }
});

export default router;
