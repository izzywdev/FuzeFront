/**
 * @fuzeone/selection-lists-ui
 *
 * Public surface:
 *  - SelectionListManagementFlow  (frames 01-06)
 *  - TranslationWorkbenchFlow     (frames 07-09)
 *  - SelectionListAccessFlow      (frames 10-11)
 *  - SelectionListPickerHarness   (frames 12-14, harness route)
 *  - SelectionListPicker          (embeddable picker; `onChange` emits item ids)
 *  - Domain types
 *  - API helpers
 */

// ── Flow orchestrators ────────────────────────────────────────────────────────
export { SelectionListManagementFlow } from './SelectionListManagementFlow'
export { TranslationWorkbenchFlow } from './TranslationWorkbenchFlow'
export { SelectionListAccessFlow } from './SelectionListAccessFlow'
export { SelectionListPickerHarness, SelectionListPicker } from './SelectionListPickerHarness'
export type {
  SelectionListPickerProps,
  SingleSelectionListPickerProps,
  MultiSelectionListPickerProps,
} from './SelectionListPickerHarness'

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  SelectionList,
  SelectionListItem,
  QuotaScope,
  QuotaStatus,
  LocaleIndexEntry,
  LocaleIndexResponse,
  TranslationEntry,
  LocaleEditorResponse,
  AccessGrant,
  ResolvedItem,
  ResolveResponse,
  ResolveWireResponse,
  PagedResponse,
  ApiError,
  AutofillResult,
} from './types'

// ── API helpers ───────────────────────────────────────────────────────────────
export {
  setSelectionListAuthTokenProvider,
  listSelectionLists,
  createSelectionList,
  getSelectionList,
  listItems,
  createItem,
  updateItem,
  archiveItem,
  purgeItem,
  reorderItems,
  getQuota,
  getLocaleIndex,
  getLocaleEditor,
  saveTranslation,
  autofillTranslations,
  getAccessGrants,
  updateAccessGrant,
  revokeAccessGrant,
  resolveItems,
  RESOLVE_MAX_IDS,
  searchUsers,
  probeReorderPermission,
  unwrapItems,
  unwrapCursor,
  configureSelectionListsAuth,
} from './api'
export type { SelectionListsAuth } from './api'

// ── Shared lists (SL9, contract 4.1.0) ───────────────────────────────────────
// Host-facing surface only: the feature provider (release flag + platform-org
// hint) and the types a consumer of `onEffectiveValue` / the flag needs. The
// flows import the rest from './shared-lists/core' directly.
export {
  SHARED_LISTS_FLAG_KEY,
  SharedListsFeatureProvider,
  useSharedLists,
} from './shared-lists/core'
export type {
  SharedList,
  SharedListsContextValue,
  SharedListsFeatureProviderProps,
  SelectionListVisibility,
} from './shared-lists/core'
