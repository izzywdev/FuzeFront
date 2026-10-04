// flagGate.ts — router-level fail-closed gate for `fuzefront.selection-lists.service`.
//
// Release flag, default OFF. Mounted once in app.ts in front of every
// /v1/selection-lists/* router so a route that forgets its own per-handler
// check (access.ts historically had none) still answers 404 while the flag is
// OFF. The per-handler checks in lists/items/quota/translations stay as
// defence in depth.
//
// Must run AFTER authMiddleware so the evaluation context carries the org and
// user (per-org / percentage rollout targeting needs them).

import { Request, Response, NextFunction } from 'express';
import { isSelectionListsEnabled } from '../flags';
import { getLog } from '../lib/logger';

export async function requireSelectionListsFlag(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let enabled = false;
  try {
    enabled = await isSelectionListsEnabled({ organizationId: req.orgId, userId: req.userId });
  } catch (err) {
    getLog(req).warn({ err }, 'selection-lists flag evaluation failed — failing closed');
    enabled = false; // fail closed
  }
  if (!enabled) {
    getLog(req).debug('selection-lists release flag OFF — 404');
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found.' });
    return;
  }
  next();
}
