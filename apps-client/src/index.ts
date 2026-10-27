export { AppRegistryClient } from './client';

// Generated OpenAPI surface (source of truth = services/app-registry-service/openapi.yaml).
export type { paths, components, operations } from './schema';

// Ergonomic aliases + client config/result types.
export type {
  App,
  AppManifest,
  AppMode,
  AppStatus,
  IntegrationType,
  Integration,
  Chrome,
  MenuItem,
  Nav,
  NavSection,
  ProductPolicy,
  ProductResourceDecl,
  ProductRoleDecl,
  BillingProfile,
  Routing,
  Infra,
  Distribution,
  Icon,
  Visibility,
  RegisterAppRequest,
  HeartbeatRequest,
  ErrorBody,
  AppCreator,
  AppPublication,
  PublicationQueueItem,
  AppRegistryClientConfig,
  ListAppsParams,
  ListAppsResult,
  ListPublicationRequestsParams,
  ListPublicationRequestsResult,
} from './types';
