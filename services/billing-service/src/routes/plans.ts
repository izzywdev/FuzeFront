import { Router, Request, Response } from 'express';
import { PlanService } from '../services/plan.service';

/** GET /api/v1/billing/plans — public, cached list of active plans. */
export function createPlansRouter(plans: PlanService): Router {
  const router = Router();
  router.get('/plans', async (_req: Request, res: Response) => {
    try {
      const list = await plans.getActivePlans();
      res.json({ plans: list });
    } catch (err) {
      res.status(500).json({ error: 'failed to load plans' });
    }
  });
  return router;
}
