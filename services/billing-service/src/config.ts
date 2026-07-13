/** Server-side bounds/allowlists for one-time payment-mode checkout. */
export interface PaymentsConfig {
  /**
   * Consumer products allowed to check out via POST /payments/checkout
   * (BILLING_PRODUCT_KEYS, comma-separated, e.g. 'mendys-datasets'). Empty by
   * default — the payment path is FAIL-CLOSED until keys are explicitly
   * allowlisted, which doubles as the release/kill switch for this slice.
   */
  productKeys: string[];
  /** Accepted ISO 4217 codes, lowercased (BILLING_PAYMENT_CURRENCIES). */
  currencies: string[];
  /**
   * Upper bound (in cents) for EACH line total AND the order total
   * (BILLING_PAYMENT_MAX_TOTAL_CENTS). Money-path MEDIUM-1-style bound.
   */
  maxTotalCents: number;
}

export const DEFAULT_PAYMENT_CURRENCIES = ['usd', 'eur'];
export const DEFAULT_PAYMENT_MAX_TOTAL_CENTS = 5_000_000;

export interface Config {
  port: number;
  kafka: {
    brokers: string[];
    clientId: string;
    groupId: string;
  };
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  internalToken?: string;
  databaseUrl?: string;
  payments: PaymentsConfig;
}

function parseList(raw: string | undefined, fallback: string[]): string[] {
  if (raw === undefined) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function loadConfig(): Config {
  const brokers = (process.env.KAFKA_BROKERS || 'fuzeinfra-kafka:9092')
    .split(',')
    .map((b) => b.trim());

  const maxTotalCents = parseInt(
    process.env.BILLING_PAYMENT_MAX_TOTAL_CENTS || String(DEFAULT_PAYMENT_MAX_TOTAL_CENTS),
    10,
  );

  return {
    port: parseInt(process.env.PORT || '3006', 10),
    kafka: {
      brokers,
      clientId: process.env.KAFKA_CLIENT_ID || 'billing-service',
      groupId: process.env.KAFKA_GROUP_ID || 'billing-service-group',
    },
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    internalToken: process.env.BILLING_INTERNAL_TOKEN,
    databaseUrl: process.env.DATABASE_URL,
    payments: {
      // No default product keys: an unset BILLING_PRODUCT_KEYS keeps the
      // one-time payment path disabled (fail closed) — merge dark.
      productKeys: parseList(process.env.BILLING_PRODUCT_KEYS, []),
      currencies: parseList(
        process.env.BILLING_PAYMENT_CURRENCIES,
        DEFAULT_PAYMENT_CURRENCIES,
      ),
      maxTotalCents:
        Number.isFinite(maxTotalCents) && maxTotalCents > 0
          ? maxTotalCents
          : DEFAULT_PAYMENT_MAX_TOTAL_CENTS,
    },
  };
}
