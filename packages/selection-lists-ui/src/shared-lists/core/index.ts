/**
 * shared-lists/core — approval-independent infrastructure for the five
 * shared-lists flows (shared-read, fork, fork-provenance, visibility,
 * effective-picker). Types, API wrappers, hooks and the feature provider only:
 * nothing in here renders UI (a rendering component placed in core/** is a
 * review defect — it belongs in its flow's own directory).
 *
 * Flow components import from this barrel (`../core`); the package index
 * re-exports only what a HOST needs.
 */

// ── Feature flag ──────────────────────────────────────────────────────────────
export {
  SHARED_LISTS_FLAG_KEY,
  SharedListsFeatureProvider,
  useSharedLists,
} from './SharedListsFeatureProvider'
export type {
  SharedListsContextValue,
  SharedListsFeatureProviderProps,
} from './SharedListsFeatureProvider'

// ── View model ────────────────────────────────────────────────────────────────
export {
  DEFAULT_FORK_VISIBILITY,
  LIST_VISIBILITIES,
  SOURCE_GROUP_LABELS,
} from './types'
export type {
  ApiFailure,
  AuthorPrincipalKind,
  EditableState,
  EffectiveLookup,
  EffectiveSource,
  EffectiveValueRedirect,
  ForkCtaState,
  ForkOutcome,
  ForkVisibility,
  ListGroups,
  ListQueryParams,
  ListSourceGroup,
  Locale,
  Paged,
  QuotaScope,
  QuotaScopeName,
  ResolvedSelectionListItem,
  RestoreOutcome,
  SelectionListErrorBody,
  SelectionListErrorDetail,
  SelectionListErrorReason,
  SelectionListForkProvenance,
  SelectionListForkRequest,
  SelectionListId,
  SelectionListItemId,
  SelectionListVisibility,
  SharedList,
  SharedListsQuery,
  StatusFilter,
  StoredValueOutcome,
  VisibilityFilter,
  VisibilityOutcome,
  VisibilityUpdate,
} from './types'

// ── Pure derivations ──────────────────────────────────────────────────────────
export {
  appendUnique,
  canOfferPlatformPublish,
  createdByKind,
  editableStateOf,
  effectiveSourceOf,
  forkCtaFor,
  forkedKeysOf,
  forkProvenanceOf,
  groupBySource,
  groupingApplies,
  isCommonList,
  isFork,
  isSameOriginPath,
  redirectsOf,
  toListParams,
  visibilityOf,
} from './derive'

// ── Errors ────────────────────────────────────────────────────────────────────
export {
  classifyApiError,
  classifyMutationError,
  forkOutcomeFromFailure,
  isAbortError,
  restoreOutcomeFromFailure,
  visibilityOutcomeFromFailure,
} from './errors'

// ── API ───────────────────────────────────────────────────────────────────────
export {
  changeVisibility,
  forkList,
  getEffectiveList,
  getListByKey,
  getSharedList,
  listSharedLists,
  resolveStoredValues,
  restoreList,
} from './api'

// ── Hooks ─────────────────────────────────────────────────────────────────────
export { useEffectiveList } from './useEffectiveList'
export type {
  UseEffectiveListOptions,
  UseEffectiveListResult,
} from './useEffectiveList'
export { useSharedList } from './useSharedList'
export type { SharedListState, UseSharedListResult } from './useSharedList'
export { useSharedListIndex } from './useSharedListIndex'
export type {
  SharedListIndex,
  UseSharedListIndexOptions,
} from './useSharedListIndex'
export { useStoredValues } from './useStoredValues'
export type {
  UseStoredValuesOptions,
  UseStoredValuesResult,
} from './useStoredValues'
export {
  useChangeVisibility,
  useForkList,
  useRestoreList,
} from './useListActions'
export type { ActionState, ListAction } from './useListActions'
