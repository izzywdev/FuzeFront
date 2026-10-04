import {
  FuzeEvent,
  IdentityUserCreatedPayloadV1,
  IdentityUserUpdatedPayloadV1,
  IdentityUserDeletedPayloadV1,
  IdentityOrgCreatedPayloadV1,
  IdentityOrgUpdatedPayloadV1,
  IdentityOrgDeletedPayloadV1,
  IdentityMembershipAddedPayloadV1,
  IdentityMembershipRemovedPayloadV1,
} from '@fuzefront/shared/kafka';
import {
  callProvision,
  callDeprovision,
  callUserSync,
  callUserDelete,
  callMembershipSync,
  callMembershipUnsync,
  HttpClient,
  nodeFetchClient,
} from './provision';

export interface HandlerDeps {
  securityServiceUrl: string;
  internalProvisionSecret: string;
  http?: HttpClient;
}

/**
 * Handles an identity.user.created event by calling security-service
 * POST /internal/provision. The TypedConsumer already validated the payload
 * against identityUserCreatedSchemaV1 before this handler is called.
 */
export async function handleUserCreated(
  event: FuzeEvent<IdentityUserCreatedPayloadV1>,
  deps: HandlerDeps
): Promise<void> {
  const { userId } = event.payload;
  const http = deps.http ?? nodeFetchClient;

  console.log(
    `[provisioning-service] Provisioning user ${userId} (correlationId=${event.correlationId})`
  );

  const result = await callProvision(
    userId,
    deps.securityServiceUrl,
    deps.internalProvisionSecret,
    http
  );

  console.log(
    `[provisioning-service] Provisioned user ${userId}: personalOrgId=${result.personalOrgId} reconciled=${result.reconciled}`
  );
}

/**
 * Handles an identity.org.created event by reconciling the new org's Permit
 * wiring (tenant + owner role). It reuses the idempotent user-scoped
 * POST /internal/provision — reconciling the OWNER reconciles every org that
 * owner owns, including the one just created — so no org-scoped endpoint is
 * needed. A root/platform org has no owner (`ownerId` is null); nothing to
 * provision, so we skip. The TypedConsumer already validated the payload
 * against identityOrgCreatedSchemaV1 before this handler is called.
 */
export async function handleOrgCreated(
  event: FuzeEvent<IdentityOrgCreatedPayloadV1>,
  deps: HandlerDeps
): Promise<void> {
  const { organizationId, ownerId } = event.payload;

  if (!ownerId) {
    console.log(
      `[provisioning-service] org ${organizationId} has no owner — skipping reconcile (correlationId=${event.correlationId})`
    );
    return;
  }

  const http = deps.http ?? nodeFetchClient;

  console.log(
    `[provisioning-service] Reconciling org ${organizationId} via owner ${ownerId} (correlationId=${event.correlationId})`
  );

  const result = await callProvision(
    ownerId,
    deps.securityServiceUrl,
    deps.internalProvisionSecret,
    http
  );

  console.log(
    `[provisioning-service] Reconciled org ${organizationId} (owner ${ownerId}): reconciled=${result.reconciled}`
  );
}

/**
 * Handles an identity.org.updated event by re-reconciling the org's Permit
 * wiring — the same idempotent /internal/provision (by owner) re-syncs the
 * org's current state. Skips ownerless (root/platform) orgs.
 */
export async function handleOrgUpdated(
  event: FuzeEvent<IdentityOrgUpdatedPayloadV1>,
  deps: HandlerDeps
): Promise<void> {
  const { organizationId, ownerId } = event.payload;

  if (!ownerId) {
    console.log(
      `[provisioning-service] org ${organizationId} has no owner — skipping re-sync (correlationId=${event.correlationId})`
    );
    return;
  }

  const http = deps.http ?? nodeFetchClient;

  console.log(
    `[provisioning-service] Re-syncing org ${organizationId} via owner ${ownerId} (correlationId=${event.correlationId})`
  );

  await callProvision(
    ownerId,
    deps.securityServiceUrl,
    deps.internalProvisionSecret,
    http
  );
}

/**
 * Handles an identity.org.deleted event by tearing down the org's Permit access
 * via security /internal/deprovision. `cascade` ('soft'|'hard') is forwarded so
 * a soft delete revokes access (reversible) and a hard delete removes the
 * tenant. The TypedConsumer already validated the payload against
 * identityOrgDeletedSchemaV1.
 */
export async function handleOrgDeleted(
  event: FuzeEvent<IdentityOrgDeletedPayloadV1>,
  deps: HandlerDeps
): Promise<void> {
  const { organizationId, cascade } = event.payload;
  const http = deps.http ?? nodeFetchClient;

  console.log(
    `[provisioning-service] Deprovisioning org ${organizationId} (cascade=${cascade}, correlationId=${event.correlationId})`
  );

  const result = await callDeprovision(
    organizationId,
    cascade,
    deps.securityServiceUrl,
    deps.internalProvisionSecret,
    http
  );

  console.log(
    `[provisioning-service] Deprovisioned org ${organizationId}: rolesRevoked=${result.rolesRevoked} tenantDeleted=${result.tenantDeleted}`
  );
}

/**
 * Handles an identity.user.updated event by re-syncing the user's profile into
 * Permit via security /internal/user-sync. The TypedConsumer already validated
 * the payload against identityUserUpdatedSchemaV1.
 */
export async function handleUserUpdated(
  event: FuzeEvent<IdentityUserUpdatedPayloadV1>,
  deps: HandlerDeps
): Promise<void> {
  const { userId, email, firstName, lastName } = event.payload;
  const http = deps.http ?? nodeFetchClient;

  console.log(
    `[provisioning-service] Re-syncing user ${userId} profile (correlationId=${event.correlationId})`
  );

  const result = await callUserSync(
    { userId, email, firstName, lastName },
    deps.securityServiceUrl,
    deps.internalProvisionSecret,
    http
  );

  console.log(
    `[provisioning-service] Re-synced user ${userId}: permitSynced=${result.permitSynced}`
  );
}

/**
 * Handles an identity.user.deleted event by tearing down the user's external
 * state (Permit principal + sessions) via security /internal/user-delete.
 * `cascade` ('soft'|'hard') is forwarded. The TypedConsumer already validated
 * the payload against identityUserDeletedSchemaV1.
 */
export async function handleUserDeleted(
  event: FuzeEvent<IdentityUserDeletedPayloadV1>,
  deps: HandlerDeps
): Promise<void> {
  const { userId, cascade } = event.payload;
  const http = deps.http ?? nodeFetchClient;

  console.log(
    `[provisioning-service] Deprovisioning user ${userId} (cascade=${cascade}, correlationId=${event.correlationId})`
  );

  const result = await callUserDelete(
    userId,
    cascade,
    deps.securityServiceUrl,
    deps.internalProvisionSecret,
    http
  );

  console.log(
    `[provisioning-service] Deprovisioned user ${userId}: permitDeleted=${result.permitDeleted} sessionsRevoked=${result.sessionsRevoked}`
  );
}

/**
 * Handles an identity.membership.added event by assigning the member's Permit
 * role via security /internal/membership-sync. Idempotent downstream (Permit
 * role assignment is replay-safe), so — like the other handlers — it carries no
 * per-delivery state. A non-retryable/exhausted failure throws so the consumer's
 * withDlq wrapper dead-letters the event instead of silently succeeding. The
 * TypedConsumer already validated the payload against
 * identityMembershipAddedSchemaV1.
 */
export async function handleMembershipAdded(
  event: FuzeEvent<IdentityMembershipAddedPayloadV1>,
  deps: HandlerDeps
): Promise<void> {
  const { organizationId, userId, role } = event.payload;
  const http = deps.http ?? nodeFetchClient;

  console.log(
    `[provisioning-service] Syncing membership user=${userId} org=${organizationId} role=${role} (correlationId=${event.correlationId})`
  );

  await callMembershipSync(
    { organizationId, userId, role },
    deps.securityServiceUrl,
    deps.internalProvisionSecret,
    http
  );
}

/**
 * Handles an identity.membership.removed event by revoking the member's Permit
 * role via security /internal/membership-unsync. Same idempotency / failure
 * contract as handleMembershipAdded.
 */
export async function handleMembershipRemoved(
  event: FuzeEvent<IdentityMembershipRemovedPayloadV1>,
  deps: HandlerDeps
): Promise<void> {
  const { organizationId, userId, role } = event.payload;
  const http = deps.http ?? nodeFetchClient;

  console.log(
    `[provisioning-service] Unsyncing membership user=${userId} org=${organizationId} role=${role} (correlationId=${event.correlationId})`
  );

  await callMembershipUnsync(
    { organizationId, userId, role },
    deps.securityServiceUrl,
    deps.internalProvisionSecret,
    http
  );
}
