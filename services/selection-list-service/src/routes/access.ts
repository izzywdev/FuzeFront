// access.ts — route stub for selection list access grant management.
// Full implementation: S7 (FFRNT-TBD).

import { Router, Request, Response } from 'express';

const router = Router();

const NOT_IMPLEMENTED = { code: 'NOT_IMPLEMENTED', message: 'Implemented in S7.' };

router.get('/:listId/access', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

router.put('/:listId/access/:userId', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

router.delete('/:listId/access/:userId', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

export default router;
