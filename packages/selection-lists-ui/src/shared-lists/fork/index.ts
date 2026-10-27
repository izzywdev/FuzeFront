/**
 * shared-lists/fork — flow 2 "fork" (frames 04, 05, 06, 12).
 *
 * ForkListFlow is the orchestrator; the rest are its parts, exported for the
 * read-only detail (ForkToEditButton), the refusal sites (ForkRequiredBanner and
 * the refusal notices) and the fork's detail (ForkResultNotice).
 */

export { CommonAccessGuard, ForkListFlow, isSharedByOthers } from './ForkListFlow'
export type { ForkListFlowProps } from './ForkListFlow'
export { ForkListDialog } from './ForkListDialog'
export type {
  ForkListDialogProps,
  ForkSource,
  ForkSuccess,
} from './ForkListDialog'
export { ForkToEditButton } from './ForkToEditButton'
export type { ForkToEditButtonProps } from './ForkToEditButton'
export { ForkRequiredBanner } from './ForkRequiredBanner'
export type { ForkRequiredBannerProps } from './ForkRequiredBanner'
export {
  CommonAccessNotice,
  CommonNoCreateNotice,
  ForkForbiddenNotice,
  ListNotFoundNotice,
} from './ForkRefusalNotice'
export { ForkResultNotice } from './ForkResultNotice'
export type { ForkResultNoticeProps } from './ForkResultNotice'
export {
  FORK_NOTICE_STATE_KEY,
  SELECTION_LISTS_ROUTE,
  forkNoticeState,
  listRoute,
  readForkNotice,
  useForkNotice,
  withoutForkNotice,
} from './notice'
export type { ForkNotice } from './notice'
export { hasForkForbidden, markForkForbidden, resetForkSession } from './session'
export { useMutationRefusal } from './useMutationRefusal'
export type { MutationRefusal } from './useMutationRefusal'
