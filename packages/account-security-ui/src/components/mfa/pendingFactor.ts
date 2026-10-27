import { useCallback, useEffect, useRef } from 'react'
import type { MfaClient } from '../../types'

const noop = () => undefined

/**
 * Tracks the PENDING (not yet activated) factor an enrolment flow created, and
 * removes it when the user abandons the flow: `discard()` on cancel and, as a
 * safety net, on unmount. Best-effort by design — a failed DELETE is swallowed
 * (the factor stays inert: it is `pending`, never offered at sign-in, and
 * deleting a pending factor is always allowed — it is not the "last factor"
 * the 409 guard protects). A hard tab close cannot run this: the pending factor
 * then stays until it is removed (the user can remove it from the MFA overview).
 * There is currently NO server-side expiry of pending factors; adding one is a
 * tracked follow-up.
 *
 * INVARIANT: discard ALWAYS reconciles with the server before deleting, whatever
 * the activation history. It waits for any in-flight activation (`activating`) to
 * settle, then reads the factor listing and DELETEs only a factor the server still
 * reports `pending`. Active or missing → nothing to delete; a failed listing → no
 * delete (left inert). The backend can delete an ACTIVE factor when another active
 * one exists, and a lost response / retried code can leave the client unable to
 * tell, so the client never infers status from the outcomes it saw. The cost is one
 * extra list request on abandon.
 *
 * An enrolment still in flight when the flow unmounts is covered too: register it
 * with `enrolling()` (and `track()` after disposal) so the factor it later creates
 * goes through the same reconcile-then-delete path, once.
 */
export function usePendingFactor(api: Pick<MfaClient, 'removeFactor' | 'listFactors'>) {
  const pending = useRef<string | null>(null)
  const activation = useRef<Promise<unknown> | null>(null)
  const disposed = useRef(false)
  // Ids already routed through reconcile-then-delete, so the several paths that can
  // reach one id (enrol settle, track-after-dispose, discard) issue ONE DELETE.
  const reconciled = useRef<Set<string>>(new Set())
  const apiRef = useRef(api)
  apiRef.current = api

  /** Reconcile with the server, then DELETE only a factor it still reports `pending`. */
  const reconcileAndDelete = useCallback((id: string, after?: Promise<unknown> | null) => {
    if (reconciled.current.has(id)) return
    reconciled.current.add(id)
    const removal = (after ? after.then(noop, noop) : Promise.resolve()).then(async () => {
      const factors = await apiRef.current.listFactors() // a failure rejects → no delete
      if (factors.find((f) => f.factorId === id)?.status === 'pending') {
        await apiRef.current.removeFactor(id)
      }
    })
    void removal.catch(() => {
      /* best-effort cleanup */
    })
  }, [])

  const discard = useCallback(() => {
    const id = pending.current
    pending.current = null
    if (!id) return
    reconcileAndDelete(id, activation.current)
  }, [reconcileAndDelete])

  useEffect(() => {
    disposed.current = false
    return () => {
      disposed.current = true
      discard()
    }
  }, [discard])

  return {
    /** Remember the pending factor so abandoning the flow removes it. */
    track: (factorId: string) => {
      if (disposed.current) {
        // The flow was abandoned while the enrolment was in flight: nobody will
        // activate this factor, so route it through the same cleanup.
        reconcileAndDelete(factorId, activation.current)
        return
      }
      pending.current = factorId
    },
    /** The factor was activated: it is a real method now, never discard it. */
    clear: () => {
      pending.current = null
    },
    /**
     * Register the outstanding activation request so an abandon (unmount / back)
     * waits for it instead of racing a DELETE against it. Returns the promise.
     */
    activating: <T,>(request: Promise<T>): Promise<T> => {
      const tracked = request.finally(() => {
        if (activation.current === tracked) activation.current = null
      })
      activation.current = tracked
      return tracked
    },
    /**
     * Register the outstanding enrolment (CREATE of the pending factor) request.
     * If the flow is disposed before it settles, a resolved factor id is
     * reconciled and deleted if still pending; a rejection does nothing. Returns
     * the same promise.
     */
    enrolling: <T extends { factorId: string }>(request: Promise<T>): Promise<T> => {
      request.then(
        (res) => {
          if (disposed.current && res?.factorId) reconcileAndDelete(res.factorId)
        },
        noop
      )
      return request
    },
    discard,
  }
}
