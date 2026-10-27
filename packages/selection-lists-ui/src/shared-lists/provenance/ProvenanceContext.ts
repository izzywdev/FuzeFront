/**
 * The boundary -> row channel: the fork's provenance, shared by the card, the
 * header action and every "Copied from" cell of the value editor, so the page
 * makes ONE source read however many things render from it.
 *
 * Absent (`null`) means "no provenance here" - flag OFF, or not a fork - and a
 * row then adds nothing at all.
 */

import { createContext, useContext, type ReactNode } from 'react'
import type { ForkProvenance } from './useForkProvenance'

export interface ProvenanceContextValue {
  provenance: ForkProvenance
  /**
   * `data-origin-item` for a fork item's row (frame 07): the source item id, or
   * `none` for an item added in the fork. Spread onto the row element.
   */
  originAttributes: (item: unknown) => { 'data-origin-item': string }
  /** The "Copied from" cell content for a fork item. */
  copiedFrom: (item: unknown) => ReactNode
}

export const ProvenanceContext = createContext<ProvenanceContextValue | null>(
  null
)

/** The fork's provenance for the value editor's rows, or `null` outside a fork. */
export function useForkProvenanceContext(): ProvenanceContextValue | null {
  return useContext(ProvenanceContext)
}
