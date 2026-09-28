import { configureIdentity } from '@izzywdev/fuzefront-identity';
import { loadConfig } from './config';
import { createApp } from './app';
import { createPool, runMigrations } from './db';
import { startLifecycleConsumers, LifecycleConsumers } from './events/consumer';

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

  // Identity lifecycle consumers. Without these, a deleted org or user leaves
  // its config_values overrides behind forever (the gap
  // governance/microservice-events-policy.json tracked as `knownUnhandled`).
  //
  // Started AFTER listen() so a slow/unreachable broker can never delay the
  // port opening, and non-fatal by design: config-service's job is serving
  // /v1/config reads and writes, and refusing to start because a broker is
  // down would turn a cleanup outage into a configuration outage for every
  // consumer. A failure here is loud in the logs and the events are retained
  // by Kafka, so a later restart picks them up from the committed offset.
  let lifecycle: LifecycleConsumers | null = null;
  if (pool) {
    try {
      lifecycle = await startLifecycleConsumers(pool);
      // eslint-disable-next-line no-console
      console.log(
        lifecycle
          ? '[config-service] identity lifecycle consumers started'
          : '[config-service] KAFKA_BROKERS unset — identity lifecycle consumers not started',
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[config-service] failed to start lifecycle consumers (continuing):', err);
    }
  }

  const shutdown = () => {
    // eslint-disable-next-line no-console
    console.log('[config-service] Shutting down...');
    // Disconnect the consumers before closing the server so in-flight handlers
    // finish against a live pool rather than being cut off mid-transaction.
    const closeServer = () => server.close(() => process.exit(0));
    if (lifecycle) {
      lifecycle
        .disconnect()
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[config-service] lifecycle consumer disconnect failed:', err);
        })
        .finally(closeServer);
    } else {
      closeServer();
    }
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
