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

  if (config.databaseUrl) {
    const pool = createPool(config.databaseUrl);
    try {
      await runMigrations(pool);
      // eslint-disable-next-line no-console
      console.log('[config-service] DB migrations complete');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[config-service] DB migration failed:', err);
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn('[config-service] DATABASE_URL missing — serving /health only');
  }

  const app = createApp();
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
