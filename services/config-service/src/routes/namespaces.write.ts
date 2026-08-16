/**
 * POST /v1/namespaces — `createNamespace` (FFRNT-158 / FF-EPIC-17-S6).
 * GET /v1/namespaces is FFRNT-157's (a sibling route module) — this file
 * owns the write half only.
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { requireAuth } from '../middleware/auth';
import { checkConfigPermission } from '../middleware/permit';
import { PgNamespaceRepository } from '../repositories/namespace.repository';
import { validateNamespaceCreateShape } from '../validation/requestShapes';
import { sendError } from '../http/errors';
import { NamespaceCreateInput } from '../types';

export function createNamespacesWriteRouter(pool: Pool): Router {
  const repo = new PgNamespaceRepository(pool);
  const router = Router();

  router.post('/v1/namespaces', requireAuth, async (req: Request, res: Response) => {
    const principal = req.principal!;

    const shape = validateNamespaceCreateShape(req.body);
    if (!shape.valid) {
      sendError(res, 400, {
        code: 'VALIDATION_ERROR',
        message: 'Malformed namespace registration.',
        details: shape.errors.map((m) => ({ message: m })),
      });
      return;
    }
    const body = req.body as NamespaceCreateInput;

    const allowed = await checkConfigPermission(principal.userId, 'register-namespace', body.namespace);
    if (!allowed) {
      sendError(res, 403, {
        code: 'FORBIDDEN',
        message: 'Not permitted to register configuration namespaces.',
      });
      return;
    }

    try {
      const { namespace, created } = await repo.upsert(body);
      res.status(created ? 201 : 200).json(namespace);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[config-service] namespace registration failed', err);
      res.status(500).json({ error: 'internal_error', message: 'Failed to register namespace.' });
    }
  });

  return router;
}
