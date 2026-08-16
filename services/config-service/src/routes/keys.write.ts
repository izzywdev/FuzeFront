/**
 * PUT /v1/namespaces/{namespace}/keys — `registerKeyDefinitions`
 * (FFRNT-158 / FF-EPIC-17-S6). GET on the same path (+ GET the single-key
 * route) is FFRNT-157's — this file owns the write half only.
 */

import { Router, Request, Response } from 'express';
import { Pool, PoolClient } from 'pg';
import { requireAuth } from '../middleware/auth';
import { checkConfigPermission } from '../middleware/permit';
import { PgNamespaceRepository } from '../repositories/namespace.repository';
import { PgKeyDefinitionRepository, UnsatisfiableDefaultValueError } from '../repositories/key-definition.repository';
import { PgValueRepository } from '../repositories/value.repository';
import { IncompatibleManifestError, reconcileKeyManifest } from '../services/key-manifest.service';
import { validateKeyDefinitionManifestShape } from '../validation/requestShapes';
import { sendError } from '../http/errors';
import { KeyDefinitionInput } from '../types';

interface ManifestBody {
  keys: KeyDefinitionInput[];
  complete?: boolean;
}

export function createKeyDefinitionsWriteRouter(pool: Pool): Router {
  const namespaces = new PgNamespaceRepository(pool);
  const router = Router();

  router.put(
    '/v1/namespaces/:namespace/keys',
    requireAuth,
    async (req: Request, res: Response) => {
      const principal = req.principal!;
      const namespaceName = req.params.namespace;

      const shape = validateKeyDefinitionManifestShape(req.body);
      if (!shape.valid) {
        sendError(res, 400, {
          code: 'VALIDATION_ERROR',
          message: 'Malformed key definition manifest.',
          details: shape.errors.map((m) => ({ message: m })),
        });
        return;
      }
      const manifest = req.body as ManifestBody;

      // Reject duplicate keys within one manifest up front — an ambiguous
      // "which one wins" is a validation error, not a coin flip.
      const seen = new Set<string>();
      const dupes: string[] = [];
      for (const k of manifest.keys) {
        if (seen.has(k.key)) dupes.push(k.key);
        seen.add(k.key);
      }
      if (dupes.length > 0) {
        sendError(res, 400, {
          code: 'VALIDATION_ERROR',
          message: 'Manifest declares the same key more than once.',
          details: dupes.map((key) => ({ key, message: 'duplicate key in manifest' })),
        });
        return;
      }

      const namespace = await namespaces.findByName(namespaceName);
      if (!namespace) {
        sendError(res, 404, { code: 'NOT_FOUND', message: `no such namespace '${namespaceName}'` });
        return;
      }

      const allowed = await checkConfigPermission(principal.userId, 'register-keys', namespaceName);
      if (!allowed) {
        sendError(res, 403, { code: 'FORBIDDEN', message: 'Not permitted to register key definitions for this namespace.' });
        return;
      }

      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        const txKeyDefs = new PgKeyDefinitionRepository(client as unknown as Pool);
        const txValues = new PgValueRepository(client as unknown as Pool);

        const result = await reconcileKeyManifest(
          namespace.id,
          manifest,
          {
            listCurrent: () => txKeyDefs.listByNamespace(namespace.id),
            listStoredValues: (definitionId) => txValues.listAllForDefinition(definitionId),
            createDefinition: (input) => txKeyDefs.create(namespace.id, input),
            updateDefinition: (id, input) => txKeyDefs.update(id, input),
            deprecateDefinitions: (ids) => txKeyDefs.deprecate(ids),
          },
        );

        await client.query('COMMIT');
        res.status(200).json(result);
      } catch (err) {
        await client.query('ROLLBACK');
        if (err instanceof IncompatibleManifestError) {
          sendError(res, 409, {
            code: 'INCOMPATIBLE_DEFINITION',
            message: 'The manifest conflicts with values already stored. Nothing was written.',
            details: err.conflicts.map((c) => ({ key: c.key, message: c.message })),
          });
          return;
        }
        if (err instanceof UnsatisfiableDefaultValueError) {
          sendError(res, 400, {
            code: 'VALIDATION_ERROR',
            message: 'One or more keys have a defaultValue that fails their own schema. Nothing was written.',
            details: [{ key: err.key, message: err.errors.join('; ') }],
          });
          return;
        }
        // eslint-disable-next-line no-console
        console.error('[config-service] key manifest reconciliation failed', err);
        res.status(500).json({ error: 'internal_error', message: 'Failed to register key definitions. Nothing was written.' });
      } finally {
        client.release();
      }
    },
  );

  return router;
}
