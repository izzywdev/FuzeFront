// items.ts — route stub for selection list item CRUD.
// Full implementation: S4 (FFRNT-TBD).

import { Router, Request, Response } from 'express';

const router = Router();

const NOT_IMPLEMENTED = { code: 'NOT_IMPLEMENTED', message: 'Implemented in S4.' };

router.get('/:listId/items', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

router.post('/:listId/items', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

router.put('/:listId/items/reorder', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

router.patch('/:listId/items/:itemId', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

router.delete('/:listId/items/:itemId', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

router.post('/:listId/items/:itemId/archive', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

export default router;
