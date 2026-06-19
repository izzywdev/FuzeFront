export const TOPICS = {
  IDENTITY_USER_CREATED: 'identity.user.created',
  NOTIFY_EMAIL_REQUESTED: 'notify.email.requested',
  NOTIFY_EMAIL_STATUS: 'notify.email.status',
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
