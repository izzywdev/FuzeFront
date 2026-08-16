import {
  FuzeEvent,
  IdentityUserCreatedPayloadV1,
  IdentityOrgCreatedPayloadV1,
} from '@fuzefront/shared/kafka';
import { callProvision, HttpClient, nodeFetchClient } from './provision';

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
