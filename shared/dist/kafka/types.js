"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOPICS = void 0;
exports.dlqTopic = dlqTopic;
exports.TOPICS = {
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
};
/** Returns the dead-letter queue topic name for a given topic */
function dlqTopic(topic) {
    return `${topic}.dlq`;
}
