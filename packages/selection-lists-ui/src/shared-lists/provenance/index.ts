/**
 * shared-lists/provenance - the `fork-provenance` flow (frames 07, 13).
 * Components, hooks and pure derivations for the provenance card, the "behind
 * source" indicator and the revert-to-common / archive-fork confirmation.
 */

export { BehindSourceIndicator } from './BehindSourceIndicator'
export type { BehindSourceIndicatorProps } from './BehindSourceIndicator'
export { CopiedFromLabel } from './CopiedFromLabel'
export {
  ForkProvenanceBoundary,
  type ForkProvenanceBoundaryProps,
} from './ForkProvenanceBoundary'
export {
  ForkProvenancePanel,
  defaultSourceHref,
  formatForkedAt,
} from './ForkProvenancePanel'
export type { ForkProvenancePanelProps } from './ForkProvenancePanel'
export { useForkProvenanceContext } from './ProvenanceContext'
export type { ProvenanceContextValue } from './ProvenanceContext'
export { RevertToCommonConfirm } from './RevertToCommonConfirm'
export type {
  ArchiveConfirmCase,
  RevertToCommonConfirmProps,
} from './RevertToCommonConfirm'
export {
  archiveFork,
  archiveOutcomeFromFailure,
  getSourceItems,
} from './api'
export type { ArchiveOutcome } from './api'
export {
  behindStateOf,
  originItemIdOf,
  originLabelOf,
  revertGateOf,
  sourceRevisionOf,
} from './derive'
export type { BehindState, OriginLabel, RevertGate, SourceRead } from './derive'
export { useArchiveFork } from './useArchiveFork'
export type { ArchiveState, UseArchiveFork } from './useArchiveFork'
export { useCompactViewport } from './useCompactViewport'
export { useForkProvenance } from './useForkProvenance'
export type { ForkProvenance } from './useForkProvenance'
