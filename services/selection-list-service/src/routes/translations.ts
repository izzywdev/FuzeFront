// translations.ts — route stub for selection list translation endpoints.
// Full implementation: S5 (FFRNT-TBD).

import { Router, Request, Response } from 'express';

const router = Router();

const NOT_IMPLEMENTED = { code: 'NOT_IMPLEMENTED', message: 'Implemented in S5.' };

router.put('/:listId/translations/:locale', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

router.put('/:listId/items/:itemId/translations/:locale', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

router.post('/:listId/translations/:locale/autofill', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

export default router;
