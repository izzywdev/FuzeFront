// lists.ts — route stub for selection list CRUD.
// Full implementation: S4 (FFRNT-TBD).

import { Router, Request, Response } from 'express';

const router = Router();

const NOT_IMPLEMENTED = { code: 'NOT_IMPLEMENTED', message: 'Implemented in S4.' };

router.get('/quota', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

router.get('/', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

router.post('/', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

router.get('/:listId', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

router.patch('/:listId', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

router.delete('/:listId', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

router.post('/:listId/archive', (_req: Request, res: Response) => {
  res.status(501).json(NOT_IMPLEMENTED);
});

export default router;
