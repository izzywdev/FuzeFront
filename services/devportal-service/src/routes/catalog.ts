// catalog.ts — §7 Catalog + Spec viewer read endpoints. Gated by
// DevPortalCatalog:read (requireAuthzCheck), mounted under /v1.

import { Router, Request, Response } from 'express';
import { requireAuthzCheck } from '../middleware/authz';
import { listCatalog, getSpec } from '../services/registry';

const router = Router();

router.get('/catalog', requireAuthzCheck('DevPortalCatalog', 'read'), async (_req: Request, res: Response) => {
  const entries = await listCatalog();
  res.json({ items: entries });
});

router.get(
  '/catalog/:repo/:service',
  requireAuthzCheck('DevPortalCatalog', 'read'),
  async (req: Request, res: Response) => {
    const spec = await getSpec(req.params.repo, req.params.service);
    if (!spec) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Spec not found.' });
      return;
    }
    res.json(spec);
  }
);

export default router;
