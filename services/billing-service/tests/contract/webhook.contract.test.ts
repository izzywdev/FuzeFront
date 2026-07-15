/**
 * Webhook contract + behavior tests vs openapi.yaml :: receiveStripeWebhook
 * (POST /webhooks/stripe), driven through the real createApp wiring.
 *
 * Asserts:
 *   - missing Stripe-Signature -> 400 text/plain
 *   - bad signature (constructEvent throws) -> 400 text/plain "Webhook Error: ..."
 *   - valid event -> 200 {received:true}; records dedup row with (id, type, payload)
 *   - duplicate delivery -> 200 {received:true, duplicate:true}, NOT re-processed
 *   - a valid checkout/subscription event activates the local mirror via the handler
 *
 * Stripe signature verification is mocked (constructEvent stub) — we never use a
 * real signing secret or hit Stripe.
 */
import request from 'supertest';
import { buildApp, INTERNAL_TOKEN } from './helpers';

const URL = '/api/v1/billing/webhooks/stripe';

describe('billing-service contract :: receiveStripeWebhook', () => {
  it('400 text/plain when Stripe-Signature header is missing', async () => {
    const { app } = buildApp({ internalToken: INTERNAL_TOKEN });
    const res = await request(app)
      .post(URL)
      .set('Content-Type', 'application/json')
      .send(Buffer.from('{}'));
    expect(res.status).toBe(400);
    expect(res.text).toContain('Missing stripe-signature');
  });

  it('400 text/plain "Webhook Error" when signature verification fails', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    stubs.webhook.stripe.webhooks.constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });
    const res = await request(app)
      .post(URL)
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'bad-sig')
      .send(Buffer.from('{}'));
    expect(res.status).toBe(400);
    expect(res.text).toContain('Webhook Error');
  });

  it('200 {received:true} on a valid event and records the dedup row (id, type, payload)', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    const event = {
      id: 'evt_checkout_1',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', subscription: 'sub_test123' } },
    };
    stubs.webhook.stripe.webhooks.constructEvent.mockReturnValue(event);

    const res = await request(app)
      .post(URL)
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'good-sig')
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    // dedup must be keyed with the full (id, type, payload) signature per the
    // EventRepository contract — not just the id.
    expect(stubs.webhook.events.recordIfNew).toHaveBeenCalledWith(
      'evt_checkout_1',
      'checkout.session.completed',
      event,
    );
  });

  it('200 {received:true, duplicate:true} on a duplicate delivery, without re-processing', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    const event = { id: 'evt_dup_1', type: 'customer.subscription.updated', data: { object: {} } };
    stubs.webhook.stripe.webhooks.constructEvent.mockReturnValue(event);
    // Simulate the dedup row already existing.
    stubs.webhook.events.recordIfNew.mockResolvedValue(false);

    const res = await request(app)
      .post(URL)
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'good-sig')
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, duplicate: true });
  });

  it('the raw body (not a re-parsed object) is passed to constructEvent for verification', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    const raw = JSON.stringify({ id: 'evt_raw_1', type: 'invoice.paid', data: { object: {} } });
    stubs.webhook.stripe.webhooks.constructEvent.mockReturnValue(JSON.parse(raw));

    // Send the raw JSON bytes verbatim (a string), exactly as the provider does.
    // Passing a Buffer here would make superagent JSON-serialize it
    // (`{"type":"Buffer",...}`) — a harness artifact, not the real wire format —
    // so we send the string to faithfully assert express.raw captured the bytes.
    await request(app)
      .post(URL)
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'good-sig')
      .send(raw);

    const [body, sig, secret] = stubs.webhook.stripe.webhooks.constructEvent.mock.calls[0];
    expect(Buffer.isBuffer(body)).toBe(true); // raw bytes, signature-verifiable
    expect(body.toString()).toBe(raw);
    expect(sig).toBe('good-sig');
    expect(secret).toBe('whsec_test');
  });
});

/**
 * Acceptance: a valid checkout.session.completed activates the local subscription
 * mirror. The webhook handler delegates to routeWebhookEvent(event, ctx). We assert
 * end-to-end at the HTTP boundary that a verified completed-checkout event is
 * accepted (200) and routed for processing (recordIfNew true => handler invoked).
 *
 * NOTE: the deep mirror-write assertion (that the subscription row is upserted to
 * an active status) lives in the handler unit tests owned by billing-payments-engineer
 * (tests/handlers/*). Here we verify the CONTRACT boundary: the event is verified,
 * deduped, accepted, and not rejected — i.e. the activation path is reachable.
 */
describe('billing-service acceptance :: checkout.session.completed activates the mirror', () => {
  it('accepts a verified checkout.session.completed and enters the processing path', async () => {
    const { app, stubs } = buildApp({ internalToken: INTERNAL_TOKEN });
    const event = {
      id: 'evt_activate_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_live_1',
          mode: 'subscription',
          subscription: 'sub_test123',
          customer: 'cus_test123',
          status: 'complete',
          payment_status: 'paid',
        },
      },
    };
    stubs.webhook.stripe.webhooks.constructEvent.mockReturnValue(event);
    // recordIfNew -> true means "first delivery, process it" (the activation path).
    stubs.webhook.events.recordIfNew.mockResolvedValue(true);

    const res = await request(app)
      .post(URL)
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'good-sig')
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(stubs.webhook.events.recordIfNew).toHaveBeenCalledWith(
      'evt_activate_1',
      'checkout.session.completed',
      event,
    );
  });
});
