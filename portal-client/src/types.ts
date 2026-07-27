import type { components } from './schema';

/**
 * Convenience aliases over the generated OpenAPI component schemas. The OpenAPI
 * document (`services/portal-service/openapi.yaml`) is the source of truth;
 * these names just make the generated types ergonomic for consumers.
 */
export type Portal = components['schemas']['Portal'];
export type PortalContext = components['schemas']['PortalContext'];
export type PortalBranding = components['schemas']['PortalBranding'];
export type PortalIdentityPolicy = components['schemas']['PortalIdentityPolicy'];
export type PortalAuthEntry = components['schemas']['PortalAuthEntry'];
export type PortalSsoProvider = components['schemas']['PortalSsoProvider'];
export type PortalDomain = components['schemas']['PortalDomain'];
export type PortalStatus = components['schemas']['PortalStatus'];
export type BillingMode = components['schemas']['BillingMode'];
export type DomainKind = components['schemas']['DomainKind'];
export type VerificationStatus = components['schemas']['VerificationStatus'];
export type TlsStatus = components['schemas']['TlsStatus'];
export type PortalCreate = components['schemas']['PortalCreate'];
export type PortalUpdate = components['schemas']['PortalUpdate'];
export type PortalPage = components['schemas']['PortalPage'];
export type Page = components['schemas']['Page'];
export type ErrorBody = components['schemas']['ErrorBody'];
export type ValidationErrorBody = components['schemas']['ValidationErrorBody'];

export interface PortalClientConfig {
  /** Base URL of the platform API, e.g. `/` or `/api` (same-origin). */
  baseUrl: string;
  /** Optional bearer token (Authentik session) for authenticated calls. */
  token?: string;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
}

export interface ListPortalsParams {
  status?: PortalStatus;
  q?: string;
  limit?: number;
  cursor?: string;
}
