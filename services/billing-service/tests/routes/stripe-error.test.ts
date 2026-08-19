/**
 * Unit tests for the Stripe-error -> HTTP-status mapper (BUG 2).
 *
 * Classifies thrown Stripe SDK errors so the checkout handler returns a faithful
 * status instead of a blanket 502: idempotency conflict -> 409, client/validation/
 * card errors -> their 4xx, genuine upstream/unknown -> 502.
 */
import { mapStripeError } from '../../src/routes/stripe-error';

describe('mapStripeError', () => {
  it('idempotency_error -> 409', () => {
    const m = mapStripeError(
      Object.assign(new Error('Keys for idempotent requests can only be used with the same parameters'), {
        type: 'StripeIdempotencyError',
        code: 'idempotency_error',
        statusCode: 400,
      }),
    );
    expect(m.status).toBe(409);
    expect(m.body.code).toBe('idempotency_error');
    expect(m.body.message).toContain('same parameters');
  });

  it('StripeInvalidRequestError (400) -> 400', () => {
    const m = mapStripeError(
      Object.assign(new Error('No such price'), {
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
        statusCode: 400,
      }),
    );
    expect(m.status).toBe(400);
    expect(m.body.code).toBe('resource_missing');
  });

  it('StripeCardError (402) -> 402 (forwarded faithfully)', () => {
    const m = mapStripeError(
      Object.assign(new Error('Your card was declined'), {
        type: 'StripeCardError',
        code: 'card_declined',
        statusCode: 402,
      }),
    );
    expect(m.status).toBe(402);
    expect(m.body.code).toBe('card_declined');
  });

  it('StripeRateLimitError (429) -> 429', () => {
    const m = mapStripeError(
      Object.assign(new Error('Too many requests'), {
        type: 'StripeRateLimitError',
        code: 'rate_limit',
        statusCode: 429,
      }),
    );
    expect(m.status).toBe(429);
  });

  it('StripeConnectionError -> 502 (genuine upstream)', () => {
    const m = mapStripeError(
      Object.assign(new Error('connection reset'), { type: 'StripeConnectionError' }),
    );
    expect(m.status).toBe(502);
  });

  it('Stripe 5xx (StripeAPIError) -> 502', () => {
    const m = mapStripeError(
      Object.assign(new Error('internal'), { type: 'StripeAPIError', statusCode: 500 }),
    );
    expect(m.status).toBe(502);
  });

  it('a plain non-Stripe Error -> 502', () => {
    const m = mapStripeError(new Error('boom'));
    expect(m.status).toBe(502);
    expect(m.body.message).toBe('boom');
  });

  it('always returns a structured {error, code, message} body', () => {
    const m = mapStripeError('weird string throw');
    expect(m.body).toEqual(
      expect.objectContaining({ error: expect.any(String), code: expect.any(String), message: expect.any(String) }),
    );
  });
});
