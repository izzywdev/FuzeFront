export const TOPICS = {
  APP_REGISTERED: 'app.registered',
  APP_ACTIVATED: 'app.activated',
  APP_SUSPENDED: 'app.suspended',
  APP_HEARTBEAT: 'app.heartbeat',
  BILLING_LLM_USAGE: 'billing.llm.usage',
  IDENTITY_USER_CREATED: 'identity.user.created',
  IDENTITY_USER_UPDATED: 'identity.user.updated',
  IDENTITY_USER_DELETED: 'identity.user.deleted',
  IDENTITY_ORG_CREATED: 'identity.org.created',
  IDENTITY_ORG_UPDATED: 'identity.org.updated',
  IDENTITY_ORG_DELETED: 'identity.org.deleted',
  IDENTITY_MEMBERSHIP_ADDED: 'identity.membership.added',
  IDENTITY_MEMBERSHIP_REMOVED: 'identity.membership.removed',
  NOTIFY_EMAIL_REQUESTED: 'notify.email.requested',
  NOTIFY_EMAIL_STATUS: 'notify.email.status',
  BILLING_USAGE_RECORDED: 'billing.usage.recorded',
  BILLING_SUBSCRIPTION_CHANGED: 'billing.subscription.changed',
  BILLING_PAYMENT_COMPLETED: 'billing.payment.completed',
  BILLING_TRIAL_ENDING: 'billing.trial.ending',
  BILLING_PAYMENT_FAILED: 'billing.payment.failed',
  BILLING_TENANT_REGISTERED: 'billing.tenant.registered',
  BILLING_PAYMENT_METHOD_UPDATED: 'billing.payment_method.updated',
  PORTAL_CREATED: 'portal.created',
  CHAT_RESPONSE_CHUNK: 'chat.response.chunk',
  // selection-list-service (docs/planning/selection-lists-events.md). Produced
  // ONLY by selection-list-service, except SEED_REQUESTED, which allowlisted
  // services produce and selection-list-service consumes.
  SELECTION_LISTS_LIST_CREATED: 'selection-lists.list.created',
  SELECTION_LISTS_LIST_UPDATED: 'selection-lists.list.updated',
  SELECTION_LISTS_LIST_ARCHIVED: 'selection-lists.list.archived',
  SELECTION_LISTS_LIST_DELETED: 'selection-lists.list.deleted',
  SELECTION_LISTS_ITEM_CREATED: 'selection-lists.item.created',
  SELECTION_LISTS_ITEM_UPDATED: 'selection-lists.item.updated',
  SELECTION_LISTS_ITEM_ARCHIVED: 'selection-lists.item.archived',
  SELECTION_LISTS_ITEM_DELETED: 'selection-lists.item.deleted',
  SELECTION_LISTS_ITEM_REORDERED: 'selection-lists.item.reordered',
  SELECTION_LISTS_TRANSLATION_UPSERTED: 'selection-lists.translation.upserted',
  SELECTION_LISTS_TRANSLATION_DELETED: 'selection-lists.translation.deleted',
  SELECTION_LISTS_ACCESS_GRANTED: 'selection-lists.access.granted',
  SELECTION_LISTS_ACCESS_REVOKED: 'selection-lists.access.revoked',
  SELECTION_LISTS_SEED_REQUESTED: 'selection-lists.seed.requested',
  SELECTION_LISTS_SEED_COMPLETED: 'selection-lists.seed.completed',
  SELECTION_LISTS_SEED_FAILED: 'selection-lists.seed.failed',
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
