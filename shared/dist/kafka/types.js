export const TOPICS = {
    BILLING_LLM_USAGE: 'billing.llm.usage',
    IDENTITY_USER_CREATED: 'identity.user.created',
    NOTIFY_EMAIL_REQUESTED: 'notify.email.requested',
    NOTIFY_EMAIL_STATUS: 'notify.email.status',
};
/** Returns the dead-letter queue topic name for a given topic */
export function dlqTopic(topic) {
    return `${topic}.dlq`;
}
