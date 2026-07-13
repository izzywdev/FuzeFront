export const TOPICS = {
  APP_REGISTERED: 'app.registered',
  APP_ACTIVATED: 'app.activated',
  APP_SUSPENDED: 'app.suspended',
  APP_HEARTBEAT: 'app.heartbeat',
  BILLING_LLM_USAGE: 'billing.llm.usage',
  IDENTITY_USER_CREATED: 'identity.user.created',
  NOTIFY_EMAIL_REQUESTED: 'notify.email.requested',
  NOTIFY_EMAIL_STATUS: 'notify.email.status',
  BILLING_USAGE_RECORDED: 'billing.usage.recorded',
  BILLING_SUBSCRIPTION_CHANGED: 'billing.subscription.changed',
  BILLING_PAYMENT_COMPLETED: 'billing.payment.completed',
  BILLING_TRIAL_ENDING: 'billing.trial.ending',
  BILLING_PAYMENT_FAILED: 'billing.payment.failed',
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

/** Envelope wrapping every event published on FuzeFront Kafka topics */
export interface FuzeEvent<T = unknown> {
  /** Semver-style schema version, e.g. "1.0" */
  version: string;
  topic: TopicName;
  /** Caller-supplied idempotency / tracing token */
  correlationId: string;
  occurredAt: string; // ISO-8601
  payload: T;
}

/** Returns the dead-letter queue topic name for a given topic */
export function dlqTopic(topic: string): string {
  return `${topic}.dlq`;
}
