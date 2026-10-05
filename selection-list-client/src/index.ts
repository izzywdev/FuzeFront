/**
 * `@fuzeone/selection-list-client` — typed client for the FuzeFront
 * selection-list-service.
 *
 * Derived by hand from `services/selection-list-service/openapi.yaml` v4.0.0.
 * That spec is the frozen contract; this package is a projection of it. If the
 * two ever disagree, the spec wins and this package is the bug.
 */

export { SelectionListClient } from './client'
export type {
  SelectionListClientOptions,
  TokenProvider,
} from './client'

export {
  SelectionListApiError,
  isSelectionListApiError,
} from './errors'
export type { SelectionListApiErrorCode } from './errors'

export {
  SEED_COMPLETED_TOPIC,
  SEED_FAILED_TOPIC,
  SEED_LIMITS,
  SEED_REQUESTED_SCHEMA_VERSION,
  SEED_REQUESTED_TOPIC,
  SeedRequestValidationError,
  buildSeedRequest,
  buildSeedRequestEnvelope,
  seedRequestKafkaKey,
} from './seed'
export type {
  BuildSeedRequestInput,
  SeedItemSpec,
  SeedItemTranslation,
  SeedListSpec,
  SeedListTranslation,
  SeedRequestIssue,
  SeedRequestedEnvelopeV1,
  SeedRequestedPayloadV1,
  SeedScope,
  SeedTrigger,
} from './seed'

export {
  DELETED_USER_SENTINEL,
  LOCALES,
  SELECTION_LIST_ID_PREFIX,
  SELECTION_LIST_ITEM_ID_PREFIX,
  SYSTEM_PRINCIPAL_PREFIX,
  USER_ID_PREFIX,
  authorPrincipalKind,
  isUserAuthor,
} from './types'

export type {
  AuthorPrincipal,
  AuthorPrincipalKind,
  DeletedUserSentinel,
  ItemTranslationLocaleStatus,
  LifecycleStatus,
  ListSelectionListItemsParams,
  ListSelectionListsParams,
  Locale,
  OrganizationId,
  Page,
  PageParams,
  Paged,
  QuotaScope,
  ResolveRequest,
  ResolveResponse,
  ResolvedSelectionListItem,
  SelectionList,
  SelectionListAccessGrant,
  SelectionListAccessRole,
  SelectionListAccessUpsert,
  SelectionListAutofillRequest,
  SelectionListAutofillResult,
  SelectionListCreate,
  SelectionListErrorBody,
  SelectionListErrorCode,
  SelectionListErrorDetail,
  SelectionListErrorReason,
  SelectionListForkProvenance,
  SelectionListForkRequest,
  SelectionListId,
  SelectionListItem,
  SelectionListItemCreate,
  SelectionListItemId,
  SelectionListItemReorderResult,
  SelectionListItemTranslation,
  SelectionListItemTranslationUpsert,
  SelectionListItemUpdate,
  SelectionListQuotaEntry,
  SelectionListQuotaStatus,
  SelectionListTranslation,
  SelectionListTranslationUpsert,
  SelectionListUpdate,
  SelectionListVisibility,
  SeedProvenance,
  StatusFilter,
  SystemPrincipal,
  TranslationLocaleStatus,
  UserId,
} from './types'
