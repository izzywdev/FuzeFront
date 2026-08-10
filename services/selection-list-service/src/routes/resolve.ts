// resolve.ts — route stub for bulk id-to-label resolution (the hot path).
// Full implementation: S8 (FFRNT-TBD).
//
// Routes handled by this router (mounted at /v1):
//   POST /resolve   resolveSelectionListItems
//
// Note: /v1/resolve is unauthenticated-capable (may be called with a Bearer token
// or from a trusted in-cluster caller with no token). Auth handling for this route
// is implemented in S8 — the stub returns 501 regardless of auth state.

import { Router, Request, Response } from 'express';

const router = Router();

const NOT_IMPLEMENTED = { code: 'NOT_IMPLEMENTED', message: 'Implemented in S8.' };

router.post('/resolve', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

export default router;
