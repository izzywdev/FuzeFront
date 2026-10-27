// Workload identity is limited to two things, each enforced by the Security API
// (backend/security/src/routes/authz.ts), not by this file:
//   selection-list:owner-grant    bootstrap the verified creator as list-owner
//   selection-list:grant-cleanup  REVOKE list-instance grants of a principal the
//                                 Security API's SQL proves is gone (deleted /
//                                 deactivated user, departed member) — never a
//                                 live member's, never a grant
// Human access mutations (role change, revoke, compensation, purge cleanup) keep
// the caller's credential and exact instance policy; they never use this token.
import { createWorkloadAuthClient, WorkloadAuthClient } from '@fuzefront/service-auth';
import { existsSync } from 'fs';
import { createLoggedFetch, logger } from './logger';
export const OWNER_GRANT_SCOPE = 'selection-list:owner-grant';
export const GRANT_CLEANUP_SCOPE = 'selection-list:grant-cleanup';
export interface GrantTokenProvider { getToken(): Promise<string>; }
let injected: GrantTokenProvider | null = null;
let cached: WorkloadAuthClient | null = null;
let factory = createWorkloadAuthClient;
export function _setGrantTokenProviderForTesting(p: GrantTokenProvider | null): void { injected = p; cached = null; }
export function _setServiceAuthFactoryForTesting(f: typeof createWorkloadAuthClient | null): void { factory = f ?? createWorkloadAuthClient; cached = null; }
export function machineIdentityConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return existsSync(env.SELECTION_LIST_SERVICE_TOKEN_FILE ?? '/var/run/secrets/tokens/fuzefront-security');
}
export async function getGrantToken(): Promise<string> {
  if (injected) return injected.getToken();
  if (process.env.NODE_ENV === 'test' && !process.env.SECURITY_SERVICE_URL) return 'noop-machine-token';
  if (!cached) cached = factory({
    baseUrl: process.env.SECURITY_SERVICE_URL ?? 'http://fuzefront-security:3002',
    serviceAccountTokenFile: process.env.SELECTION_LIST_SERVICE_TOKEN_FILE,
    fetch: createLoggedFetch() as never,
  });
  return cached.getToken();
}
export function logMachineIdentityStatus(): void {
  if (machineIdentityConfigured()) logger.info({ scopes: [OWNER_GRANT_SCOPE, GRANT_CLEANUP_SCOPE] }, 'projected workload identity configured for owner bootstrap and stale-grant cleanup');
  else logger.error('projected workload token missing — owner bootstrap and stale-grant cleanup will fail closed');
}
