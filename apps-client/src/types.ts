import type { components } from './schema';

/**
 * Convenience aliases over the generated OpenAPI component schemas. The OpenAPI
 * document (`services/app-registry-service/openapi.yaml`) is the source of truth;
 * these names just make the generated types ergonomic for consumers.
 */
export type App = components['schemas']['App'];
export type AppManifest = components['schemas']['AppManifest'];
export type AppMode = components['schemas']['AppMode'];
export type AppStatus = components['schemas']['AppStatus'];
export type IntegrationType = components['schemas']['IntegrationType'];
export type Integration = components['schemas']['Integration'];
export type Chrome = components['schemas']['Chrome'];
export type MenuItem = components['schemas']['MenuItem'];
export type Routing = components['schemas']['Routing'];
export type Infra = components['schemas']['Infra'];
export type Icon = components['schemas']['Icon'];
export type Visibility = components['schemas']['Visibility'];
export type RegisterAppRequest = components['schemas']['RegisterAppRequest'];
export type HeartbeatRequest = components['schemas']['HeartbeatRequest'];
export type ErrorBody = components['schemas']['Error'];

export interface AppRegistryClientConfig {
  /** Base URL of the app-registry service, e.g. `/api/v1/app-registry` (same-origin). */
  baseUrl: string;
  /** Optional bearer token (Authentik session) for authenticated calls. */
  token?: string;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
}

export interface ListAppsParams {
  status?: AppStatus;
  mode?: AppMode;
  limit?: number;
  cursor?: string;
}

export interface ListAppsResult {
  apps: App[];
  nextCursor: string | null;
}
