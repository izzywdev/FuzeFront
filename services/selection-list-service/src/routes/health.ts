import { Router, Request, Response } from 'express';

const router = Router();

// GET /health — unauthenticated liveness/readiness probe.
router.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'selection-list-service' });
});

export default router;
