import type { Request, Response } from 'express';

/**
 * A meter name identifies the type of resource being measured.
 * Examples: 'api_calls', 'tokens_consumed', 'storage_bytes'
 */
export type MeterName = string;

/**
 * A single usage event to be emitted to the billing topic.
 * Shape matches what billing-service/src/services/metering.service.ts expects.
 */
export interface UsageEvent {
  /** The meter name registered in Stripe Billing (e.g. 'api_calls'). */
  meterEventName: MeterName;
  /** Quantity consumed (calls: 1, tokens: N, bytes: N). */
  quantity: number;
  /** Whether the entity is an organization or individual user. */
  entityType: 'organization' | 'user';
  /** The entity id (org id or user id). */
  entityId: string;
  /** ISO 8601 timestamp of when the usage occurred. */
  timestamp: string;
}

/**
 * Configuration for the MeteringClient.
 */
export interface MeteringClientConfig {
  /** Kafka connection config. Typically sourced from KAFKA_BROKERS env. */
  kafka: { brokers: string[] };
  /** Topic to produce to. Defaults to 'billing.usage'. */
  topic?: string;
  /** Identifying name of the producing service, e.g. 'inference-service'. */
  serviceName: string;
}

/**
 * Options for the Express metering middleware factory.
 */
export interface EndpointMeteringOptions {
  /**
   * Which meter to record. Default: 'api_calls'.
   * The meter name must be registered in Stripe Billing.
   */
  meter?: MeterName;
  /**
   * Quantity to record per request.
   * - number: fixed quantity (default: 1)
   * - function: computed from the request/response pair (called after finish)
   */
  quantity?: number | ((req: Request, res: Response) => number);
  /**
   * Extract the billable entity id from the request.
   * Typically: `(req) => req.user?.orgId` or `(req) => req.user?.id`
   */
  entityIdFromRequest: (req: Request) => string;
  /** Entity type. Default: 'organization'. */
  entityType?: 'organization' | 'user';
  /**
   * Optional predicate — when it returns true the event is NOT emitted.
   * Use for health checks, metrics probes, internal traffic, etc.
   */
  skip?: (req: Request) => boolean;
}
