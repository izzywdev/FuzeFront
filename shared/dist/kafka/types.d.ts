export declare const TOPICS: {
    readonly APP_REGISTERED: "app.registered";
    readonly APP_ACTIVATED: "app.activated";
    readonly APP_SUSPENDED: "app.suspended";
    readonly APP_HEARTBEAT: "app.heartbeat";
    readonly BILLING_LLM_USAGE: "billing.llm.usage";
    readonly IDENTITY_USER_CREATED: "identity.user.created";
    readonly IDENTITY_USER_UPDATED: "identity.user.updated";
    readonly IDENTITY_USER_DELETED: "identity.user.deleted";
    readonly IDENTITY_ORG_CREATED: "identity.org.created";
    readonly IDENTITY_ORG_UPDATED: "identity.org.updated";
    readonly IDENTITY_ORG_DELETED: "identity.org.deleted";
    readonly IDENTITY_MEMBERSHIP_ADDED: "identity.membership.added";
    readonly IDENTITY_MEMBERSHIP_REMOVED: "identity.membership.removed";
    readonly IDENTITY_AUTHORIZATION_CHANGED: "identity.authorization.changed";
    readonly NOTIFY_EMAIL_REQUESTED: "notify.email.requested";
    readonly NOTIFY_EMAIL_STATUS: "notify.email.status";
    readonly BILLING_USAGE_RECORDED: "billing.usage.recorded";
    readonly BILLING_SUBSCRIPTION_CHANGED: "billing.subscription.changed";
    readonly BILLING_PAYMENT_COMPLETED: "billing.payment.completed";
    readonly BILLING_TRIAL_ENDING: "billing.trial.ending";
    readonly BILLING_PAYMENT_FAILED: "billing.payment.failed";
    readonly BILLING_TENANT_REGISTERED: "billing.tenant.registered";
    readonly BILLING_PAYMENT_METHOD_UPDATED: "billing.payment_method.updated";
    readonly PORTAL_CREATED: "portal.created";
    readonly CHAT_RESPONSE_CHUNK: "chat.response.chunk";
    readonly SELECTION_LISTS_LIST_CREATED: "selection-lists.list.created";
    readonly SELECTION_LISTS_LIST_UPDATED: "selection-lists.list.updated";
    readonly SELECTION_LISTS_LIST_ARCHIVED: "selection-lists.list.archived";
    readonly SELECTION_LISTS_LIST_DELETED: "selection-lists.list.deleted";
    readonly SELECTION_LISTS_ITEM_CREATED: "selection-lists.item.created";
    readonly SELECTION_LISTS_ITEM_UPDATED: "selection-lists.item.updated";
    readonly SELECTION_LISTS_ITEM_ARCHIVED: "selection-lists.item.archived";
    readonly SELECTION_LISTS_ITEM_DELETED: "selection-lists.item.deleted";
    readonly SELECTION_LISTS_ITEM_REORDERED: "selection-lists.item.reordered";
    readonly SELECTION_LISTS_TRANSLATION_UPSERTED: "selection-lists.translation.upserted";
    readonly SELECTION_LISTS_TRANSLATION_DELETED: "selection-lists.translation.deleted";
    readonly SELECTION_LISTS_ACCESS_GRANTED: "selection-lists.access.granted";
    readonly SELECTION_LISTS_ACCESS_REVOKED: "selection-lists.access.revoked";
    readonly SELECTION_LISTS_SEED_REQUESTED: "selection-lists.seed.requested";
    readonly SELECTION_LISTS_SEED_COMPLETED: "selection-lists.seed.completed";
    readonly SELECTION_LISTS_SEED_FAILED: "selection-lists.seed.failed";
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
