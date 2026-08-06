import { ZodTypeAny } from 'zod';
import { TOPICS } from './types';
import {
  appRegisteredSchemaV1,
  appActivatedSchemaV1,
  appSuspendedSchemaV1,
  appHeartbeatSchemaV1,
  billingLlmUsageSchemaV1,
  billingUsageRecordedSchemaV1,
  billingSubscriptionChangedSchemaV1,
  billingPaymentCompletedSchemaV1,
  identityUserCreatedSchemaV1,
  identityUserUpdatedSchemaV1,
  identityUserDeletedSchemaV1,
  identityOrgCreatedSchemaV1,
  identityOrgUpdatedSchemaV1,
  identityOrgDeletedSchemaV1,
  identityMembershipAddedSchemaV1,
  identityMembershipRemovedSchemaV1,
  notifyEmailRequestedSchemaV1,
  notifyEmailStatusSchemaV1,
  portalCreatedSchemaV1,
} from './schemas';

/**
 * Single source of truth mapping each topic to the frozen Zod schema for its
 * payload. Producers and the outbox relay look schemas up here to validate
 * before publishing; a topic with no entry is published without validation.
 *
 * Any language binding (e.g. the Python `fuzefront-events` package) mirrors this
 * registry so validation and topic coverage stay identical across the family.
 */
export const SCHEMA_BY_TOPIC: Readonly<Record<string, ZodTypeAny>> = {
  [TOPICS.APP_REGISTERED]: appRegisteredSchemaV1,
  [TOPICS.APP_ACTIVATED]: appActivatedSchemaV1,
  [TOPICS.APP_SUSPENDED]: appSuspendedSchemaV1,
  [TOPICS.APP_HEARTBEAT]: appHeartbeatSchemaV1,
  [TOPICS.BILLING_LLM_USAGE]: billingLlmUsageSchemaV1,
  [TOPICS.BILLING_USAGE_RECORDED]: billingUsageRecordedSchemaV1,
  [TOPICS.BILLING_SUBSCRIPTION_CHANGED]: billingSubscriptionChangedSchemaV1,
  [TOPICS.BILLING_PAYMENT_COMPLETED]: billingPaymentCompletedSchemaV1,
  [TOPICS.IDENTITY_USER_CREATED]: identityUserCreatedSchemaV1,
  [TOPICS.IDENTITY_USER_UPDATED]: identityUserUpdatedSchemaV1,
  [TOPICS.IDENTITY_USER_DELETED]: identityUserDeletedSchemaV1,
  [TOPICS.IDENTITY_ORG_CREATED]: identityOrgCreatedSchemaV1,
  [TOPICS.IDENTITY_ORG_UPDATED]: identityOrgUpdatedSchemaV1,
  [TOPICS.IDENTITY_ORG_DELETED]: identityOrgDeletedSchemaV1,
  [TOPICS.IDENTITY_MEMBERSHIP_ADDED]: identityMembershipAddedSchemaV1,
  [TOPICS.IDENTITY_MEMBERSHIP_REMOVED]: identityMembershipRemovedSchemaV1,
  [TOPICS.NOTIFY_EMAIL_REQUESTED]: notifyEmailRequestedSchemaV1,
  [TOPICS.NOTIFY_EMAIL_STATUS]: notifyEmailStatusSchemaV1,
  [TOPICS.PORTAL_CREATED]: portalCreatedSchemaV1,
};

/** Returns the payload schema for a topic, or undefined if none is registered. */
export function schemaForTopic(topic: string): ZodTypeAny | undefined {
  return SCHEMA_BY_TOPIC[topic];
}

/**
 * Derives the Kafka partition key from an event payload so all events for one
 * entity stay ordered on a single partition. Falls through the common id fields;
 * returns undefined when none is present (round-robin). Defined here — in the
 * contract — so every language binding derives the key identically.
 */
export function partitionKeyForPayload(payload: any): string | undefined {
  return (
    payload?.organizationId ??
    payload?.userId ??
    payload?.portalId ??
    payload?.entityId ??
    payload?.appId ??
    undefined
  );
}
