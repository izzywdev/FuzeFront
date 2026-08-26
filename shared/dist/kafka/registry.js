"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCHEMA_BY_TOPIC = void 0;
exports.schemaForTopic = schemaForTopic;
exports.partitionKeyForPayload = partitionKeyForPayload;
const types_1 = require("./types");
const schemas_1 = require("./schemas");
/**
 * Single source of truth mapping each topic to the frozen Zod schema for its
 * payload. Producers and the outbox relay look schemas up here to validate
 * before publishing; a topic with no entry is published without validation.
 *
 * Any language binding (e.g. the Python `fuzefront-events` package) mirrors this
 * registry so validation and topic coverage stay identical across the family.
 */
exports.SCHEMA_BY_TOPIC = {
    [types_1.TOPICS.APP_REGISTERED]: schemas_1.appRegisteredSchemaV1,
    [types_1.TOPICS.APP_ACTIVATED]: schemas_1.appActivatedSchemaV1,
    [types_1.TOPICS.APP_SUSPENDED]: schemas_1.appSuspendedSchemaV1,
    [types_1.TOPICS.APP_HEARTBEAT]: schemas_1.appHeartbeatSchemaV1,
    [types_1.TOPICS.BILLING_LLM_USAGE]: schemas_1.billingLlmUsageSchemaV1,
    [types_1.TOPICS.BILLING_USAGE_RECORDED]: schemas_1.billingUsageRecordedSchemaV1,
    [types_1.TOPICS.BILLING_SUBSCRIPTION_CHANGED]: schemas_1.billingSubscriptionChangedSchemaV1,
    [types_1.TOPICS.BILLING_PAYMENT_COMPLETED]: schemas_1.billingPaymentCompletedSchemaV1,
    [types_1.TOPICS.IDENTITY_USER_CREATED]: schemas_1.identityUserCreatedSchemaV1,
    [types_1.TOPICS.IDENTITY_USER_UPDATED]: schemas_1.identityUserUpdatedSchemaV1,
    [types_1.TOPICS.IDENTITY_USER_DELETED]: schemas_1.identityUserDeletedSchemaV1,
    [types_1.TOPICS.IDENTITY_ORG_CREATED]: schemas_1.identityOrgCreatedSchemaV1,
    [types_1.TOPICS.IDENTITY_ORG_UPDATED]: schemas_1.identityOrgUpdatedSchemaV1,
    [types_1.TOPICS.IDENTITY_ORG_DELETED]: schemas_1.identityOrgDeletedSchemaV1,
    [types_1.TOPICS.IDENTITY_MEMBERSHIP_ADDED]: schemas_1.identityMembershipAddedSchemaV1,
    [types_1.TOPICS.IDENTITY_MEMBERSHIP_REMOVED]: schemas_1.identityMembershipRemovedSchemaV1,
    [types_1.TOPICS.NOTIFY_EMAIL_REQUESTED]: schemas_1.notifyEmailRequestedSchemaV1,
    [types_1.TOPICS.NOTIFY_EMAIL_STATUS]: schemas_1.notifyEmailStatusSchemaV1,
    [types_1.TOPICS.PORTAL_CREATED]: schemas_1.portalCreatedSchemaV1,
};
/** Returns the payload schema for a topic, or undefined if none is registered. */
function schemaForTopic(topic) {
    return exports.SCHEMA_BY_TOPIC[topic];
}
/**
 * Derives the Kafka partition key from an event payload so all events for one
 * entity stay ordered on a single partition. Falls through the common id fields;
 * returns undefined when none is present (round-robin). Defined here — in the
 * contract — so every language binding derives the key identically.
 */
function partitionKeyForPayload(payload) {
    var _a, _b, _c, _d, _e;
    return ((_e = (_d = (_c = (_b = (_a = payload === null || payload === void 0 ? void 0 : payload.organizationId) !== null && _a !== void 0 ? _a : payload === null || payload === void 0 ? void 0 : payload.userId) !== null && _b !== void 0 ? _b : payload === null || payload === void 0 ? void 0 : payload.portalId) !== null && _c !== void 0 ? _c : payload === null || payload === void 0 ? void 0 : payload.entityId) !== null && _d !== void 0 ? _d : payload === null || payload === void 0 ? void 0 : payload.appId) !== null && _e !== void 0 ? _e : undefined);
}
