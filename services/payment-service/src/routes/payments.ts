import { Router, Request, Response } from 'express';
import { PaymentProvider } from '../providers/payment-provider';
import { isNotImplemented } from '../errors';

/**
 * The neutral Payment Provider API surface (see `openapi.yaml`). Mounted under
 * `/api/v1/payments`. Every route delegates to the injected `PaymentProvider`
 * port — no vendor concepts leak here.
 *
 * SCAFFOLD: the Stripe adapter throws `NotImplemented` for every call, which
 * this router maps to HTTP 501. The contract is fully navigable (paths, shapes,
 * auth) while the live money path is still dark and being absorbed from
 * billing-service method by method.
 */
export interface PaymentsRouterDeps {
  provider: PaymentProvider;
}

/** Map adapter errors to HTTP. NotImplemented → 501; everything else → 502. */
function handleError(res: Response, err: unknown): void {
  if (isNotImplemented(err)) {
    res.status(501).json({ error: 'not_implemented', message: (err as Error).message });
    return;
  }
  res.status(502).json({ error: 'provider_error', message: (err as Error)?.message });
}

export function createPaymentsRouter(deps: PaymentsRouterDeps): Router {
  const router = Router();
  const { provider } = deps;

  // --- customers ---
  router.post('/customers', async (req: Request, res: Response) => {
    try {
      const customer = await provider.createCustomer(req.body || {});
      res.status(201).json({ customer });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/customers/:customerId', async (req: Request, res: Response) => {
    try {
      const customer = await provider.getCustomer(req.params.customerId);
      if (!customer) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      res.json({ customer });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/customers/:customerId/invoices', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
      const startingAfter = req.query.cursor ? String(req.query.cursor) : undefined;
      const page = await provider.listInvoices(req.params.customerId, { limit, startingAfter });
      res.json(page);
    } catch (err) {
      handleError(res, err);
    }
  });

  // --- checkout sessions ---
  router.post('/checkout-sessions', async (req: Request, res: Response) => {
    try {
      const session = await provider.createCheckoutSession(req.body || {});
      res.status(201).json({ session });
    } catch (err) {
      handleError(res, err);
    }
  });

  // --- payment-method setup ---
  router.post('/payment-methods/setup', async (req: Request, res: Response) => {
    try {
      const setup = await provider.setupPaymentMethod(req.body || {});
      res.status(201).json({ setup });
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}

/**
 * Webhook receiver, mounted separately with a raw-body parser (signature
 * verification needs the unparsed bytes). Public — authenticity is the provider
 * signature, not the internal token.
 */
export function createWebhookRouter(deps: PaymentsRouterDeps): Router {
  const router = Router();
  const { provider } = deps;

  router.post('/webhooks/:provider', async (req: Request, res: Response) => {
    try {
      const signature = req.header('stripe-signature') || undefined;
      const event = provider.parseWebhook(req.params.provider, req.body as Buffer, signature);
      res.json({ received: true, handled: Boolean(event) });
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}
