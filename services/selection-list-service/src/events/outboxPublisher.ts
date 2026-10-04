// events/outboxPublisher.ts — Kafka transport for the outbox relay.
//
// Builds the FuzeEvent envelope, derives the partition key
// (`partitionKeyForPayload` -> `organizationId`, so one org's events share a
// partition and stay ordered), validates against the shared schema registry via
// TypedProducer.send, and implements the `<topic>.dlq` copy. The producer is
// injected (`getProducer`) so everything here is unit-testable with a fake;
// `createKafkaOutboxPublisher` supplies the real lazily-connected one.
//
// `startOutboxRelayFromEnv` is the bootstrap entry point: it starts the relay
// ONLY when KAFKA_BROKERS is set (events stay durably in `event_outbox` until a
// broker is configured) and returns a handle, or null.

import type { Knex } from 'knex';
import type { Logger } from 'pino';
import type { ZodSchema } from 'zod';
import {
  FuzeEvent,
  TypedProducer,
  createKafkaClient,
  dlqTopic,
  partitionKeyForPayload,
  schemaForTopic,
} from '@fuzefront/shared/kafka';
import { logger as rootLogger } from '../lib/logger';
import { OutboxDeadLetter, OutboxPublish, OutboxRecord, OutboxRelayHandle, startOutboxRelay } from './outboxRelay';

/** Envelope version for every V1 selection-lists schema (plan section 5). */
export const ENVELOPE_VERSION = '1.0';

/** The producer surface the publisher needs - satisfied by `TypedProducer`. */
export interface ProducerLike {
  send<T>(topic: string, event: FuzeEvent<T>, schema: ZodSchema<T>, options?: { key?: string }): Promise<void>;
  raw: { send(payload: { topic: string; messages: Array<{ key?: string; value: string }> }): Promise<unknown> };
  disconnect(): Promise<void>;
}

export interface KafkaOutboxPublisher {
  publish: OutboxPublish;
  deadLetter: OutboxDeadLetter;
  disconnect: () => Promise<void>;
}

export function makeOutboxPublisher(getProducer: () => Promise<ProducerLike>): KafkaOutboxPublisher {
  const publish: OutboxPublish = async (record: OutboxRecord) => {
    // A connect/send failure throws -> the relay leaves the row pending.
    const producer = await getProducer();
    const schema = schemaForTopic(record.topic);
    if (!schema) throw new Error(`no schema registered for ${record.topic}`);
    const event: FuzeEvent<unknown> = {
      version: ENVELOPE_VERSION,
      topic: record.topic as FuzeEvent['topic'],
      correlationId: record.correlationId,
      // When the change was committed, not when the relay got to it.
      occurredAt: record.createdAt.toISOString(),
      payload: record.payload,
    };
    await producer.send(record.topic, event, schema as ZodSchema<unknown>, { key: partitionKeyForPayload(record.payload) });
  };

  const deadLetter: OutboxDeadLetter = async (record, reason) => {
    const producer = await getProducer();
    await producer.raw.send({
      topic: dlqTopic(record.topic),
      messages: [
        {
          key: partitionKeyForPayload(record.payload),
          value: JSON.stringify({
            raw: {
              eventId: record.id,
              topic: record.topic,
              organizationId: record.organizationId,
              correlationId: record.correlationId,
              attempts: record.attempts,
              payload: record.payload,
            },
            reason,
            parkedAt: new Date().toISOString(),
          }),
        },
      ],
    });
  };

  const disconnect = async (): Promise<void> => {
    const producer = await getProducer().catch(() => null);
    if (producer) await producer.disconnect();
  };

  return { publish, deadLetter, disconnect };
}

/** A real, lazily-connected, reconnect-on-failure Kafka producer. */
export function createKafkaOutboxPublisher(config: { brokers: string[]; clientId?: string }): KafkaOutboxPublisher {
  let producer: TypedProducer | null = null;
  let connecting: Promise<TypedProducer> | null = null;

  const getProducer = async (): Promise<ProducerLike> => {
    if (producer) return producer;
    if (!connecting) {
      connecting = (async () => {
        const kafka = createKafkaClient({ clientId: config.clientId ?? 'selection-list-service-outbox', brokers: config.brokers });
        const p = new TypedProducer(kafka);
        await p.connect();
        producer = p;
        return p;
      })().catch((err) => {
        connecting = null; // never cache a failed connection
        throw err;
      });
    }
    return connecting;
  };

  const base = makeOutboxPublisher(getProducer);
  return {
    ...base,
    disconnect: async () => {
      if (producer) {
        const p = producer;
        producer = null;
        connecting = null;
        await p.disconnect();
      }
    },
  };
}

export interface OutboxRelayFromEnvHandle extends OutboxRelayHandle {
  disconnect: () => Promise<void>;
}

/**
 * Start the relay wired to Kafka from the environment, or return null (a
 * no-op) when KAFKA_BROKERS is unset so events simply accumulate in
 * `event_outbox`. Never throws.
 */
export function startOutboxRelayFromEnv(opts: { db: Knex; logger?: Logger; env?: NodeJS.ProcessEnv }): OutboxRelayFromEnvHandle | null {
  const log = opts.logger ?? rootLogger;
  const env = opts.env ?? process.env;
  const brokersRaw = env.KAFKA_BROKERS;
  if (!brokersRaw || brokersRaw.trim() === '') {
    log.info({ component: 'outbox-relay' }, 'KAFKA_BROKERS unset - outbox relay disabled (events are held in event_outbox)');
    return null;
  }
  const brokers = brokersRaw.split(',').map((b) => b.trim()).filter(Boolean);
  const { publish, deadLetter, disconnect } = createKafkaOutboxPublisher({ brokers });
  const intervalMs = Number(env.OUTBOX_RELAY_INTERVAL_MS) || 1000;
  const retention = env.OUTBOX_SENT_RETENTION_HOURS === undefined ? undefined : Number(env.OUTBOX_SENT_RETENTION_HOURS);
  const handle = startOutboxRelay({
    db: opts.db,
    publish,
    deadLetter,
    intervalMs,
    sentRetentionHours: Number.isFinite(retention as number) ? retention : undefined,
    logger: log,
  });
  log.info({ component: 'outbox-relay', brokers: brokers.length, intervalMs }, 'outbox relay started');
  return {
    stop: handle.stop,
    disconnect: () => disconnect().catch((err) => log.warn({ err, component: 'outbox-relay' }, 'outbox producer disconnect failed')),
  };
}
