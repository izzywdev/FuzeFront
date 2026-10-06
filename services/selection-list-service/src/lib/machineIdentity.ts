// Workload identity is limited to bootstrapping the verified creator as owner.
// Human access mutations keep the caller's credential and exact instance policy.
import { createWorkloadAuthClient, WorkloadAuthClient } from '@fuzefront/service-auth';
import { existsSync } from 'fs';
import { createLoggedFetch, logger } from './logger';
export const OWNER_GRANT_SCOPE = 'selection-list:owner-grant';
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
  if (machineIdentityConfigured()) logger.info({ scope: OWNER_GRANT_SCOPE }, 'projected workload identity configured for owner bootstrap');
  else logger.error('projected workload token missing — owner bootstrap will fail closed');
}
