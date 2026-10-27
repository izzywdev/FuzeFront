import {
  createKafkaClient,
  TypedProducer,
  TypedConsumer,
  TOPICS,
  FuzeEvent,
  IdentityUserCreatedPayloadV1,
  identityUserCreatedSchemaV1,
  IdentityOrgCreatedPayloadV1,
  identityOrgCreatedSchemaV1,
  IdentityOrgUpdatedPayloadV1,
  identityOrgUpdatedSchemaV1,
  IdentityOrgDeletedPayloadV1,
  identityOrgDeletedSchemaV1,
  IdentityUserUpdatedPayloadV1,
  identityUserUpdatedSchemaV1,
  IdentityUserDeletedPayloadV1,
  identityUserDeletedSchemaV1,
  IdentityMembershipAddedPayloadV1,
  identityMembershipAddedSchemaV1,
  IdentityMembershipRemovedPayloadV1,
  identityMembershipRemovedSchemaV1,
} from '@fuzefront/shared/kafka';
import { initTelemetry, type TelemetryHandle } from '@fuzefront/telemetry';
import { loadConfig } from './config';
import {
  handleUserCreated,
  handleOrgCreated,
  handleOrgUpdated,
  handleOrgDeleted,
  handleUserUpdated,
  handleUserDeleted,
  handleMembershipAdded,
  handleMembershipRemoved,
  HandlerDeps,
} from './handler';
import { createApp } from './app';

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
  serviceName: 'provisioning-service',
  serviceVersion: SERVICE_VERSION,
});

async function main() {
  const config = loadConfig();

  // --- Kafka ---
  const kafka = createKafkaClient({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
  });

  // DLQ producer: forwards poison/schema-invalid/handler-failed messages to <topic>.dlq
  // Connected in the background (startConsumers below), not here, so a broker
  // that is down at boot cannot block startup before the health port binds.
  const dlqProducer = new TypedProducer(kafka);

  const handlerDeps: HandlerDeps = {
    securityServiceUrl: config.securityServiceUrl,
    internalProvisionSecret: config.internalProvisionSecret,
  };

  // Wrap a handler so a failure dead-letters the event (the offset still commits
  // and the consumer stays healthy) instead of crashing the loop.
  function withDlq<T>(
    topic: string,
    handler: (event: FuzeEvent<T>) => Promise<void>
  ): (event: FuzeEvent<T>) => Promise<void> {
    return async (event: FuzeEvent<T>) => {
      try {
        await handler(event);
      } catch (err) {
        console.error(
          `[provisioning-service] Handler failed for ${topic} correlationId=${event.correlationId}, routing to DLQ: ${String(err)}`
        );
        await dlqProducer.raw.send({
          topic: `${topic}.dlq`,
          messages: [
            {
              value: JSON.stringify({
                raw: JSON.stringify(event),
                reason: String(err),
                sourceTopic: topic,
              }),
            },
          ],
        });
      }
    };
  }

  // --- Consumers (constructed here; connected in the background below) ---
  // identity.user.created -> provision the user (personal org + Permit wiring)
  const userConsumer = new TypedConsumer(kafka, config.kafka.groupId);
  // identity.org.created -> reconcile the org's Permit wiring (via its owner).
  // Separate consumer/group: TypedConsumer.run binds a single schema per loop.
  const orgConsumer = new TypedConsumer(kafka, `${config.kafka.groupId}-org`);
  // identity.org.updated -> re-reconcile the org's Permit wiring.
  const orgUpdatedConsumer = new TypedConsumer(kafka, `${config.kafka.groupId}-org-updated`);
  // identity.org.deleted -> tear down the org's Permit access (soft/hard).
  const orgDeletedConsumer = new TypedConsumer(kafka, `${config.kafka.groupId}-org-deleted`);
  // identity.user.updated -> re-sync the user's profile into Permit.
  const userUpdatedConsumer = new TypedConsumer(kafka, `${config.kafka.groupId}-user-updated`);
  // identity.user.deleted -> tear down the user's Permit principal + sessions.
  const userDeletedConsumer = new TypedConsumer(kafka, `${config.kafka.groupId}-user-deleted`);
  // identity.membership.added -> assign the member's Permit role.
  const membershipAddedConsumer = new TypedConsumer(kafka, `${config.kafka.groupId}-membership-added`);
  // identity.membership.removed -> revoke the member's Permit role.
  const membershipRemovedConsumer = new TypedConsumer(kafka, `${config.kafka.groupId}-membership-removed`);

  // --- HTTP health probe ---
  // Bind the health port BEFORE connecting to Kafka so an unreachable or slow
  // broker at boot cannot block app.listen and fail the /health probe into
  // CrashLoopBackOff. The consumers connect in the background (startConsumers
  // below) with retry; until the broker is reachable the pod stays healthy and
  // simply consumes nothing.
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[provisioning-service] Listening on port ${config.port}`);
  });

  // --- Kafka consumers (background; broker connect retried) ---
  const startConsumers = async (): Promise<void> => {
    // Retry only the broker connection: once connected, subscribe/run succeed.
    for (;;) {
      try {
        await dlqProducer.connect();
        await userConsumer.connect();
        await orgConsumer.connect();
        await orgUpdatedConsumer.connect();
        await orgDeletedConsumer.connect();
        await userUpdatedConsumer.connect();
        await userDeletedConsumer.connect();
        await membershipAddedConsumer.connect();
        await membershipRemovedConsumer.connect();
        break;
      } catch (err) {
        console.error('[provisioning-service] Kafka connect failed; retrying in 5s:', err);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    await userConsumer.subscribe(TOPICS.IDENTITY_USER_CREATED);
    await userConsumer.run(
      withDlq<IdentityUserCreatedPayloadV1>(TOPICS.IDENTITY_USER_CREATED, event =>
        handleUserCreated(event, handlerDeps)
      ),
      identityUserCreatedSchemaV1,
      dlqProducer
    );

    await orgConsumer.subscribe(TOPICS.IDENTITY_ORG_CREATED);
    await orgConsumer.run(
      withDlq<IdentityOrgCreatedPayloadV1>(TOPICS.IDENTITY_ORG_CREATED, event =>
        handleOrgCreated(event, handlerDeps)
      ),
      identityOrgCreatedSchemaV1,
      dlqProducer
    );

    await orgUpdatedConsumer.subscribe(TOPICS.IDENTITY_ORG_UPDATED);
    await orgUpdatedConsumer.run(
      withDlq<IdentityOrgUpdatedPayloadV1>(TOPICS.IDENTITY_ORG_UPDATED, event =>
        handleOrgUpdated(event, handlerDeps)
      ),
      identityOrgUpdatedSchemaV1,
      dlqProducer
    );

    await orgDeletedConsumer.subscribe(TOPICS.IDENTITY_ORG_DELETED);
    await orgDeletedConsumer.run(
      withDlq<IdentityOrgDeletedPayloadV1>(TOPICS.IDENTITY_ORG_DELETED, event =>
        handleOrgDeleted(event, handlerDeps)
      ),
      identityOrgDeletedSchemaV1,
      dlqProducer
    );

    await userUpdatedConsumer.subscribe(TOPICS.IDENTITY_USER_UPDATED);
    await userUpdatedConsumer.run(
      withDlq<IdentityUserUpdatedPayloadV1>(TOPICS.IDENTITY_USER_UPDATED, event =>
        handleUserUpdated(event, handlerDeps)
      ),
      identityUserUpdatedSchemaV1,
      dlqProducer
    );

    await userDeletedConsumer.subscribe(TOPICS.IDENTITY_USER_DELETED);
    await userDeletedConsumer.run(
      withDlq<IdentityUserDeletedPayloadV1>(TOPICS.IDENTITY_USER_DELETED, event =>
        handleUserDeleted(event, handlerDeps)
      ),
      identityUserDeletedSchemaV1,
      dlqProducer
    );

    await membershipAddedConsumer.subscribe(TOPICS.IDENTITY_MEMBERSHIP_ADDED);
    await membershipAddedConsumer.run(
      withDlq<IdentityMembershipAddedPayloadV1>(TOPICS.IDENTITY_MEMBERSHIP_ADDED, event =>
        handleMembershipAdded(event, handlerDeps)
      ),
      identityMembershipAddedSchemaV1,
      dlqProducer
    );

    await membershipRemovedConsumer.subscribe(TOPICS.IDENTITY_MEMBERSHIP_REMOVED);
    await membershipRemovedConsumer.run(
      withDlq<IdentityMembershipRemovedPayloadV1>(TOPICS.IDENTITY_MEMBERSHIP_REMOVED, event =>
        handleMembershipRemoved(event, handlerDeps)
      ),
      identityMembershipRemovedSchemaV1,
      dlqProducer
    );

    console.log('[provisioning-service] Kafka consumers running');
  };
  void startConsumers();

  // --- Graceful shutdown ---
  const shutdown = async () => {
    console.log('[provisioning-service] Shutting down...');
    // Close the listener (letting in-flight requests finish) BEFORE flushing
    // telemetry — otherwise a request still in flight when SIGTERM arrives
    // either finishes after the SDK has shut down (its span lost) or is cut
    // off by process.exit(0) below.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Each disconnect is isolated: if the broker is unavailable during
    // SIGTERM and one of these rejects, an unguarded `await` chain would
    // abort right there, skipping every consumer/producer after it AND the
    // telemetry flush below — leaving buffered spans dropped and the
    // process hung for Kubernetes to kill. Caught by a Codex review on
    // PR #1489 (email-service had the identical ordering, fixed alongside).
    for (const client of [
      userConsumer,
      orgConsumer,
      orgUpdatedConsumer,
      orgDeletedConsumer,
      userUpdatedConsumer,
      userDeletedConsumer,
      membershipAddedConsumer,
      membershipRemovedConsumer,
      dlqProducer,
    ]) {
      await client.disconnect().catch((error) => {
        console.error('[provisioning-service] Error disconnecting a Kafka client during shutdown:', error);
      });
    }
    // Flush any spans still buffered before the process exits — otherwise the
    // last few requests before shutdown silently never reach Tempo.
    await telemetry.shutdown().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[provisioning-service] Fatal error:', err);
  process.exit(1);
});
