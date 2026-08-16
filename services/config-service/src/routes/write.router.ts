/**
 * FFRNT-158 (FF-EPIC-17-S6) write-surface aggregator.
 *
 * Composes every write route this story owns (`POST /v1/namespaces`,
 * `PUT /v1/namespaces/{namespace}/keys`, `PUT /v1/config`) into ONE router so
 * `src/app.ts`'s EXTENSION POINT only ever needs a single line for this
 * story's half of the surface — the sibling GET routes (FFRNT-157) are a
 * separate aggregator mounted on their own line.
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

export function createWriteRouter(pool?: Pool): Router {
  const resolvedPool = pool ?? createPool(loadConfig().databaseUrl ?? process.env.DATABASE_URL ?? '');

  const router = Router();
  router.use(createNamespacesWriteRouter(resolvedPool));
  router.use(createKeyDefinitionsWriteRouter(resolvedPool));
  router.use(createConfigWriteRouter(resolvedPool));
  return router;
}
