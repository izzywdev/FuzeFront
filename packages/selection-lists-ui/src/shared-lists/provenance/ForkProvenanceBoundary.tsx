/**
 * ForkProvenanceBoundary - the fork-provenance flow's host-facing mount.
 *
 * Wrap the list detail's body (the tab strip and the value editor) with it. For
 * a FORK it renders the provenance panel above `children` and shares the page's
 * single source read with the value editor, whose rows ask this boundary for
 * their `data-origin-item` and "Copied from" cell (`useForkProvenanceContext`).
 * For anything else - flag OFF, a list that is not a fork, the fork still
 * loading or failing to load - it renders exactly `children`, reads nothing from
 * the source, and adds nothing to a row: the approved 4.0.0 detail, untouched.
 *
 * The fork itself is read here (`GET /v1/selection-lists/{listId}`) for its
 * 4.1.0 `forked_from`; the editor never waits for it or for the comparison.
 */

import { useMemo, type ReactNode } from 'react'
import { useSharedLists, useSharedList } from '../core'
import { CopiedFromLabel } from './CopiedFromLabel'
import { originItemIdOf } from './derive'
import {
  ForkProvenancePanel,
  type ForkProvenancePanelProps,
} from './ForkProvenancePanel'
import {
  ProvenanceContext,
  type ProvenanceContextValue,
} from './ProvenanceContext'
import { useForkProvenance } from './useForkProvenance'

export interface ForkProvenanceBoundaryProps
  extends Omit<ForkProvenancePanelProps, 'list'> {
  /** The list whose detail is shown. */
  listId: string
  children?: ReactNode
}

export function ForkProvenanceBoundary({
  listId,
  children,
  ...panelProps
}: ForkProvenanceBoundaryProps) {
  const { enabled } = useSharedLists()
  const fork = useSharedList(enabled ? listId : null)
  const provenance = useForkProvenance(
    enabled && fork.phase === 'ready' ? fork.list : null,
    enabled
  )

  const value = useMemo<ProvenanceContextValue | null>(
    () =>
      provenance
        ? {
            provenance,
            originAttributes: item => ({
              'data-origin-item': originItemIdOf(item) ?? 'none',
            }),
            copiedFrom: item => (
              <CopiedFromLabel
                origin={provenance.originLabel(originItemIdOf(item))}
              />
            ),
          }
        : null,
    [provenance]
  )

  if (!enabled || !value || !provenance) return <>{children}</>
  return (
    <ProvenanceContext.Provider value={value}>
      <ForkProvenancePanel list={provenance.fork} {...panelProps} />
      {children}
    </ProvenanceContext.Provider>
  )
}
