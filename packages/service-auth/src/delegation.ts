import { FetchLike, ServiceAuthError } from './types';
import type { ServiceAuthClient } from './client';

export interface DelegationExchangeOptions {
  baseUrl: string;
  serviceAuth: ServiceAuthClient;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface DelegationRequest {
  subjectToken: string;
  audience: `service:${string}`;
  scopes: string[];
}

export interface DelegationToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope: string;
  subject: string;
  audience: string;
  actor: { sub: string; previous?: unknown };
}

export interface DelegationClient {
  exchange(request: DelegationRequest): Promise<DelegationToken>;
}

export function createDelegationClient(options: DelegationExchangeOptions): DelegationClient {
  if (!options.baseUrl || !options.serviceAuth) {
    throw new ServiceAuthError('MISCONFIGURED', 'Delegation client requires baseUrl and serviceAuth.', 500);
  }
  const fetcher = options.fetch ?? (globalThis.fetch?.bind(globalThis) as unknown as FetchLike);
  if (!fetcher) throw new ServiceAuthError('MISCONFIGURED', 'No fetch implementation available.', 500);
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/api/v1/security/tokens/exchange`;

  return {
    async exchange(request) {
      if (!request.subjectToken || !request.audience || request.scopes.length === 0) {
        throw new ServiceAuthError('MISCONFIGURED', 'subjectToken, audience and scopes are required.', 400);
      }
      const actorToken = await options.serviceAuth.getToken();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
      try {
        const response = await fetcher(endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${actorToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            subjectToken: request.subjectToken,
            audience: request.audience,
            scope: [...new Set(request.scopes)].join(' '),
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new ServiceAuthError(
            response.status === 403 ? 'FORBIDDEN' : 'TOKEN_REQUEST_FAILED',
            `Delegation exchange returned ${response.status}.`,
            response.status,
          );
        }
        const body = (await response.json()) as Partial<DelegationToken>;
        if (!body.accessToken || !body.actor?.sub || !body.audience) {
          throw new ServiceAuthError('MALFORMED_RESPONSE', 'Delegation response is incomplete.', 502);
        }
        return body as DelegationToken;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
