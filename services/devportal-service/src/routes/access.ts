// access.ts — §7 "My access" page data: root-org developer membership
// status + current sandbox quota. Requires a devportal session.

import { Router, Request, Response } from 'express';
import { getAuthzClient, ROOT_ORG_ID } from '../middleware/authz';
import { getQuota } from '../services/playground';

const router = Router();

router.get('/me', async (req: Request, res: Response) => {
  const userId = req.userId!;

  let developer = false;
  try {
    const decision = await getAuthzClient().check(
      { subject: userId, tenant: ROOT_ORG_ID, resource: { type: 'DevPortalCatalog' }, action: 'read' },
      ''
    );
    developer = decision.allow;
  } catch {
    // Fail closed on the badge, never throw — "My access" degrading to
    // "not confirmed" is a display nuisance, not a security decision.
    developer = false;
  }

  const quota = await getQuota(userId);

  res.json({
    userId,
    email: req.userEmail ?? null,
    developer,
    rootOrgId: ROOT_ORG_ID,
    quota,
  });
});

export default router;
