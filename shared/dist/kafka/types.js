"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOPICS = void 0;
exports.dlqTopic = dlqTopic;
exports.TOPICS = {
    IDENTITY_USER_CREATED: 'identity.user.created',
    NOTIFY_EMAIL_REQUESTED: 'notify.email.requested',
    NOTIFY_EMAIL_STATUS: 'notify.email.status',
};
/** Returns the dead-letter queue topic name for a given topic */
function dlqTopic(topic) {
    return `${topic}.dlq`;
}
