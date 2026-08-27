/**
 * FFRNT-158 (FF-EPIC-17-S6) + FFRNT-280 (FF-EPIC-18) write-surface aggregator.
 *
 * Composes every non-GET route on the surface (`POST /v1/namespaces`,
 * `PUT /v1/namespaces/{namespace}/keys`, `PUT /v1/config`, and the
 * reveal-once `POST /v1/config/secrets/reveal`) into ONE router so
 * `src/app.ts`'s EXTENSION POINT only ever needs a single line for this
 * half of the surface — the sibling GET routes (FFRNT-157 + FFRNT-280's own
 * `GET /v1/config/history`) are a separate aggregator mounted on their own
 * line.
 *
 * Self-contained: builds its own `Pool` from `DATABASE_URL` when one isn't
 * injected, so mounting it never requires changing `createApp()`'s
 * signature. Tests inject a fake/mock `Pool` directly.
 */

import { Router } from 'express';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { createPool } from '../db';
import { createNamespacesWriteRouter } from './namespaces.write';
import { createKeyDefinitionsWriteRouter } from './keys.write';
import { createConfigWriteRouter } from './config.write';
import { createSecretsWriteRouter } from './secrets.write';

export function createWriteRouter(pool?: Pool): Router {
  const resolvedPool = pool ?? createPool(loadConfig().databaseUrl ?? process.env.DATABASE_URL ?? '');

  const router = Router();
  router.use(createNamespacesWriteRouter(resolvedPool));
  router.use(createKeyDefinitionsWriteRouter(resolvedPool));
  router.use(createConfigWriteRouter(resolvedPool));
  router.use(createSecretsWriteRouter(resolvedPool));
  return router;
}
