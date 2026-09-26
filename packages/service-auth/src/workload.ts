import fs from 'fs';
import { FetchLike, ServiceAuthError } from './types';

const DEFAULT_TOKEN_FILE = '/var/run/secrets/tokens/fuzefront-security';

export interface WorkloadAuthClientOptions {
  baseUrl: string;
  serviceAccountTokenFile?: string;
  fetch?: FetchLike;
  refreshMarginSeconds?: number;
}

export interface WorkloadAuthClient {
  getToken(): Promise<string>;
  invalidate(): void;
}

export function createWorkloadAuthClient(options: WorkloadAuthClientOptions): WorkloadAuthClient {
  if (!options?.baseUrl) throw new ServiceAuthError('MISCONFIGURED', 'baseUrl is required', 500);
  const fetcher = options.fetch ?? globalThis.fetch?.bind(globalThis) as unknown as FetchLike;
  if (!fetcher) throw new ServiceAuthError('MISCONFIGURED', 'fetch is required', 500);
  const tokenFile = options.serviceAccountTokenFile ?? DEFAULT_TOKEN_FILE;
  const marginMs = (options.refreshMarginSeconds ?? 30) * 1000;
  let cached: { token: string; expiresAt: number } | undefined;
  let inflight: Promise<string> | undefined;

  async function bootstrap(): Promise<string> {
    let serviceAccountToken: string;
    try { serviceAccountToken = fs.readFileSync(tokenFile, 'utf8').trim(); }
    catch { throw new ServiceAuthError('MISCONFIGURED', `cannot read projected token at ${tokenFile}`, 500); }
    const response = await fetcher(`${options.baseUrl.replace(/\/+$/, '')}/api/v1/security/tokens/workload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serviceAccountToken }),
    });
    if (!response.ok) throw new ServiceAuthError('TOKEN_REQUEST_FAILED', `workload bootstrap returned ${response.status}`, 502);
    const body = await response.json() as { accessToken?: string; expiresIn?: number };
    if (!body.accessToken || !body.expiresIn) throw new ServiceAuthError('MALFORMED_RESPONSE', 'invalid workload token response', 502);
    cached = { token: body.accessToken, expiresAt: Date.now() + body.expiresIn * 1000 };
    return body.accessToken;
  }

  return {
    async getToken() {
      if (cached && Date.now() < cached.expiresAt - marginMs) return cached.token;
      if (!inflight) inflight = bootstrap().finally(() => { inflight = undefined; });
      return inflight;
    },
    invalidate() { cached = undefined; },
  };
}
