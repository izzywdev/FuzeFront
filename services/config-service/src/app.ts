import express, { Application, Request, Response } from 'express';
import { Pool } from 'pg';
import { PgNamespaceRepository } from './repositories/namespace.repository';
import { PgKeyDefinitionRepository } from './repositories/key-definition.repository';
import { PgValueRepository } from './repositories/value.repository';
import { createConfigReadRouter } from './routes/config-read.routes';

/**
 * Optional, DB-backed dependencies. Omitted -> the HEALTH-CHECK-ONLY skeleton
 * (existing behaviour, `createApp()` with no args) so the scaffold's own
 * `/health` test keeps passing unchanged.
 */
export interface AppDeps {
  pool: Pool;
}

/**
 * Assembles the config-service Express app.
 *
 * FFRNT-154/155/156 shipped this as a HEALTH-CHECK-ONLY skeleton. FFRNT-157
 * (GET /v1/config, catalog listing) and FFRNT-158 (PUT /v1/config —
 * writes/locks) build the `/v1/*` HTTP surface on top of it.
 */
export function createApp(deps?: AppDeps): Application {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'config-service' });
  });

  // ── EXTENSION POINT (FFRNT-157 / FFRNT-158) ──────────────────────────────
  // Each story mounts its OWN router module here, in ITS OWN `app.use('/v1', ...)`
  // call — both read from `deps.pool`, so a namespace/key-definition/value repo
  // is only ever constructed once per story's router, and neither story's
  // router touches the other's routes.
  if (deps) {
    const namespaceRepo = new PgNamespaceRepository(deps.pool);
    const keyDefinitionRepo = new PgKeyDefinitionRepository(deps.pool);
    const valueRepo = new PgValueRepository(deps.pool);
    app.use('/v1', createConfigReadRouter({ namespaceRepo, keyDefinitionRepo, valueRepo })); // FFRNT-157 (GET routes)
    // FFRNT-158 mounts its write router (PUT /v1/config, POST/PUT /v1/namespaces*) here too.
  }

  return app;
}
