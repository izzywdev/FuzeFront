/**
 * `@fuzeone/selection-list-client` — typed client for the FuzeFront
 * selection-list-service.
 *
 * Derived by hand from `services/selection-list-service/openapi.yaml` v1.0.0.
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
  LOCALES,
  SELECTION_LIST_ID_PREFIX,
  SELECTION_LIST_ITEM_ID_PREFIX,
} from './types'

export type {
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
  StatusFilter,
  UserId,
} from './types'
