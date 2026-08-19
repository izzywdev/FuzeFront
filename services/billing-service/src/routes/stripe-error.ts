import type { Response } from 'express';

/**
 * Maps a Stripe SDK error (or any thrown value) to an appropriate HTTP status
 * + structured `{ error, code, message }` body.
 *
 * WHY: previously ANY Stripe failure was surfaced as a 502. Cloudflare then
 * renders a generic "error code: 502" that hides the real cause, and — worse —
 * a *client* error (a card decline, a validation problem, or an idempotency-key
 * conflict) is not an upstream/gateway failure at all and must not be reported
 * as one. We classify:
 *
 *   - `StripeIdempotencyError` / a `idempotency_error` code  -> 409 Conflict
 *     (the deterministic key was reused with different params — see BUG 1; this
 *     is a client/caller problem, retryable with a fresh key, not a 5xx).
 *   - `StripeInvalidRequestError` and other client (4xx) Stripe errors
 *     (`StripeCardError`, validation, rate-limit) -> the Stripe `statusCode`
 *     (400/402/409/429) so the real cause survives to the browser.
 *   - genuine upstream/unknown failures (`StripeConnectionError`,
 *     `StripeAPIError`, 5xx, or a non-Stripe throw) -> 502.
 *
 * Stripe errors carry a discriminating `type` (e.g. `StripeInvalidRequestError`),
 * a machine `code` (e.g. `idempotency_error`, `card_declined`), and an HTTP
 * `statusCode`. We read them defensively so a non-Stripe throw still maps to 502.
 */
export interface StripeErrorShape {
  type?: string;
  rawType?: string;
  code?: string;
  statusCode?: number;
  message?: string;
}

export interface MappedStripeError {
  status: number;
  body: { error: string; code: string; message: string };
}

export function mapStripeError(err: unknown): MappedStripeError {
  const e = (err && typeof err === 'object' ? (err as StripeErrorShape) : {}) || {};
  const type = e.type || e.rawType || '';
  const code = e.code || '';
  const message = err instanceof Error ? err.message : String(err);

  // Idempotency-key conflict: the same key was reused with different params.
  // Retryable by the caller with a new key — a Conflict, not an upstream error.
  if (type === 'StripeIdempotencyError' || code === 'idempotency_error') {
    return {
      status: 409,
      body: { error: 'idempotency conflict', code: code || 'idempotency_error', message },
    };
  }

  // Client/validation/card errors carry their own 4xx statusCode — forward it
  // faithfully so the browser sees the real cause (e.g. 402 card_declined).
  const clientTypes = new Set([
    'StripeInvalidRequestError',
    'StripeCardError',
    'StripeRateLimitError',
    'StripeIdempotencyError',
  ]);
  const statusCode = typeof e.statusCode === 'number' ? e.statusCode : undefined;
  if (clientTypes.has(type) || (statusCode !== undefined && statusCode >= 400 && statusCode < 500)) {
    const status = statusCode && statusCode >= 400 && statusCode < 500 ? statusCode : 400;
    return {
      status,
      body: {
        error: 'stripe request error',
        code: code || type || 'stripe_invalid_request',
        message,
      },
    };
  }

  // Genuine upstream/unknown failure (connection error, Stripe 5xx, non-Stripe
  // throw) -> 502 Bad Gateway.
  return {
    status: 502,
    body: { error: 'stripe error', code: code || type || 'stripe_upstream_error', message },
  };
}

/** Convenience: map + write the response in one call. */
export function sendStripeError(res: Response, err: unknown): Response {
  const { status, body } = mapStripeError(err);
  return res.status(status).json(body);
}
