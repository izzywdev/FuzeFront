import { configureIdentity } from '@izzywdev/fuzefront-identity';
import { loadConfig } from './config';
import { createApp } from './app';
import { createPool, runMigrations } from './db';

// governance/identifier-standard.md §8 ("Migration"): portal/organization/user
// ids are spine types minted elsewhere in the family that have NOT yet been
// backfilled to the prefixed TypeID form everywhere they are written (see the
// `--source` backstop's ~41-site backlog). config_values.scope_id references
// exactly those three types, so this widens assertRef()/parseId() to accept
// today's bare-UUID reality rather than rejecting every real scope reference
// the moment FFRNT-157/158 wire this scaffold to HTTP. Narrow this (drop the
// widening) once the family-wide `fuzefront.identity.prefixed-ids` rollout
// backfills portal/organization/user.
configureIdentity({
  legacyUuidTypes: new Set(['portal', 'organization', 'user']),
});

async function main(): Promise<void> {
  const config = loadConfig();

  let pool: ReturnType<typeof createPool> | undefined;
  if (config.databaseUrl) {
    pool = createPool(config.databaseUrl);
    try {
      await runMigrations(pool);
      // eslint-disable-next-line no-console
      console.log('[config-service] DB migrations complete');
    } catch (err) {
      // FAIL FAST. Continuing here produced the worst possible outcome: the
      // process listened, `/health` answered 200 unconditionally, both probes
      // went green, and every `/v1/*` route 500'd on a missing relation — a
      // rollout that LOOKS healthy while serving nothing. A crash-loop is
      // strictly better: it is visible, it blocks the rollout, and it names
      // the cause in the pod logs.
      // eslint-disable-next-line no-console
      console.error('[config-service] DB migration failed — refusing to start:', err);
      throw err;
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn('[config-service] DATABASE_URL missing — serving /health only');
  }

  // Reaching here means migrations succeeded (the catch above rethrows), so
  // the /v1/* routes are only ever wired over a schema that actually exists.
  // Liveness stays on the shallow `/health`; readiness uses `/health/ready`,
  // which pings the DB — so a database that disappears LATER takes the pod
  // out of the Service without triggering a liveness restart loop.
  const app = createApp(pool ? { pool } : undefined);
  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[config-service] Listening on port ${config.port}`);
  });

  const shutdown = () => {
    // eslint-disable-next-line no-console
    console.log('[config-service] Shutting down...');
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// Entrypoint. Without this the module just defines main() and never runs it.
main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[config-service] fatal startup error:', err);
  process.exit(1);
});
