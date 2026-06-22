export const TOPICS = {
    IDENTITY_USER_CREATED: 'identity.user.created',
    NOTIFY_EMAIL_REQUESTED: 'notify.email.requested',
    NOTIFY_EMAIL_STATUS: 'notify.email.status',
    BILLING_USAGE_RECORDED: 'billing.usage.recorded',
    BILLING_SUBSCRIPTION_CHANGED: 'billing.subscription.changed',
    BILLING_TRIAL_ENDING: 'billing.trial.ending',
    BILLING_PAYMENT_FAILED: 'billing.payment.failed',
};
/** Returns the dead-letter queue topic name for a given topic */
export function dlqTopic(topic) {
    return `${topic}.dlq`;
}
