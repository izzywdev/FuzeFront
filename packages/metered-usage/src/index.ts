/**
 * @fuzefront/metered-usage
 *
 * Client-side metering package for FuzeFront product services.
 *
 * Emits Kafka events consumed by billing-service, which flushes them to
 * Stripe Billing Meter Events.
 *
 * Usage:
 * ```ts
 * import { MeteringClient, meteringMiddleware } from '@fuzefront/metered-usage';
 *
 * const client = MeteringClient.fromEnv('my-service');
 *
 * // Mount on Express router
 * app.use('/api/v1', meteringMiddleware(client, {
 *   entityIdFromRequest: (req) => req.user?.orgId ?? '',
 *   skip: (req) => req.path === '/health',
 * }));
 *
 * // Or emit explicitly after an LLM call
 * emitTokenUsage(client, orgId, result.usage.totalTokens);
 *
 * // Graceful shutdown
 * process.on('SIGTERM', async () => {
 *   await client.flush();
 * });
 * ```
 */

// Core client
export { MeteringClient } from './client';

// Types
export type {
  MeterName,
  UsageEvent,
  MeteringClientConfig,
  EndpointMeteringOptions,
} from './types';

// Express middleware factory
export { meteringMiddleware } from './middleware/express';

// Explicit helpers for token and storage usage
export { emitTokenUsage, emitStorageUsage } from './middleware/tokens';
