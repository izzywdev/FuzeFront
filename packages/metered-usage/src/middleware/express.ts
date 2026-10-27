import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { MeteringClient } from '../client';
import type { EndpointMeteringOptions } from '../types';

/**
 * Express middleware factory that emits a metered usage event after the
 * response is sent.
 *
 * Behaviour:
 * - Hooks into `res.on('finish', …)` — never blocks the response path.
 * - Does NOT emit when `options.skip?.(req)` returns true.
 * - Does NOT emit when the resolved entityId is falsy (no authenticated
 *   entity — avoid attributing usage to an empty id).
 * - Errors from the client are swallowed inside MeteringClient.emit();
 *   this middleware adds no additional error surface.
 *
 * Feature flag: fuzefront.billing.metered-usage-emit (release, default OFF)
 * When the flag is OFF the middleware is a no-op. Evaluate the flag before
 * mounting the middleware, or guard inside entityIdFromRequest.
 *
 * Usage:
 * ```ts
 * import { MeteringClient } from '@fuzefront/metered-usage';
 * import { meteringMiddleware } from '@fuzefront/metered-usage/middleware/express';
 *
 * const client = MeteringClient.fromEnv('my-service');
 * app.use('/api/v1', meteringMiddleware(client, {
 *   entityIdFromRequest: (req) => req.user?.orgId ?? '',
 * }));
 * ```
 */
export function meteringMiddleware(
  client: MeteringClient,
  options: EndpointMeteringOptions,
): RequestHandler {
  return function meteringHandler(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    res.on('finish', () => {
      // Skip if predicate says so
      if (options.skip?.(req)) return;

      // Resolve entity
      const entityId = options.entityIdFromRequest(req);
      if (!entityId) return;

      const entityType = options.entityType ?? 'organization';
      const meterEventName = options.meter ?? 'api_calls';

      // Resolve quantity — supports static number or dynamic function
      let quantity: number;
      if (typeof options.quantity === 'function') {
        try {
          quantity = options.quantity(req, res);
        } catch {
          quantity = 1;
        }
      } else {
        quantity = options.quantity ?? 1;
      }

      // Fire-and-forget: emit() swallows errors internally
      client
        .emit({
          meterEventName,
          quantity,
          entityType,
          entityId,
          timestamp: new Date().toISOString(),
        })
        .catch(() => {
          // MeteringClient.emit() already catches internally — this branch is
          // a belt-and-suspenders guard for unexpected synchronous throws.
        });
    });

    next();
  };
}
