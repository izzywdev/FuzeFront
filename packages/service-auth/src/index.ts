/**
 * @fuzefront/service-auth — public barrel.
 *
 * Runtime S2S auth for the FuzeFront family, bound to the frozen
 * `/api/v1/security/tokens` + `/api/v1/security/tokens/introspect` contract
 * (`@fuzefront/security-client`). Two halves:
 *
 *  - `createServiceAuthClient` — the CALLER: obtain + cache + auto-refresh a
 *    machine bearer token.
 *  - `createMachineTokenVerifier` + `requireMachineAuth` — the RESOURCE
 *    SERVER: verify a presented machine token (fail-closed, branches on the
 *    introspection body's `active`, never on HTTP status) and gate an
 *    Express route with it.
 */

export {
  SERVICE_AUTH_CONTRACT_VERSION,
  ServiceAuthError,
} from './types';
export type {
  FetchLike,
  MachineIdentity,
  ServiceAuthErrorCode,
  TokenIntrospectRequest,
  TokenIntrospection,
  TokenIssueRequest,
  TokenIssueResponse,
} from './types';

export { createServiceAuthClient } from './client';
export type { ServiceAuthClient, ServiceAuthClientOptions } from './client';

export { createMachineTokenVerifier } from './verifier';
export type { MachineTokenVerifier, MachineTokenVerifierOptions } from './verifier';

export { requireMachineAuth } from './middleware';
export type {
  MachineAuthErrorBody,
  MachineAuthorizeHook,
  RequireMachineAuthOptions,
} from './middleware';
