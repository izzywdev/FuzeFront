import { FuzeEvent, IdentityUserCreatedPayloadV1 } from '@fuzefront/shared/kafka';
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
