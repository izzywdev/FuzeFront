import { configureIdentity } from '@izzywdev/fuzefront-identity';
import { initTelemetry, type TelemetryHandle } from '@fuzefront/telemetry';
import { loadConfig } from './config';
import { createApp } from './app';
import { createPool, runMigrations } from './db';
import { startLifecycleConsumers, LifecycleConsumers } from './events/consumer';
import { createConfigChangePublisher } from './events/publisher';

// Dual-accept window for portal/organization/user — DELIBERATELY STILL OPEN
// (FFRNT-185 follow-up; governance/identifier-standard.md §8). Do not "tidy" it
// closed: the family-wide removal criterion ("TypeID is the sole format") is
// blocked here, and this comment is the tracked blocker.
//
// Why it cannot be emptied today: config-service's stored ids are fine
// (config_values.scope_id is a native uuid, rendered back to TypeID on the wire
// by fromUuid), but one INPUT path is not. A write's ancestor chain is built from
// the caller's JWT claims (routes/config.write.ts -> buildWriteChain, which adds
// `principal.portalId` and, for user-scope writes, `principal.orgId`), and
// ValueRepository runs assertRef(<type>, scopeId) on every chain entry. Those
// claims are minted by the security service as BARE database uuids:
//   - `orgId`  = organizations.id via canonicalSessionTenant()
//                (backend/security/src/services/orgSessionToken.ts)
//   - `portalId` is read as-is from the claim (src/middleware/auth.ts)
// With the window closed, assertRef throws LEGACY_NOT_PERMITTED for those bare
// claims and every user-scope write by an org-scoped session fails. The
// prefixed-ids flag does not help: it only changes API *response* bodies, not
// token claims. `user` stays listed because the JWT `userId` claim is likewise a
// bare users.id and a client may echo it as a user-scope id; that is not
// provably unused, so it is not narrowed here.
//
// To close it, one of these must land first (then empty this set and drop the
// matching legacyUuidTypes in tests/routes/*.test.ts, tests/repositories/*.test.ts):
//   (a) the security service mints orgId/userId/portalId claims in wire form, or
//   (b) config-service canonicalises principal claims to wire form at its auth
//       boundary (src/middleware/auth.ts) before they reach buildWriteChain.
// Client-supplied scope ids (body/query) are TypeID once the shell consumes the
// prefixed responses; only the JWT-claim path is outstanding.
configureIdentity({
  legacyUuidTypes: new Set(['portal', 'organization', 'user']),
});

// Bootstrap OpenTelemetry BEFORE the express app is constructed below (see
// backend/security/src/index.ts for the full rationale). Sends OTLP to
// FuzeInfra's Collector; endpoint/protocol/sampling default from OTEL_* env.
// npm_package_version is only set by an npm lifecycle script; the production
// Dockerfile runs `node dist/index.js` directly, so it's always undefined
// there and every span's service.version would be silently empty. Read the
// version straight from package.json instead.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SERVICE_VERSION: string = require('../package.json').version;
const telemetry: TelemetryHandle = initTelemetry({
  serviceName: 'config-service',
  serviceVersion: SERVICE_VERSION,
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
  // config.changed producer (FF-EPIC-18-S4). null when KAFKA_BROKERS is unset;
  // otherwise connects lazily on first publish, so it can never delay startup
  // or fail a write (see src/events/publisher.ts).
  const events = createConfigChangePublisher();
  // eslint-disable-next-line no-console
  console.log(
    events
      ? '[config-service] config.changed publisher enabled'
      : '[config-service] KAFKA_BROKERS unset — config.changed events not published',
  );
  const app = createApp(pool ? { pool, events } : undefined);
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
    const closeServer = () => {
      const done = () =>
        server.close(() => {
          // Flush any spans still buffered before the process exits — otherwise
          // the last few requests before shutdown silently never reach Tempo.
          telemetry
            .shutdown()
            .catch((err) => {
              // eslint-disable-next-line no-console
              console.error('[config-service] telemetry shutdown error:', err);
            })
            .finally(() => process.exit(0));
        });
      // Disconnect the config.changed publisher before the listener closes;
      // `.finally` so a broker failure never blocks shutdown or the span flush.
      if (events) events.disconnect().finally(done);
      else done();
    };
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
