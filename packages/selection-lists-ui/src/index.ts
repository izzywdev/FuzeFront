/**
 * @fuzeone/selection-lists-ui
 *
 * Public surface:
 *  - SelectionListManagementFlow  (frames 01-06)
 *  - TranslationWorkbenchFlow     (frames 07-09)
 *  - SelectionListAccessFlow      (frames 10-11)
 *  - SelectionListPickerHarness   (frames 12-14, harness route)
 *  - SelectionListPicker          (embeddable picker component)
 *  - Domain types
 *  - API helpers
 */

// ── Flow orchestrators ────────────────────────────────────────────────────────
export { SelectionListManagementFlow } from './SelectionListManagementFlow'
export { TranslationWorkbenchFlow } from './TranslationWorkbenchFlow'
export { SelectionListAccessFlow } from './SelectionListAccessFlow'
export { SelectionListPickerHarness, SelectionListPicker } from './SelectionListPickerHarness'

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
  PagedResponse,
  ApiError,
} from './types'

// ── API helpers ───────────────────────────────────────────────────────────────
export {
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
  searchUsers,
  probeReorderPermission,
  unwrapItems,
  unwrapCursor,
} from './api'
