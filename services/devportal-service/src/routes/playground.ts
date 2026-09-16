// playground.ts — §6 the sandboxed "Try it" endpoint + §5.3
// DevPortalPlayground:use / :view_history. Mounted under /v1, requires a
// devportal session (authMiddleware, applied at the app level).

import { Router, Request, Response } from 'express';
import { requireAuthzCheck } from '../middleware/authz';
import { getSpecById } from '../services/registry';
import { mockResponse, logCall, getQuota, isOverQuota, listHistory } from '../services/playground';

const router = Router();

router.get('/playground/quota', requireAuthzCheck('DevPortalPlayground', 'use'), async (req: Request, res: Response) => {
  const quota = await getQuota(req.userId!);
  res.json(quota);
});

router.get(
  '/playground/history',
  requireAuthzCheck('DevPortalPlayground', 'view_history'),
  async (req: Request, res: Response) => {
    const history = await listHistory(req.userId!);
    res.json({ items: history });
  }
);

router.post('/playground/try', requireAuthzCheck('DevPortalPlayground', 'use'), async (req: Request, res: Response) => {
  const { specId, operationId } = req.body || {};
  if (!specId || !operationId) {
    res.status(400).json({ code: 'BAD_REQUEST', message: 'specId and operationId are required.' });
    return;
  }

  if (await isOverQuota(req.userId!)) {
    res.status(429).json({
      code: 'QUOTA_EXCEEDED',
      message: 'Sandbox call quota exceeded for this hour. Try again later.',
    });
    return;
  }

  const spec = await getSpecById(specId);
  if (!spec) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Spec not found.' });
    return;
  }

  const result = mockResponse(spec, operationId);
  if (!result) {
    res.status(404).json({ code: 'OPERATION_NOT_FOUND', message: `No operation "${operationId}" in this spec.` });
    return;
  }

  await logCall({
    userId: req.userId!,
    specId,
    operationId,
    method: 'MOCK',
    path: operationId,
    responseStatus: result.status,
  });

  // Never a real backend: this is always the spec's own documented example
  // (or a schema-synthesized stand-in), per §6's safety property.
  res.json({ ...result, sandboxed: true, target: 'mock' });
});

export default router;
