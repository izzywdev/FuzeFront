import type { EvaluationContext } from '@openfeature/server-sdk';
import type { FuzeFlagsContext } from './types';

/**
 * Map a Fuze evaluation context onto an OpenFeature EvaluationContext.
 *
 * - `userId` becomes `targetingKey` (OpenFeature's canonical stickiness key,
 *   which Unleash uses for gradual-rollout / per-user stickiness).
 * - `environment`, `orgId`, `tenantId`, `app` are emitted as custom fields
 *   under those exact key names so Unleash constraints can target them.
 * - Any other keys are passed through as custom fields when they are a
 *   primitive OpenFeature value (string | number | boolean | Date).
 */
export function toEvaluationContext(ctx?: FuzeFlagsContext): EvaluationContext {
  const out: EvaluationContext = {};
  if (!ctx) return out;

  const { userId, ...rest } = ctx;
  if (userId !== undefined && userId !== null) {
    out.targetingKey = String(userId);
  }

  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined || value === null) continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value instanceof Date
    ) {
      out[key] = value;
    } else {
      // Non-primitive values get stringified so they remain targetable.
      out[key] = String(value);
    }
  }

  return out;
}
