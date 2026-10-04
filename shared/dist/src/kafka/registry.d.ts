import { ZodTypeAny } from 'zod';
/**
 * Single source of truth mapping each topic to the frozen Zod schema for its
 * payload. Producers and the outbox relay look schemas up here to validate
 * before publishing; a topic with no entry is published without validation.
 *
 * Any language binding (e.g. the Python `fuzefront-events` package) mirrors this
 * registry so validation and topic coverage stay identical across the family.
 */
export declare const SCHEMA_BY_TOPIC: Readonly<Record<string, ZodTypeAny>>;
/** Returns the payload schema for a topic, or undefined if none is registered. */
export declare function schemaForTopic(topic: string): ZodTypeAny | undefined;
/**
 * Derives the Kafka partition key from an event payload so all events for one
 * entity stay ordered on a single partition. Falls through the common id fields;
 * returns undefined when none is present (round-robin). Defined here — in the
 * contract — so every language binding derives the key identically.
 */
export declare function partitionKeyForPayload(payload: any): string | undefined;
