import express, { Application, Request, Response } from 'express';

/**
 * Assembles the config-service Express app.
 *
 * This is a HEALTH-CHECK-ONLY skeleton for FFRNT-154/155/156 (catalog schema,
 * values schema, resolution engine) — no `/v1/*` routes are mounted here.
 * FFRNT-157 (GET /v1/config, catalog listing) and FFRNT-158 (PUT /v1/config —
 * writes/locks) own the HTTP surface and build on this scaffold.
 */
export function createApp(): Application {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'config-service' });
  });

  // ── EXTENSION POINT (FFRNT-157 / FFRNT-158) ──────────────────────────────
  // Mount here, built on THIS PR's scaffold:
  //   - GET  /v1/namespaces               -> repositories/namespace.repository.ts
  //   - PUT  /v1/namespaces/:namespace/keys -> repositories/key-definition.repository.ts
  //          (KeyDefinitionRepository.create validates defaultValue via
  //          validation/schema.ts#validateDefaultValue — S2 AC4)
  //   - GET  /v1/config                   -> repositories/value.repository.ts
  //          (ValueRepository.listForDefinitions) feeds
  //          resolver/resolve.ts#resolveEffectiveConfig (pure, DB-free) which
  //          produces the EffectiveConfigEntry[] response body.
  //   - PUT  /v1/config                   -> repositories/value.repository.ts
  //          (ValueRepository.setValue/unsetValue), which already refuses a
  //          disallowed scope (ScopeNotAllowedError) or an invalid scope
  //          reference (InvalidScopeReferenceError) before writing.
  // Route ordering, Permit gating, ETag/If-None-Match, ConfigWriteRequest's
  // batch-transaction semantics, and pagination (gate-pagination, for the two
  // list endpoints) are this extension's responsibility per
  // services/config-service/openapi.yaml — the frozen contract.

  return app;
}
