/**
 * useArchiveFork - archive the fork (revert-to-common / "Archive fork...").
 *
 * A SINGLE-FLIGHT command: while a request is in flight a second `run()` returns
 * the same promise and sends nothing (the confirm button is also natively
 * disabled - this is the belt to those braces). `state` goes
 * `idle` -> `submitting` -> `done` (with the outcome); `reset()` returns to
 * `idle`. The write is never aborted on unmount - the service may already have
 * applied it - only its outcome is discarded.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SelectionListId } from '../core'
import { archiveFork, type ArchiveOutcome } from './api'

export type ArchiveState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'done'; outcome: ArchiveOutcome }

export interface UseArchiveFork {
  state: ArchiveState
  run: (listId: SelectionListId) => Promise<ArchiveOutcome>
  reset: () => void
}

export function useArchiveFork(): UseArchiveFork {
  const [state, setState] = useState<ArchiveState>({ status: 'idle' })
  const inFlight = useRef<Promise<ArchiveOutcome> | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const run = useCallback((listId: SelectionListId) => {
    if (inFlight.current) return inFlight.current
    setState({ status: 'submitting' })
    const promise = archiveFork(listId).then(
      outcome => {
        inFlight.current = null
        if (mounted.current) setState({ status: 'done', outcome })
        return outcome
      },
      (err: unknown) => {
        inFlight.current = null
        if (mounted.current) setState({ status: 'idle' })
        throw err
      }
    )
    inFlight.current = promise
    return promise
  }, [])

  const reset = useCallback(() => setState({ status: 'idle' }), [])
  return { state, run, reset }
}
