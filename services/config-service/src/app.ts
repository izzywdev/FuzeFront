import express, { Application, Request, Response } from 'express';
import { Pool } from 'pg';
import { PgNamespaceRepository } from './repositories/namespace.repository';
import { PgKeyDefinitionRepository } from './repositories/key-definition.repository';
import { PgValueRepository } from './repositories/value.repository';
import { createConfigReadRouter } from './routes/config-read.routes';
import { createWriteRouter } from './routes/write.router';

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
  // Each story mounts its OWN router module here, in ITS OWN `app.use(...)`
  // call — both read from `deps.pool`, so a namespace/key-definition/value
  // repo is only ever constructed once per story's router, and neither
  // story's router touches the other's routes.
  //   - GET  /v1/namespaces, GET /v1/namespaces/{namespace}/keys[/{key}],
  //     GET  /v1/config                    -> FFRNT-157 (createConfigReadRouter)
  //   - POST /v1/namespaces, PUT /v1/namespaces/{namespace}/keys,
  //     PUT  /v1/config                    -> FFRNT-158 (createWriteRouter)
  // Route ordering, Permit gating, ETag/If-None-Match, ConfigWriteRequest's
  // batch-transaction semantics, and pagination (gate-pagination, for the
  // list endpoints) are each router's own responsibility per
  // services/config-service/openapi.yaml — the frozen contract.
  if (deps) {
    const namespaceRepo = new PgNamespaceRepository(deps.pool);
    const keyDefinitionRepo = new PgKeyDefinitionRepository(deps.pool);
    const valueRepo = new PgValueRepository(deps.pool);
    app.use('/v1', createConfigReadRouter({ namespaceRepo, keyDefinitionRepo, valueRepo })); // FFRNT-157 (GET routes)
    // Shares deps.pool rather than letting createWriteRouter() open its own —
    // one pool per process, not one per story's router.
    app.use(createWriteRouter(deps.pool)); // FFRNT-158 (POST/PUT write routes)
  }

  return app;
}
