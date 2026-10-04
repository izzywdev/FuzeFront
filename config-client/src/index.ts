/**
 * `@fuzefront/config-client` — typed client for the FuzeFront config-service.
 *
 * Derived by hand from `services/config-service/openapi.yaml` v1.0.0. That spec
 * is the frozen contract; this package is a projection of it. If the two ever
 * disagree, the spec wins and this package is the bug.
 */

export { ConfigClient, isNotModified } from './client'
export type {
  ConditionalEffectiveConfig,
  ConfigClientOptions,
  NotModified,
  TokenProvider,
} from './client'

export { ConfigApiError, isConfigApiError } from './errors'
export type { ConfigApiErrorCode } from './errors'

export {
  KEY_DEFINITION_ID_PREFIX,
  NAMESPACE_ID_PREFIX,
  SCOPE_CHAIN,
} from './types'

export type {
  Actor,
  ConfigHistoryAction,
  ConfigHistoryEntry,
  ConfigHistoryEntryId,
  ListConfigHistoryParams,
  RevealSecretRequest,
  RevealSecretResult,
  ConfigErrorBody,
  ConfigErrorCode,
  ConfigErrorDetail,
  ConfigOperation,
  ConfigOperationType,
  ConfigWriteRequest,
  ConfigWriteResult,
  EffectiveConfig,
  EffectiveConfigEntry,
  KeyDefinition,
  KeyDefinitionId,
  KeyDefinitionInput,
  KeyDefinitionManifest,
  KeyDefinitionManifestResult,
  KeyName,
  ListKeyDefinitionsParams,
  Namespace,
  NamespaceCreate,
  NamespaceId,
  NamespaceName,
  Paged,
  PageInfo,
  PageParams,
  Precedence,
  Scope,
  ScopeType,
  ValueType,
} from './types'

export {
  CONFIG_CHANGED_TOPIC,
  ConfigCache,
  parseConfigChangedEvent,
} from './changed'
export type {
  ConfigCacheOptions,
  ConfigChangedEvent,
  ConfigChangedPayload,
} from './changed'
