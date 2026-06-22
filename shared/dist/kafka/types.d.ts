export declare const TOPICS: {
    readonly BILLING_LLM_USAGE: "billing.llm.usage";
    readonly IDENTITY_USER_CREATED: "identity.user.created";
    readonly NOTIFY_EMAIL_REQUESTED: "notify.email.requested";
    readonly NOTIFY_EMAIL_STATUS: "notify.email.status";
};
export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];
/** Envelope wrapping every event published on FuzeFront Kafka topics */
export interface FuzeEvent<T = unknown> {
    /** Semver-style schema version, e.g. "1.0" */
    version: string;
    topic: TopicName;
    /** Caller-supplied idempotency / tracing token */
    correlationId: string;
    occurredAt: string;
    payload: T;
}
/** Returns the dead-letter queue topic name for a given topic */
export declare function dlqTopic(topic: string): string;
