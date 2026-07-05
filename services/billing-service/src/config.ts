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
}

export function loadConfig(): Config {
  const brokers = (process.env.KAFKA_BROKERS || 'fuzeinfra-kafka:9092')
    .split(',')
    .map((b) => b.trim());

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
  };
}
